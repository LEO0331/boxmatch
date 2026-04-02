import 'package:boxmatch/app/app_scope.dart';
import 'package:boxmatch/features/surplus/data/in_memory_surplus_repository.dart';
import 'package:boxmatch/features/surplus/domain/listing_input.dart';
import 'package:boxmatch/features/surplus/domain/listing_visibility.dart';
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

void main() {
  testWidgets('shows privacy/faq and frequent enterprise badge', (
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
    expect(find.text('Frequent enterprise'), findsNWidgets(2));
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
}
