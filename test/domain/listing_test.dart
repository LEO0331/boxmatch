import 'package:boxmatch/features/surplus/domain/listing.dart';
import 'package:boxmatch/features/surplus/domain/listing_visibility.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final now = DateTime(2026, 4, 1, 12, 0);

  Listing buildListing({
    required int remaining,
    required DateTime expiresAt,
    ListingStatus status = ListingStatus.active,
  }) {
    return Listing(
      id: 'id-1',
      venueId: 'venue-1',
      pickupPointText: 'Booth A',
      itemType: 'Lunchbox',
      description: 'Veg meal',
      quantityTotal: 10,
      quantityRemaining: remaining,
      price: 0,
      currency: 'TWD',
      pickupStartAt: now,
      pickupEndAt: now.add(const Duration(hours: 1)),
      expiresAt: expiresAt,
      displayNameOptional: null,
      visibility: ListingVisibility.minimal,
      status: status,
      editTokenHash: 'hash',
      createdAt: now,
      updatedAt: now,
    );
  }

  test('listing transitions to reserved when quantity reaches zero', () {
    final listing = buildListing(
      remaining: 0,
      expiresAt: now.add(const Duration(hours: 2)),
    );
    expect(listing.resolvedStatus(now), ListingStatus.reserved);
  });

  test('listing transitions to expired after expiry time', () {
    final listing = buildListing(
      remaining: 3,
      expiresAt: now.subtract(const Duration(minutes: 1)),
    );
    expect(listing.resolvedStatus(now), ListingStatus.expired);
  });

  test('completed status stays completed', () {
    final listing = buildListing(
      remaining: 0,
      expiresAt: now.subtract(const Duration(minutes: 1)),
      status: ListingStatus.completed,
    );
    expect(listing.resolvedStatus(now), ListingStatus.completed);
  });
}
