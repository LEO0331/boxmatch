import 'dart:async';
import 'dart:convert';

import 'package:boxmatch/features/surplus/data/firestore_surplus_repository.dart';
import 'package:boxmatch/features/surplus/domain/reservation.dart';
import 'package:boxmatch/features/surplus/domain/surplus_exceptions.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _UnusedFirestore extends Fake implements FirebaseFirestore {}

Reservation fixture(String owner) => Reservation(
  id: 'r1',
  listingId: 'listing-one',
  claimerUid: owner,
  qty: 1,
  pickupCode: 'fixture-code',
  status: ReservationStatus.reserved,
  createdAt: DateTime.utc(2026, 11, 26),
  expiresAt: DateTime.utc(2026, 11, 27),
);

void main() {
  late String? uid;
  late List<String> queriedOwners;
  late Future<List<Reservation>> Function(String uid) read;
  late List<String> apiCalls;
  late MockClient client;
  late FirestoreSurplusRepository repository;

  setUp(() {
    uid = 'alice';
    queriedOwners = [];
    read = (owner) async => [fixture(owner)];
    apiCalls = [];
    client = MockClient((request) async {
      apiCalls.add(request.url.path);
      expect(request.headers['authorization'], 'Bearer fixture-token');
      return http.Response(jsonEncode({'ok': true}), 200);
    });
    repository = FirestoreSurplusRepository(
      _UnusedFirestore(),
      apiBaseUrl: 'https://api.example.com',
      httpClient: client,
      idTokenProvider: () async => 'fixture-token',
      currentRecipientUid: () => uid,
      directReservationReads: true,
      directReservationReader: (owner) {
        queriedOwners.add(owner);
        return read(owner);
      },
    );
  });

  tearDown(() => client.close());

  test('direct list supplies the authenticated owner and never calls Render', () async {
    final reservations = await repository.listRecipientReservations(claimerUid: 'alice');
    expect(reservations.single.claimerUid, 'alice');
    expect(queriedOwners, ['alice']);
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
    expect(queriedOwners, isEmpty);
    expect(apiCalls, isEmpty);
  });

  test('permission denial fails closed without API fallback', () async {
    read = (_) async => throw FirebaseException(
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
    final pending = Completer<List<Reservation>>();
    read = (_) => pending.future;
    final first = repository.listRecipientReservations(claimerUid: 'alice');
    final second = repository.listRecipientReservations(claimerUid: 'alice');
    expect(identical(first, second), isTrue);
    final rejected = expectLater(first, throwsA(isA<PermissionDeniedException>()));
    uid = 'bob';
    expect(repository.cachedRecipientReservations('alice'), isNull);
    pending.complete([fixture('alice')]);
    await rejected;
    expect(queriedOwners, ['alice']);
    expect(repository.cachedRecipientReservations('bob'), isNull);
  });

  test('unexpected foreign data fails closed and is not cached', () async {
    read = (_) async => [fixture('bob')];
    await expectLater(
      repository.listRecipientReservations(claimerUid: 'alice'),
      throwsA(isA<PermissionDeniedException>()),
    );
    expect(repository.cachedRecipientReservations('alice'), isNull);
    expect(apiCalls, isEmpty);
  });

  test('cancel uses authenticated API and invalidates the cached list', () async {
    await repository.listRecipientReservations(claimerUid: 'alice');
    await repository.cancelReservation(reservationId: 'r1', claimerUid: 'alice');
    expect(apiCalls, ['/recipient/reservations/r1/cancel']);
    expect(repository.cachedRecipientReservations('alice'), isNull);
  });
}
