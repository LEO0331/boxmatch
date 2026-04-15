import 'package:boxmatch/features/surplus/domain/listing_input.dart';
import 'package:boxmatch/features/surplus/domain/listing_visibility.dart';
import 'package:boxmatch/features/surplus/presentation/enterprise/enterprise_listing_page.dart';
import 'package:flutter_test/flutter_test.dart';

ListingInput _input({
  required DateTime now,
  required DateTime pickupStartAt,
  required DateTime pickupEndAt,
  required DateTime expiresAt,
}) {
  return ListingInput(
    venueId: 'taipei-nangang-exhibition-center-hall-1',
    pickupPointText: 'Booth E-3',
    itemType: 'Lunchbox',
    description: 'Enterprise test item',
    quantityTotal: 2,
    price: 0,
    currency: 'TWD',
    pickupStartAt: pickupStartAt,
    pickupEndAt: pickupEndAt,
    expiresAt: expiresAt,
    visibility: ListingVisibility.minimal,
    disclaimerAccepted: true,
  );
}

void main() {
  group('collectRiskWarningsForListingInput', () {
    test('returns all risk warnings when timing is aggressive', () {
      final now = DateTime(2026, 4, 2, 10, 0);
      final input = _input(
        now: now,
        pickupStartAt: now.add(const Duration(minutes: 5)),
        pickupEndAt: now.add(const Duration(minutes: 30)),
        expiresAt: now.add(const Duration(minutes: 40)),
      );

      final warnings = collectRiskWarningsForListingInput(input, now: now);

      expect(warnings, hasLength(3));
      expect(warnings.first, contains('Pickup window is short'));
      expect(warnings[1], contains('Pickup start is very soon'));
      expect(warnings[2], contains('Expiry is close to pickup start'));
    });

    test('returns empty list for healthy timing', () {
      final now = DateTime(2026, 4, 2, 10, 0);
      final input = _input(
        now: now,
        pickupStartAt: now.add(const Duration(minutes: 30)),
        pickupEndAt: now.add(const Duration(hours: 2)),
        expiresAt: now.add(const Duration(hours: 3)),
      );

      final warnings = collectRiskWarningsForListingInput(input, now: now);
      expect(warnings, isEmpty);
    });
  });

  group('resolveTemplateIdForListingMap', () {
    test('uses explicit template id when valid', () {
      final templateId = resolveTemplateIdForListingMap({'templateId': 'drinks'});
      expect(templateId, 'drinks');
    });

    test('falls back by itemType + description', () {
      final templateId = resolveTemplateIdForListingMap({
        'itemType': 'Drink',
        'description': 'Sealed bottled drinks, room temperature.',
      });
      expect(templateId, 'drinks');
    });

    test('falls back to default when no match', () {
      final templateId = resolveTemplateIdForListingMap({
        'itemType': 'Unknown',
        'description': 'Custom copy',
      });
      expect(templateId, 'default');
    });
  });

  group('computeTemplatePerformance', () {
    test('computes and sorts performance by completion/cancel/sample', () {
      final listingToTemplate = <String, String>{
        'l1': 'lunchbox',
        'l2': 'drinks',
        'l3': 'drinks',
      };
      final reservations = <Map<String, dynamic>>[
        {'listingId': 'l1', 'status': 'completed'},
        {'listingId': 'l1', 'status': 'reserved'},
        {'listingId': 'l2', 'status': 'completed'},
        {'listingId': 'l2', 'status': 'completed'},
        {'listingId': 'l2', 'status': 'cancelled'},
        {'listingId': 'l3', 'status': 'reserved'},
        {'listingId': 'missing', 'status': 'completed'},
      ];

      final result = computeTemplatePerformance(
        listingToTemplate: listingToTemplate,
        reservations: reservations,
      );

      expect(result, hasLength(2));
      expect(result.first.templateId, 'lunchbox');
      expect(result.first.totalReservations, 2);
      expect(result.first.completedReservations, 1);
      expect(result.first.cancelledReservations, 0);
      expect(result.first.completedRate, closeTo(0.5, 0.0001));

      expect(result[1].templateId, 'drinks');
      expect(result[1].totalReservations, 4);
      expect(result[1].completedReservations, 2);
      expect(result[1].cancelledReservations, 1);
      expect(result[1].completedRate, closeTo(0.5, 0.0001));
      expect(result[1].cancelledRate, closeTo(0.25, 0.0001));
    });
  });
}
