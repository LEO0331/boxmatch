import 'dart:async';
import 'dart:convert';

import 'package:boxmatch/features/surplus/data/firestore_surplus_repository.dart';
import 'package:boxmatch/features/surplus/domain/surplus_exceptions.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _Doc extends Fake implements QueryDocumentSnapshot<Map<String, dynamic>> {
  _Doc(this.id, this.owner);
  @override
  final String id;
  final String owner;

  @override
  Map<String, dynamic> data() => {
    'claimerUid': owner,
    'listingId': 'listing-one',
    'qty': 1,
    'pickupCode': 'fixture-code',
    'status': 'reserved',
    'createdAt': DateTime.utc(2026, 11, 26),
    'expiresAt': DateTime.utc(2026, 11, 27),
  };
}

class _Snapshot extends Fake implements QuerySnapshot<Map<String, dynamic>> {
  _Snapshot(this.docs);
  @override
  final List<QueryDocumentSnapshot<Map<String, dynamic>>> docs;
}

class _Query extends Fake implements Query<Map<String, dynamic>> {
  int reads = 0;
  Future<QuerySnapshot<Map<String, dynamic>>> Function()? handler;

  @override
  Future<QuerySnapshot<Map<String, dynamic>>> get([GetOptions? options]) {
    expect(options?.source, Source.server);
    reads++;
    return handler?.call() ?? Future.value(_Snapshot([_Doc('r1', 'alice')]));
  }
}

class _Collection extends Fake
    implements CollectionReference<Map<String, dynamic>> {
  _Collection(this.result);
  final _Query result;
  String? owner;

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #where) {
      expect(invocation.positionalArguments, ['claimerUid']);
      owner = invocation.namedArguments[#isEqualTo] as String?;
      return result;
    }
    return super.noSuchMethod(invocation);
  }
}

class _Firestore extends Fake implements FirebaseFirestore {
  _Firestore(this.reservations);
  final _Collection reservations;

  @override
  CollectionReference<Map<String, dynamic>> collection(String collectionPath) {
    expect(collectionPath, 'reservations');
    return reservations;
  }
}

void main() {
  late String? uid;
  late _Query query;
  late _Collection collection;
  late List<String> apiCalls;
  late MockClient client;
  late FirestoreSurplusRepository repository;

  setUp(() {
    uid = 'alice';
    query = _Query();
    collection = _Collection(query);
    apiCalls = [];
    client = MockClient((request) async {
      apiCalls.add(request.url.path);
      expect(request.headers['authorization'], 'Bearer fixture-token');
      return http.Response(jsonEncode({'ok': true}), 200);
    });
    repository = FirestoreSurplusRepository(
      _Firestore(collection),
      apiBaseUrl: 'https://api.example.com',
      httpClient: client,
      idTokenProvider: () async => 'fixture-token',
      currentRecipientUid: () => uid,
      directReservationReads: true,
    );
  });

  tearDown(() => client.close());

  test('direct list is owner-filtered, server-sourced and never calls Render', () async {
    final reservations = await repository.listRecipientReservations(claimerUid: 'alice');
    expect(reservations.single.claimerUid, 'alice');
    expect(collection.owner, 'alice');
    expect(query.reads, 1);
    expect(apiCalls, isEmpty);
    expect(repository.cachedRecipientReservations('alice')?.single.id, 'r1');
    expect(repository.cachedRecipientReservations('bob'), isNull);
  });

  test('identity mismatch and missing identity fail before querying', () async {
    await expectLater(
      repository.listRecipientReservations(claimerUid: 'bob'),
      throwsA(isA<PermissionDeniedException>()),
    );
    uid = null;
    await expectLater(
      repository.listRecipientReservations(claimerUid: 'alice'),
      throwsA(isA<PermissionDeniedException>()),
    );
    expect(query.reads, 0);
    expect(apiCalls, isEmpty);
  });

  test('permission denial fails closed without API fallback', () async {
    query.handler = () async => throw FirebaseException(
      plugin: 'cloud_firestore',
      code: 'permission-denied',
    );
    await expectLater(
      repository.listRecipientReservations(claimerUid: 'alice'),
      throwsA(isA<PermissionDeniedException>()),
    );
    expect(apiCalls, isEmpty);
    expect(repository.cachedRecipientReservations('alice'), isNull);
  });

  test('concurrent same-owner reads share one operation; identity changes reject late results', () async {
    final pending = Completer<QuerySnapshot<Map<String, dynamic>>>();
    query.handler = () => pending.future;
    final first = repository.listRecipientReservations(claimerUid: 'alice');
    final second = repository.listRecipientReservations(claimerUid: 'alice');
    expect(identical(first, second), isTrue);
    final rejected = expectLater(first, throwsA(isA<PermissionDeniedException>()));
    uid = 'bob';
    expect(repository.cachedRecipientReservations('alice'), isNull);
    pending.complete(_Snapshot([_Doc('r1', 'alice')]));
    await rejected;
    expect(query.reads, 1);
    expect(repository.cachedRecipientReservations('bob'), isNull);
  });

  test('cancel uses authenticated API and invalidates the cached list', () async {
    await repository.listRecipientReservations(claimerUid: 'alice');
    await repository.cancelReservation(reservationId: 'r1', claimerUid: 'alice');
    expect(apiCalls, ['/recipient/reservations/r1/cancel']);
    expect(repository.cachedRecipientReservations('alice'), isNull);
  });
}
