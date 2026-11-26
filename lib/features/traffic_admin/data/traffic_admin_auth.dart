import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

class TrafficAdminAuthException implements Exception {
  const TrafficAdminAuthException(this.code);
  final String code;
  @override
  String toString() => 'TrafficAdminAuthException($code)';
}

abstract class TrafficAdminSession extends ChangeNotifier {
  bool get isAuthenticated;
  bool get isAuthorized;
  bool get isBusy;
  int get revision;
  Future<void> signIn(String email, String password);
  Future<void> signOut();
  Future<String?> idToken({bool forceRefresh = false});
  void invalidate();
}

/// Uses only the named administrator Auth instance supplied by the lazy factory.
/// Recipient authentication is deliberately not read or changed here.
class FirebaseTrafficAdminSession extends TrafficAdminSession {
  FirebaseTrafficAdminSession(this._auth) {
    _subscription = _auth.idTokenChanges().listen(
      _observe,
      onError: (_) => invalidate(),
    );
    _observe(_auth.currentUser);
  }

  final FirebaseAuth _auth;
  StreamSubscription<User?>? _subscription;
  String? _uid;
  bool _authenticated = false;
  bool _authorized = false;
  bool _busy = false;
  bool _blocked = false;
  bool _disposed = false;
  int _revision = 0;

  @override
  bool get isAuthenticated => _authenticated;
  @override
  bool get isAuthorized => _authorized;
  @override
  bool get isBusy => _busy;
  @override
  int get revision => _revision;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _clear({required bool blocked}) {
    _blocked = blocked;
    _uid = null;
    _authenticated = false;
    _authorized = false;
    _revision++;
    _notify();
  }

  void _observe(User? user) {
    if (_disposed || _blocked) return;
    if (user == null) {
      _clear(blocked: false);
      return;
    }
    if (_uid != user.uid) {
      _uid = user.uid;
      _authenticated = false;
      _authorized = false;
      _revision++;
      _notify();
    }
    unawaited(_readUser(user).then((_) {}, onError: (_) => invalidate()));
  }

  Future<String?> _readUser(User user, {bool forceRefresh = false}) async {
    final epoch = _revision;
    final result = await user.getIdTokenResult(forceRefresh);
    if (_disposed ||
        _blocked ||
        epoch != _revision ||
        _auth.currentUser?.uid != user.uid) {
      return null;
    }
    final provider = result.claims?['firebase'];
    final providerName = provider is Map ? provider['sign_in_provider'] : null;
    final authenticated =
        !user.isAnonymous &&
        providerName is String &&
        providerName.isNotEmpty &&
        providerName != 'anonymous';
    final authorized = authenticated && result.claims?['trafficAdmin'] == true;
    if (_authenticated != authenticated || _authorized != authorized) {
      _authenticated = authenticated;
      _authorized = authorized;
      _revision++;
      _notify();
    }
    return authorized ? result.token : null;
  }

  @override
  Future<void> signIn(String email, String password) async {
    if (_busy || _disposed) return;
    final address = email.trim();
    if (address.isEmpty ||
        address.length > 254 ||
        password.isEmpty ||
        password.length > 4096) {
      throw const TrafficAdminAuthException('invalid-credential');
    }
    _clear(blocked: false);
    _busy = true;
    _notify();
    try {
      final credential = await _auth.signInWithEmailAndPassword(
        email: address,
        password: password,
      );
      final user = credential.user;
      if (user == null) {
        throw const TrafficAdminAuthException('invalid-credential');
      }
      if (_uid != user.uid) {
        _uid = user.uid;
        _revision++;
      }
      await _readUser(user, forceRefresh: true);
      if (!_authorized) throw const TrafficAdminAuthException('not-authorized');
    } on FirebaseAuthException catch (error) {
      invalidate();
      final code =
          {
            'too-many-requests',
            'network-request-failed',
            'user-disabled',
          }.contains(error.code)
          ? error.code
          : 'invalid-credential';
      throw TrafficAdminAuthException(code);
    } finally {
      _busy = false;
      _notify();
    }
  }

  @override
  Future<void> signOut() async {
    _clear(blocked: true);
    try {
      await _auth.signOut();
    } catch (_) {
      throw const TrafficAdminAuthException('sign-out-unavailable');
    }
  }

  @override
  Future<String?> idToken({bool forceRefresh = false}) async {
    final user = _auth.currentUser;
    if (_disposed || _blocked || !_authorized || user == null) return null;
    try {
      return await _readUser(user, forceRefresh: forceRefresh);
    } catch (_) {
      invalidate();
      return null;
    }
  }

  @override
  void invalidate() => _clear(blocked: true);

  @override
  void dispose() {
    _disposed = true;
    _revision++;
    unawaited(_subscription?.cancel());
    super.dispose();
  }
}
