import 'dart:async';

import 'package:boxmatch/app/app_scope.dart';
import 'package:boxmatch/features/surplus/data/in_memory_surplus_repository.dart';
import 'package:boxmatch/features/surplus/domain/listing_input.dart';
import 'package:boxmatch/features/surplus/domain/listing_visibility.dart';
import 'package:boxmatch/features/surplus/domain/reservation.dart';
import 'package:boxmatch/features/surplus/domain/surplus_exceptions.dart';
import 'package:boxmatch/features/surplus/presentation/browse/my_reservations_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../test_helpers.dart';

ListingInput _input(
  DateTime now, {
  required String itemType,
  required String displayName,
}) {
  return ListingInput(
    venueId: 'taipei-nangang-exhibition-center-hall-1',
    pickupPointText: 'Hall 1 service desk side',
    itemType: itemType,
    description: '$itemType for test',
    quantityTotal: 3,
    price: 0,
    currency: 'TWD',
    pickupStartAt: now.add(const Duration(minutes: 20)),
    pickupEndAt: now.add(const Duration(hours: 1)),
    expiresAt: now.add(const Duration(hours: 2)),
    displayNameOptional: displayName,
    visibility: ListingVisibility.minimal,
    disclaimerAccepted: true,
  );
}

Future<void> _pumpPage(
  WidgetTester tester, {
  required InMemorySurplusRepository repo,
}) async {
  final deps = await buildTestDependencies(repository: repo);
  await tester.pumpWidget(
    AppScope(
      dependencies: deps,
      child: const MaterialApp(home: MyReservationsPage()),
    ),
  );
  await tester.pumpAndSettle();
}

class _ThrowingListRepository extends InMemorySurplusRepository {
  @override
  Future<List<Reservation>> listRecipientReservations({
    required String claimerUid,
  }) async {
    throw const ValidationException('List failed for test.');
  }
}

class _PendingListRepository extends InMemorySurplusRepository {
  final Completer<List<Reservation>> completer = Completer<List<Reservation>>();

  @override
  Future<List<Reservation>> listRecipientReservations({
    required String claimerUid,
  }) async {
    return completer.future;
  }
}

class _ThrowingCancelRepository extends InMemorySurplusRepository {
  @override
  Future<void> cancelReservation({
    required String reservationId,
    required String claimerUid,
  }) async {
    throw const ValidationException('Cancel failed for test.');
  }
}

void main() {
  testWidgets('shows privacy/faq without client-side inferred badge', (
    tester,
  ) async {
    final repo = InMemorySurplusRepository();
    final now = DateTime.now();

    final listingA = await repo.createListing(
      _input(now, itemType: 'Lunchbox', displayName: 'Acme Charity'),
    );
    final listingB = await repo.createListing(
      _input(now, itemType: 'Drink', displayName: 'Acme Charity'),
    );

    await repo.reserveListing(
      listingId: listingA.listingId,
      claimerUid: 'test-user',
      qty: 1,
      disclaimerAccepted: true,
    );
    await repo.reserveListing(
      listingId: listingB.listingId,
      claimerUid: 'test-user',
      qty: 1,
      disclaimerAccepted: true,
    );

    await _pumpPage(tester, repo: repo);

    expect(find.text('Privacy & FAQ'), findsOneWidget);
    expect(find.textContaining('Privacy note'), findsOneWidget);
    expect(find.text('Frequent enterprise'), findsNothing);
  });

  testWidgets('cancel reservation action works', (tester) async {
    final repo = InMemorySurplusRepository();
    final now = DateTime.now();
    final listing = await repo.createListing(
      _input(now, itemType: 'Lunchbox', displayName: 'Acme Charity'),
    );
    await repo.reserveListing(
      listingId: listing.listingId,
      claimerUid: 'test-user',
      qty: 1,
      disclaimerAccepted: true,
    );

    await _pumpPage(tester, repo: repo);
    await tester.tap(find.widgetWithText(OutlinedButton, 'Cancel reservation'));
    await tester.pumpAndSettle();

    expect(find.text('Reservation cancelled.'), findsOneWidget);
  });

  testWidgets('empty state shows browse CTA', (tester) async {
    final repo = InMemorySurplusRepository();

    await _pumpPage(tester, repo: repo);

    expect(find.text('No reservations yet.'), findsOneWidget);
    expect(
      find.widgetWithText(FilledButton, 'Browse listings'),
      findsOneWidget,
    );
  });

  testWidgets('shows loading skeleton while waiting for reservations', (
    tester,
  ) async {
    final repo = _PendingListRepository();
    final deps = await buildTestDependencies(repository: repo);
    tester.view.physicalSize = const Size(1280, 2000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      AppScope(
        dependencies: deps,
        child: const MaterialApp(home: MyReservationsPage()),
      ),
    );
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.byType(ConstrainedBox), findsWidgets);
    expect(find.byType(Card), findsWidgets);
    repo.completer.complete(const <Reservation>[]);
  });

  testWidgets('shows error view and warmup hint after retry fails', (
    tester,
  ) async {
    final repo = _ThrowingListRepository();
    final deps = await buildTestDependencies(repository: repo);

    await tester.pumpWidget(
      AppScope(
        dependencies: deps,
        child: const MaterialApp(home: MyReservationsPage()),
      ),
    );
    await tester.pump(const Duration(milliseconds: 900));
    await tester.pumpAndSettle();

    expect(find.text('Unable to load'), findsOneWidget);
    expect(
      find.textContaining('Service may still be warming up'),
      findsOneWidget,
    );
  });

  testWidgets('cancel reservation error shows snackbar', (tester) async {
    final repo = _ThrowingCancelRepository();
    final now = DateTime.now();
    final listing = await repo.createListing(
      _input(now, itemType: 'Lunchbox', displayName: 'Acme Charity'),
    );
    await repo.reserveListing(
      listingId: listing.listingId,
      claimerUid: 'test-user',
      qty: 1,
      disclaimerAccepted: true,
    );

    await _pumpPage(tester, repo: repo);
    await tester.tap(find.widgetWithText(OutlinedButton, 'Cancel reservation'));
    await tester.pumpAndSettle();

    expect(find.text('Cancel failed for test.'), findsOneWidget);
  });
}
