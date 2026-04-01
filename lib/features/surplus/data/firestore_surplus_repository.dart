import 'package:cloud_firestore/cloud_firestore.dart';

import '../../../core/utils/id_utils.dart';
import '../../../core/utils/token_utils.dart';
import '../domain/listing.dart';
import '../domain/listing_input.dart';
import '../domain/reservation.dart';
import '../domain/surplus_exceptions.dart';
import '../domain/venue.dart';
import 'seed_venues.dart';
import 'surplus_repository.dart';

class FirestoreSurplusRepository implements SurplusRepository {
  FirestoreSurplusRepository(this._firestore);

  final FirebaseFirestore _firestore;

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

    yield* _reservationsRef
        .where('listingId', isEqualTo: listingId)
        .snapshots()
        .map((snapshot) {
          final reservations =
              snapshot.docs
                  .map((doc) => Reservation.fromMap(doc.data(), id: doc.id))
                  .toList()
                ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
          return reservations;
        });
  }

  @override
  Future<bool> canEditListing({
    required String listingId,
    required String token,
  }) async {
    final listingDoc = await _listingsRef.doc(listingId).get();
    final data = listingDoc.data();
    if (!listingDoc.exists || data == null) {
      return false;
    }

    final hash = data['editTokenHash'] as String? ?? '';
    if (hash.isEmpty) {
      return false;
    }
    return verifyTokenHash(token: token, hash: hash);
  }

  @override
  Future<CreatedListingResult> createListing(ListingInput input) async {
    _validateInput(input);
    final now = DateTime.now();
    final token = generateEditToken();
    final listingRef = _listingsRef.doc();

    final listing = Listing(
      id: listingRef.id,
      venueId: input.venueId,
      pickupPointText: input.pickupPointText,
      itemType: input.itemType,
      description: input.description,
      quantityTotal: input.quantityTotal,
      quantityRemaining: input.quantityTotal,
      price: input.price,
      currency: input.currency,
      pickupStartAt: input.pickupStartAt,
      pickupEndAt: input.pickupEndAt,
      expiresAt: input.expiresAt,
      displayNameOptional: input.displayNameOptional,
      visibility: input.visibility,
      status: ListingStatus.active,
      editTokenHash: hashToken(token),
      createdAt: now,
      updatedAt: now,
    );

    await listingRef.set(listing.toMap());

    return CreatedListingResult(listingId: listingRef.id, editToken: token);
  }

  @override
  Future<void> updateListing({
    required String listingId,
    required String token,
    required ListingInput input,
  }) async {
    _validateInput(input);

    await _firestore.runTransaction((tx) async {
      final listingRef = _listingsRef.doc(listingId);
      final snapshot = await tx.get(listingRef);
      final data = snapshot.data();
      if (!snapshot.exists || data == null) {
        throw const ValidationException('Listing not found.');
      }

      final existing = Listing.fromMap(data, id: snapshot.id);
      if (!verifyTokenHash(token: token, hash: existing.editTokenHash)) {
        throw const PermissionDeniedException('Invalid edit token.');
      }

      final remaining = existing.quantityRemaining
          .clamp(0, input.quantityTotal)
          .toInt();
      final now = DateTime.now();
      tx.update(listingRef, {
        'venueId': input.venueId,
        'pickupPointText': input.pickupPointText,
        'itemType': input.itemType,
        'description': input.description,
        'quantityTotal': input.quantityTotal,
        'quantityRemaining': remaining,
        'price': input.price,
        'currency': input.currency,
        'pickupStartAt': input.pickupStartAt,
        'pickupEndAt': input.pickupEndAt,
        'expiresAt': input.expiresAt,
        'displayNameOptional': input.displayNameOptional,
        'visibility': input.visibility.name,
        'status': remaining == 0
            ? ListingStatus.reserved.name
            : ListingStatus.active.name,
        'updatedAt': now,
      });
    });
  }

  @override
  Future<String> rotateEditToken({
    required String listingId,
    required String token,
  }) async {
    final nextToken = generateEditToken();

    await _firestore.runTransaction((tx) async {
      final listingRef = _listingsRef.doc(listingId);
      final snapshot = await tx.get(listingRef);
      final data = snapshot.data();
      if (!snapshot.exists || data == null) {
        throw const ValidationException('Listing not found.');
      }
      final listing = Listing.fromMap(data, id: snapshot.id);
      if (!verifyTokenHash(token: token, hash: listing.editTokenHash)) {
        throw const PermissionDeniedException('Invalid edit token.');
      }
      tx.update(listingRef, {
        'editTokenHash': hashToken(nextToken),
        'updatedAt': DateTime.now(),
      });
    });

    return nextToken;
  }

  @override
  Future<void> revokeEditToken({
    required String listingId,
    required String token,
  }) async {
    await _firestore.runTransaction((tx) async {
      final listingRef = _listingsRef.doc(listingId);
      final snapshot = await tx.get(listingRef);
      final data = snapshot.data();
      if (!snapshot.exists || data == null) {
        throw const ValidationException('Listing not found.');
      }
      final listing = Listing.fromMap(data, id: snapshot.id);
      if (!verifyTokenHash(token: token, hash: listing.editTokenHash)) {
        throw const PermissionDeniedException('Invalid edit token.');
      }
      tx.update(listingRef, {'editTokenHash': '', 'updatedAt': DateTime.now()});
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

    final reservationRef = _reservationsRef.doc();
    try {
      await _firestore.runTransaction((tx) async {
        final listingRef = _listingsRef.doc(listingId);
        final listingSnapshot = await tx.get(listingRef);
        final data = listingSnapshot.data();
        if (!listingSnapshot.exists || data == null) {
          throw const ValidationException('Listing not found.');
        }

        final listing = Listing.fromMap(data, id: listingSnapshot.id);
        final now = DateTime.now();
        if (!listing.canReserve(now) || listing.quantityRemaining < qty) {
          throw const ValidationException(
            'This listing is no longer available.',
          );
        }

        final nextRemaining = listing.quantityRemaining - qty;
        tx.update(listingRef, {
          'quantityRemaining': nextRemaining,
          'status': nextRemaining == 0
              ? ListingStatus.reserved.name
              : ListingStatus.active.name,
          'updatedAt': now,
        });

        tx.set(reservationRef, {
          'listingId': listingId,
          'claimerUid': claimerUid,
          'qty': qty,
          'pickupCode': randomDigits(length: 4),
          'status': ReservationStatus.reserved.name,
          'createdAt': now,
          'expiresAt': listing.expiresAt,
        });
      });
    } on ValidationException {
      await addAbuseSignal(
        listingId: listingId,
        claimerUid: claimerUid,
        reason: 'reserve_failed_unavailable',
      );
      rethrow;
    }

    final snapshot = await reservationRef.get();
    final reservationData = snapshot.data();
    if (reservationData == null) {
      throw const ValidationException('Reservation could not be created.');
    }
    return Reservation.fromMap(reservationData, id: reservationRef.id);
  }

  @override
  Future<void> confirmPickup({
    required String listingId,
    required String reservationId,
    required String token,
    required String pickupCode,
  }) async {
    try {
      await _firestore.runTransaction((tx) async {
        final listingRef = _listingsRef.doc(listingId);
        final reservationRef = _reservationsRef.doc(reservationId);

        final listingSnap = await tx.get(listingRef);
        final reservationSnap = await tx.get(reservationRef);

        final listingData = listingSnap.data();
        final reservationData = reservationSnap.data();

        if (!listingSnap.exists || listingData == null) {
          throw const ValidationException('Listing not found.');
        }
        if (!reservationSnap.exists || reservationData == null) {
          throw const ValidationException('Reservation not found.');
        }

        final listing = Listing.fromMap(listingData, id: listingId);
        final reservation = Reservation.fromMap(
          reservationData,
          id: reservationId,
        );

        if (!verifyTokenHash(token: token, hash: listing.editTokenHash)) {
          throw const PermissionDeniedException('Invalid edit token.');
        }
        if (reservation.status != ReservationStatus.reserved) {
          throw const ValidationException('Reservation is not active.');
        }
        if (reservation.pickupCode != pickupCode) {
          throw const ValidationException('Pickup code does not match.');
        }

        tx.update(reservationRef, {'status': ReservationStatus.completed.name});
        if (listing.quantityRemaining == 0) {
          tx.update(listingRef, {
            'status': ListingStatus.completed.name,
            'updatedAt': DateTime.now(),
          });
        }
      });
    } on ValidationException {
      final reservation = await _reservationsRef.doc(reservationId).get();
      final data = reservation.data();
      final uid = data?['claimerUid'] as String? ?? 'unknown';
      await addAbuseSignal(
        listingId: listingId,
        claimerUid: uid,
        reason: 'pickup_code_mismatch',
      );
      rethrow;
    }
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
}
