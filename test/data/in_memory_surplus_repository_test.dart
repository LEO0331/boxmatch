import 'package:boxmatch/features/surplus/data/in_memory_surplus_repository.dart';
import 'package:boxmatch/features/surplus/domain/listing.dart';
import 'package:boxmatch/features/surplus/domain/listing_input.dart';
import 'package:boxmatch/features/surplus/domain/listing_visibility.dart';
import 'package:boxmatch/features/surplus/domain/surplus_exceptions.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  ListingInput buildInput(DateTime start, DateTime end, DateTime expiry) {
    return ListingInput(
      venueId: 'taipei-nangang-exhibition-center-hall-1',
      pickupPointText: 'Booth B-12',
      itemType: 'Lunchbox',
      description: 'Warm rice meal',
      quantityTotal: 2,
      price: 0,
      currency: 'TWD',
      pickupStartAt: start,
      pickupEndAt: end,
      expiresAt: expiry,
      visibility: ListingVisibility.minimal,
      disclaimerAccepted: true,
    );
  }

  test(
    'reservation prevents overbooking with remaining inventory checks',
    () async {
      var now = DateTime(2026, 4, 1, 9);
      final repository = InMemorySurplusRepository(now: () => now);

      final create = await repository.createListing(
        buildInput(
          now,
          now.add(const Duration(hours: 1)),
          now.add(const Duration(hours: 2)),
        ),
      );

      await repository.reserveListing(
        listingId: create.listingId,
        claimerUid: 'u1',
        qty: 1,
        disclaimerAccepted: true,
      );
      await repository.reserveListing(
        listingId: create.listingId,
        claimerUid: 'u2',
        qty: 1,
        disclaimerAccepted: true,
      );

      expect(
        () => repository.reserveListing(
          listingId: create.listingId,
          claimerUid: 'u3',
          qty: 1,
          disclaimerAccepted: true,
        ),
        throwsA(isA<ValidationException>()),
      );
    },
  );

  test('cannot update listing with invalid token', () async {
    final now = DateTime(2026, 4, 1, 9);
    final repository = InMemorySurplusRepository(now: () => now);

    final create = await repository.createListing(
      buildInput(
        now,
        now.add(const Duration(hours: 1)),
        now.add(const Duration(hours: 2)),
      ),
    );

    expect(
      () => repository.updateListing(
        listingId: create.listingId,
        token: 'invalid-token',
        input: buildInput(
          now,
          now.add(const Duration(hours: 1)),
          now.add(const Duration(hours: 2)),
        ),
      ),
      throwsA(isA<PermissionDeniedException>()),
    );
  });

  test('reconcile marks listing as expired', () async {
    var now = DateTime(2026, 4, 1, 9);
    final repository = InMemorySurplusRepository(now: () => now);

    final create = await repository.createListing(
      buildInput(
        now,
        now.add(const Duration(minutes: 30)),
        now.add(const Duration(minutes: 45)),
      ),
    );

    now = now.add(const Duration(hours: 1));
    await repository.reconcileExpiredListings();

    final listing = await repository.watchListing(create.listingId).first;
    expect(listing?.status, ListingStatus.expired);
  });
}
