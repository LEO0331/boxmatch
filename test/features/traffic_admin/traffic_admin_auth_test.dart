import 'dart:async';

import 'package:boxmatch/features/traffic_admin/data/traffic_admin_auth.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';

class _Token extends Fake implements IdTokenResult {
  _Token(this.value);
  final Map<String, dynamic> value;
  @override
  Map<String, dynamic> get claims => value;
  @override
  String get token => 'fixture-admin-token';
}

class _User extends Fake implements User {
  _User({
    this.anonymous = false,
    Object? claim = true,
    this.provider = 'password',
  }) : claims = {'trafficAdmin': claim};
  bool anonymous;
  String? provider;
  Map<String, dynamic> claims;
  Completer<IdTokenResult>? pending;
  bool fails = false;
  @override
  String get uid => 'fixture-admin';
  @override
  bool get isAnonymous => anonymous;
  @override
  Future<IdTokenResult> getIdTokenResult([bool forceRefresh = false]) async {
    if (fails) throw FirebaseAuthException(code: 'user-token-expired');
    if (pending != null) return pending!.future;
    return _Token({
      ...claims,
      'firebase': {'sign_in_provider': provider},
    });
  }
}

class _Credential extends Fake implements UserCredential {
  _Credential(this.value);
  final User value;
  @override
  User get user => value;
}

class _Auth extends Fake implements FirebaseAuth {
  _Auth(this.account);
  final _User account;
  final events = StreamController<User?>.broadcast(sync: true);
  User? active;
  int signOutCalls = 0;
  String? signInFailure;
  bool signOutFails = false;
  @override
  User? get currentUser => active;
  @override
  Stream<User?> idTokenChanges() => events.stream;
  @override
  Future<UserCredential> signInWithEmailAndPassword({
    required String email,
    required String password,
  }) async {
    if (signInFailure != null) {
      throw FirebaseAuthException(code: signInFailure!);
    }
    active = account;
    events.add(active);
    return _Credential(account);
  }

  @override
  Future<void> signOut() async {
    signOutCalls++;
    if (signOutFails) throw StateError('offline');
    active = null;
    events.add(null);
  }
}

void main() {
  test(
    'admin sign-in operates only on the explicitly supplied Auth instance',
    () async {
      final recipient = _Auth(_User(anonymous: true))
        ..active = _User(anonymous: true);
      final auth = _Auth(_User());
      final session = FirebaseTrafficAdminSession(auth);
      await session.signIn(' admin@example.test ', 'test-password');
      expect(session.isAuthenticated, isTrue);
      expect(session.isAuthorized, isTrue);
      expect(await session.idToken(), 'fixture-admin-token');
      expect(recipient.currentUser!.isAnonymous, isTrue);
      expect(recipient.signOutCalls, 0);
      final revision = session.revision;
      await session.signOut();
      expect(session.revision, greaterThan(revision));
      expect(session.isAuthorized, isFalse);
      expect(auth.signOutCalls, 1);
      expect(recipient.currentUser!.isAnonymous, isTrue);
      session.dispose();
      await auth.events.close();
      await recipient.events.close();
    },
  );

  for (final claim in [false, 'true', 1, null]) {
    test(
      'only a strict true administrator claim authorizes ($claim)',
      () async {
        final auth = _Auth(_User(claim: claim));
        final session = FirebaseTrafficAdminSession(auth);
        await expectLater(
          session.signIn('admin@example.test', 'password'),
          throwsA(isA<TrafficAdminAuthException>()),
        );
        expect(session.isAuthenticated, isTrue);
        expect(session.isAuthorized, isFalse);
        expect(await session.idToken(), isNull);
        session.dispose();
        await auth.events.close();
      },
    );
  }

  test(
    'anonymous identities and missing provider claims fail closed',
    () async {
      for (final user in [
        _User(anonymous: true),
        _User(provider: 'anonymous'),
        _User(provider: null),
      ]) {
        final auth = _Auth(user);
        final session = FirebaseTrafficAdminSession(auth);
        await expectLater(
          session.signIn('admin@example.test', 'password'),
          throwsA(isA<TrafficAdminAuthException>()),
        );
        expect(session.isAuthorized, isFalse);
        session.dispose();
        await auth.events.close();
      }
    },
  );

  test(
    'claim removal and token expiration invalidate an existing session',
    () async {
      final auth = _Auth(_User());
      final session = FirebaseTrafficAdminSession(auth);
      await session.signIn('admin@example.test', 'password');
      auth.account.claims['trafficAdmin'] = false;
      auth.events.add(auth.account);
      await Future<void>.delayed(Duration.zero);
      expect(session.isAuthenticated, isTrue);
      expect(session.isAuthorized, isFalse);
      auth.account.claims['trafficAdmin'] = true;
      await session.signIn('admin@example.test', 'password');
      auth.account.fails = true;
      expect(await session.idToken(forceRefresh: true), isNull);
      expect(session.isAuthorized, isFalse);
      session.dispose();
      await auth.events.close();
    },
  );

  test('logout prevents a pending claim check from restoring access', () async {
    final auth = _Auth(_User());
    final session = FirebaseTrafficAdminSession(auth);
    await session.signIn('admin@example.test', 'password');
    auth.account.pending = Completer<IdTokenResult>();
    final pending = session.idToken();
    await session.signOut();
    auth.account.pending!.complete(
      _Token({
        'trafficAdmin': true,
        'firebase': {'sign_in_provider': 'password'},
      }),
    );
    expect(await pending, isNull);
    expect(session.isAuthorized, isFalse);
    session.dispose();
    await auth.events.close();
  });

  test(
    'invalid credentials, unavailable sign-out and stream failures retain no access',
    () async {
      final auth = _Auth(_User())..signInFailure = 'wrong-password';
      final session = FirebaseTrafficAdminSession(auth);
      await expectLater(
        session.signIn('', ''),
        throwsA(isA<TrafficAdminAuthException>()),
      );
      await expectLater(
        session.signIn('admin@example.test', 'password'),
        throwsA(isA<TrafficAdminAuthException>()),
      );
      expect(session.isBusy, isFalse);
      auth.signInFailure = null;
      await session.signIn('admin@example.test', 'password');
      auth.events.addError(StateError('private-error'));
      expect(session.isAuthorized, isFalse);
      auth.signOutFails = true;
      await expectLater(
        session.signOut(),
        throwsA(isA<TrafficAdminAuthException>()),
      );
      expect(session.isAuthenticated, isFalse);
      session.dispose();
      await auth.events.close();
    },
  );
}
