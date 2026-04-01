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

  test('canReserve only true when active and has remaining', () {
    final listing = buildListing(
      remaining: 2,
      expiresAt: now.add(const Duration(minutes: 30)),
    );
    expect(listing.canReserve(now), isTrue);

    final noStock = listing.copyWith(quantityRemaining: 0);
    expect(noStock.canReserve(now), isFalse);

    final expired = listing.copyWith(
      expiresAt: now.subtract(const Duration(minutes: 1)),
    );
    expect(expired.canReserve(now), isFalse);
  });

  test('fromMap + toMap + copyWith roundtrip', () {
    final map = {
      'venueId': 'v2',
      'pickupPointText': 'Gate B',
      'itemType': 'Drink',
      'description': 'Bottle water',
      'quantityTotal': 5,
      'quantityRemaining': 4,
      'price': 0,
      'currency': 'TWD',
      'pickupStartAt': now.toIso8601String(),
      'pickupEndAt': now.add(const Duration(hours: 1)).millisecondsSinceEpoch,
      'expiresAt': now.add(const Duration(hours: 2)),
      'displayNameOptional': 'Booth D',
      'visibility': 'minimal',
      'status': 'active',
      'editTokenHash': 'hash-2',
      'createdAt': now.toIso8601String(),
      'updatedAt': now.toIso8601String(),
    };

    final listing = Listing.fromMap(map, id: 'l2');
    expect(listing.id, 'l2');
    expect(listing.venueId, 'v2');
    expect(listing.hasRemaining, isTrue);

    final updated = listing.copyWith(description: 'Updated');
    expect(updated.description, 'Updated');

    final out = updated.toMap();
    expect(out['itemType'], 'Drink');
    expect(out['editTokenHash'], 'hash-2');
  });
}
