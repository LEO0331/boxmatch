import 'package:boxmatch/features/surplus/domain/reservation.dart';
import 'package:boxmatch/features/surplus/domain/venue.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('reservation fromMap + copyWith + toMap work', () {
    final createdAt = DateTime.utc(2026, 4, 1, 9);
    final expiresAt = DateTime.utc(2026, 4, 1, 12);

    final reservation = Reservation.fromMap({
      'listingId': 'l1',
      'claimerUid': 'u1',
      'qty': 2,
      'pickupCode': '1234',
      'status': 'reserved',
      'createdAt': createdAt.toIso8601String(),
      'expiresAt': expiresAt.millisecondsSinceEpoch,
    }, id: 'r1');

    expect(reservation.id, 'r1');
    expect(reservation.isActive, isTrue);
    expect(reservation.qty, 2);

    final completed = reservation.copyWith(status: ReservationStatus.completed);
    expect(completed.status, ReservationStatus.completed);

    final map = completed.toMap();
    expect(map['listingId'], 'l1');
    expect(map['pickupCode'], '1234');
  });

  test('venue fromMap prefers explicit id and toMap includes fields', () {
    final venue = Venue.fromMap({
      'id': 'from-map',
      'name': 'Taipei Hall',
      'address': 'Taipei',
      'latitude': 25.05,
      'longitude': 121.56,
    }, id: 'explicit-id');

    expect(venue.id, 'explicit-id');
    expect(venue.name, 'Taipei Hall');
    expect(venue.toMap()['address'], 'Taipei');
  });
}
