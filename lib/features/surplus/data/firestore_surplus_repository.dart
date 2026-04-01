import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:http/http.dart' as http;

import '../domain/listing.dart';
import '../domain/listing_input.dart';
import '../domain/reservation.dart';
import '../domain/surplus_exceptions.dart';
import '../domain/venue.dart';
import 'seed_venues.dart';
import 'surplus_repository.dart';

class FirestoreSurplusRepository implements SurplusRepository {
  FirestoreSurplusRepository(
    this._firestore, {
    required String apiBaseUrl,
    http.Client? httpClient,
  }) : _apiBaseUrl = apiBaseUrl,
       _http = httpClient ?? http.Client();

  final FirebaseFirestore _firestore;
  final String _apiBaseUrl;
  final http.Client _http;

  CollectionReference<Map<String, dynamic>> get _venuesRef =>
      _firestore.collection('venues');
  CollectionReference<Map<String, dynamic>> get _listingsRef =>
      _firestore.collection('listings');
  CollectionReference<Map<String, dynamic>> get _reservationsRef =>
      _firestore.collection('reservations');
  CollectionReference<Map<String, dynamic>> get _abuseSignalsRef =>
      _firestore.collection('abuse_signals');

  @override
  Future<void> ensureSeedData() async {
    final existing = await _venuesRef.limit(1).get();
    if (existing.docs.isNotEmpty) {
      return;
    }

    final batch = _firestore.batch();
    for (final venue in seededVenues) {
      batch.set(_venuesRef.doc(venue.id), venue.toMap());
    }
    await batch.commit();
  }

  @override
  Stream<List<Venue>> watchVenues() {
    return _venuesRef.snapshots().map((snapshot) {
      final venues =
          snapshot.docs
              .map((doc) => Venue.fromMap(doc.data(), id: doc.id))
              .toList()
            ..sort((a, b) => a.name.compareTo(b.name));
      return venues;
    });
  }

  @override
  Stream<List<Listing>> watchActiveListings() {
    final now = Timestamp.fromDate(DateTime.now());
    return _listingsRef
        .where('expiresAt', isGreaterThan: now)
        .where('status', whereIn: const ['active', 'reserved'])
        .snapshots()
        .map((snapshot) {
          final listings =
              snapshot.docs
                  .map((doc) => Listing.fromMap(doc.data(), id: doc.id))
                  .toList()
                ..sort((a, b) => a.expiresAt.compareTo(b.expiresAt));
          return listings;
        });
  }

  @override
  Stream<Listing?> watchListing(String listingId) {
    return _listingsRef.doc(listingId).snapshots().map((doc) {
      if (!doc.exists || doc.data() == null) {
        return null;
      }
      return Listing.fromMap(doc.data()!, id: doc.id);
    });
  }

  @override
  Stream<Reservation?> watchReservation(String reservationId) {
    return _reservationsRef.doc(reservationId).snapshots().map((doc) {
      if (!doc.exists || doc.data() == null) {
        return null;
      }
      return Reservation.fromMap(doc.data()!, id: doc.id);
    });
  }

  @override
  Stream<List<Reservation>> watchReservationsForListing({
    required String listingId,
    required String token,
  }) async* {
    final isAllowed = await canEditListing(listingId: listingId, token: token);
    if (!isAllowed) {
      throw const PermissionDeniedException('Invalid edit token.');
    }
    while (true) {
      yield await _fetchEnterpriseReservations(
        listingId: listingId,
        token: token,
      );
      await Future<void>.delayed(const Duration(seconds: 8));
    }
  }

  @override
  Future<bool> canEditListing({
    required String listingId,
    required String token,
  }) async {
    try {
      final response = await _postJson(
        '/enterprise/listings/$listingId/validate-token',
        {'token': token},
      );
      return response['ok'] == true;
    } on SurplusException {
      return false;
    }
  }

  @override
  Future<CreatedListingResult> createListing(ListingInput input) async {
    _validateInput(input);

    final response = await _postJson('/enterprise/listings/create', {
      'data': _listingInputToApiData(input),
    });

    final listingId = response['listingId'] as String?;
    final token = response['token'] as String?;
    if (listingId == null || token == null) {
      throw const ValidationException('Invalid create response from server.');
    }

    return CreatedListingResult(listingId: listingId, editToken: token);
  }

  @override
  Future<void> updateListing({
    required String listingId,
    required String token,
    required ListingInput input,
  }) async {
    _validateInput(input);

    await _postJson('/enterprise/listings/$listingId/update', {
      'token': token,
      'data': _listingInputToApiData(input),
    });
  }

  @override
  Future<String> rotateEditToken({
    required String listingId,
    required String token,
  }) async {
    final response = await _postJson(
      '/enterprise/listings/$listingId/rotate-token',
      {'token': token},
    );

    final nextToken = response['token'] as String?;
    if (nextToken == null || nextToken.isEmpty) {
      throw const ValidationException('Failed to rotate token.');
    }
    return nextToken;
  }

  @override
  Future<void> revokeEditToken({
    required String listingId,
    required String token,
  }) async {
    await _postJson('/enterprise/listings/$listingId/revoke-token', {
      'token': token,
    });
  }

  @override
  Future<Reservation> reserveListing({
    required String listingId,
    required String claimerUid,
    required int qty,
    required bool disclaimerAccepted,
  }) async {
    if (!disclaimerAccepted) {
      throw const ValidationException(
        'Please accept the disclaimer before reserving.',
      );
    }
    final response = await _postJson('/recipient/listings/$listingId/reserve', {
      'claimerUid': claimerUid,
      'qty': qty,
      'disclaimerAccepted': disclaimerAccepted,
    });
    final raw = response['reservation'];
    if (raw is! Map) {
      throw const ValidationException(
        'Invalid reservation response from server.',
      );
    }
    final map = Map<String, dynamic>.from(raw);
    final id = map.remove('id') as String? ?? '';
    if (id.isEmpty) {
      throw const ValidationException('Reservation response missing id.');
    }
    return Reservation.fromMap(map, id: id);
  }

  @override
  Future<void> confirmPickup({
    required String listingId,
    required String reservationId,
    required String token,
    required String pickupCode,
  }) async {
    await _postJson('/enterprise/listings/$listingId/confirm-pickup', {
      'token': token,
      'reservationId': reservationId,
      'pickupCode': pickupCode,
    });
  }

  @override
  Future<int> reconcileExpiredListings() async {
    final now = DateTime.now();
    final expiredListings = await _listingsRef
        .where('expiresAt', isLessThanOrEqualTo: Timestamp.fromDate(now))
        .where('status', whereIn: const ['active', 'reserved'])
        .get();

    var updates = 0;
    for (final doc in expiredListings.docs) {
      await doc.reference.update({
        'status': ListingStatus.expired.name,
        'updatedAt': now,
      });
      updates++;
    }

    final expiredReservations = await _reservationsRef
        .where('expiresAt', isLessThanOrEqualTo: Timestamp.fromDate(now))
        .where('status', isEqualTo: ReservationStatus.reserved.name)
        .get();

    for (final doc in expiredReservations.docs) {
      await doc.reference.update({'status': ReservationStatus.expired.name});
      updates++;
    }

    return updates;
  }

  @override
  Future<void> addAbuseSignal({
    required String listingId,
    required String claimerUid,
    required String reason,
  }) async {
    await _abuseSignalsRef.add({
      'listingId': listingId,
      'claimerUid': claimerUid,
      'reason': reason,
      'createdAt': DateTime.now(),
    });
  }

  void _validateInput(ListingInput input) {
    if (!input.disclaimerAccepted) {
      throw const ValidationException(
        'Please accept the food safety disclaimer.',
      );
    }
    if (input.venueId.isEmpty) {
      throw const ValidationException('Please select a venue.');
    }
    if (input.quantityTotal <= 0) {
      throw const ValidationException('Quantity must be at least 1.');
    }
    if (!input.pickupEndAt.isAfter(input.pickupStartAt)) {
      throw const ValidationException(
        'Pickup end time must be after start time.',
      );
    }
    if (!input.expiresAt.isAfter(input.pickupStartAt)) {
      throw const ValidationException(
        'Expiry time must be after pickup start time.',
      );
    }
  }

  Map<String, dynamic> _listingInputToApiData(ListingInput input) {
    return {
      'venueId': input.venueId,
      'pickupPointText': input.pickupPointText,
      'itemType': input.itemType,
      'description': input.description,
      'quantityTotal': input.quantityTotal,
      'pickupStartAt': input.pickupStartAt.toUtc().toIso8601String(),
      'pickupEndAt': input.pickupEndAt.toUtc().toIso8601String(),
      'expiresAt': input.expiresAt.toUtc().toIso8601String(),
      'displayNameOptional': input.displayNameOptional,
      'visibility': input.visibility.name,
    };
  }

  Future<Map<String, dynamic>> _postJson(
    String path,
    Map<String, dynamic> payload,
  ) async {
    final uri = Uri.parse('${_apiBaseUrl.replaceAll(RegExp(r'/+$'), '')}$path');
    final response = await _http.post(
      uri,
      headers: {'content-type': 'application/json'},
      body: jsonEncode(payload),
    );

    Map<String, dynamic> body = const {};
    if (response.body.isNotEmpty) {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) {
        body = decoded;
      }
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return body;
    }

    final message = (body['error'] as String?)?.trim();
    final resolvedMessage = (message != null && message.isNotEmpty)
        ? message
        : 'Request failed with status ${response.statusCode}.';

    if (response.statusCode == 403) {
      throw PermissionDeniedException(resolvedMessage);
    }
    throw ValidationException(resolvedMessage);
  }

  Future<List<Reservation>> _fetchEnterpriseReservations({
    required String listingId,
    required String token,
  }) async {
    final response = await _postJson(
      '/enterprise/listings/$listingId/reservations',
      {'token': token},
    );
    final raw = response['reservations'];
    if (raw is! List) {
      return const <Reservation>[];
    }

    final reservations = raw.whereType<Map>().map((entry) {
      final map = Map<String, dynamic>.from(entry);
      final id = map.remove('id') as String? ?? '';
      return Reservation.fromMap(map, id: id);
    }).toList()..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return reservations;
  }
}
