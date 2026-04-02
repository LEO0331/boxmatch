import 'dart:async';

import '../../../core/utils/id_utils.dart';
import '../../../core/utils/token_utils.dart';
import '../domain/listing.dart';
import '../domain/listing_input.dart';
import '../domain/reservation.dart';
import '../domain/surplus_exceptions.dart';
import '../domain/venue.dart';
import 'seed_venues.dart';
import 'surplus_repository.dart';

class InMemorySurplusRepository implements SurplusRepository {
  InMemorySurplusRepository({DateTime Function()? now})
    : _now = now ?? DateTime.now {
    for (final venue in seededVenues) {
      _venues[venue.id] = venue;
    }
    _emitAll();
  }

  final DateTime Function() _now;
  final Map<String, Venue> _venues = {};
  final Map<String, Listing> _listings = {};
  final Map<String, Reservation> _reservations = {};
  final Map<String, String> _abuseSignals = {};

  final _venuesController = StreamController<List<Venue>>.broadcast();
  final _listingsController = StreamController<List<Listing>>.broadcast();
  final _reservationsController =
      StreamController<List<Reservation>>.broadcast();

  @override
  Future<void> ensureSeedData() async {
    _emitVenues();
  }

  @override
  Stream<List<Venue>> watchVenues() async* {
    yield _sortedVenues();
    yield* _venuesController.stream;
  }

  @override
  Stream<List<Listing>> watchActiveListings() async* {
    yield _activeListings();
    yield* _listingsController.stream.map((_) => _activeListings());
  }

  @override
  Stream<Listing?> watchListing(String listingId) async* {
    yield _listings[listingId];
    yield* _listingsController.stream.map((_) => _listings[listingId]);
  }

  @override
  Stream<Reservation?> watchReservation(String reservationId) async* {
    yield _reservations[reservationId];
    yield* _reservationsController.stream.map(
      (_) => _reservations[reservationId],
    );
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
    yield _reservationsByListing(listingId);
    yield* _reservationsController.stream.map(
      (_) => _reservationsByListing(listingId),
    );
  }

  @override
  Future<bool> canEditListing({
    required String listingId,
    required String token,
  }) async {
    final listing = _listings[listingId];
    if (listing == null || listing.editTokenHash.isEmpty) {
      return false;
    }
    return verifyTokenHash(token: token, hash: listing.editTokenHash);
  }

  @override
  Future<CreatedListingResult> createListing(ListingInput input) async {
    _validateInput(input);
    final now = _now();
    final listingId = randomId();
    final token = generateEditToken();
    final listing = Listing(
      id: listingId,
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

    _listings[listingId] = listing;
    _emitListings();

    return CreatedListingResult(listingId: listingId, editToken: token);
  }

  @override
  Future<void> updateListing({
    required String listingId,
    required String token,
    required ListingInput input,
  }) async {
    _validateInput(input);
    final listing = _listings[listingId];
    if (listing == null) {
      throw const ValidationException('Listing not found.');
    }
    _ensureEditable(listing, token);

    final safeRemaining = listing.quantityRemaining.clamp(
      0,
      input.quantityTotal,
    );
    _listings[listingId] = listing.copyWith(
      venueId: input.venueId,
      pickupPointText: input.pickupPointText,
      itemType: input.itemType,
      description: input.description,
      quantityTotal: input.quantityTotal,
      quantityRemaining: safeRemaining,
      price: input.price,
      currency: input.currency,
      pickupStartAt: input.pickupStartAt,
      pickupEndAt: input.pickupEndAt,
      expiresAt: input.expiresAt,
      displayNameOptional: input.displayNameOptional,
      visibility: input.visibility,
      updatedAt: _now(),
      status: ListingStatus.active,
    );
    await reconcileExpiredListings();
    _emitListings();
  }

  @override
  Future<String> rotateEditToken({
    required String listingId,
    required String token,
  }) async {
    final listing = _listings[listingId];
    if (listing == null) {
      throw const ValidationException('Listing not found.');
    }
    _ensureEditable(listing, token);

    final nextToken = generateEditToken();
    _listings[listingId] = listing.copyWith(
      editTokenHash: hashToken(nextToken),
      updatedAt: _now(),
    );
    _emitListings();
    return nextToken;
  }

  @override
  Future<void> revokeEditToken({
    required String listingId,
    required String token,
  }) async {
    final listing = _listings[listingId];
    if (listing == null) {
      throw const ValidationException('Listing not found.');
    }
    _ensureEditable(listing, token);

    _listings[listingId] = listing.copyWith(
      editTokenHash: '',
      updatedAt: _now(),
    );
    _emitListings();
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

    final listing = _listings[listingId];
    if (listing == null) {
      throw const ValidationException('Listing not found.');
    }

    final now = _now();
    final status = listing.resolvedStatus(now);
    if (status != ListingStatus.active || listing.quantityRemaining < qty) {
      await addAbuseSignal(
        listingId: listingId,
        claimerUid: claimerUid,
        reason: 'reserve_failed_unavailable',
      );
      throw const ValidationException('This listing is no longer available.');
    }

    final updatedRemaining = listing.quantityRemaining - qty;
    final updatedStatus = updatedRemaining == 0
        ? ListingStatus.reserved
        : ListingStatus.active;
    _listings[listingId] = listing.copyWith(
      quantityRemaining: updatedRemaining,
      status: updatedStatus,
      updatedAt: now,
    );

    final reservation = Reservation(
      id: randomId(),
      listingId: listingId,
      claimerUid: claimerUid,
      qty: qty,
      pickupCode: randomDigits(length: 4),
      status: ReservationStatus.reserved,
      createdAt: now,
      expiresAt: listing.expiresAt,
    );

    _reservations[reservation.id] = reservation;
    _emitListings();
    _emitReservations();
    return reservation;
  }

  @override
  Future<List<Reservation>> listRecipientReservations({
    required String claimerUid,
  }) async {
    final items = _reservations.values
        .where((item) => item.claimerUid == claimerUid)
        .toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return items;
  }

  @override
  Future<void> cancelReservation({
    required String reservationId,
    required String claimerUid,
  }) async {
    final reservation = _reservations[reservationId];
    if (reservation == null) {
      throw const ValidationException('Reservation not found.');
    }
    if (reservation.claimerUid != claimerUid) {
      throw const PermissionDeniedException('Reservation does not belong to you.');
    }
    if (reservation.status != ReservationStatus.reserved) {
      throw const ValidationException('Reservation is not active.');
    }

    final listing = _listings[reservation.listingId];
    if (listing == null) {
      throw const ValidationException('Listing not found.');
    }

    final now = _now();
    final nextRemaining = (listing.quantityRemaining + reservation.qty).clamp(
      0,
      listing.quantityTotal,
    );
    final nextStatus = listing.isExpiredAt(now)
        ? ListingStatus.expired
        : (nextRemaining <= 0 ? ListingStatus.reserved : ListingStatus.active);

    _reservations[reservationId] = reservation.copyWith(
      status: ReservationStatus.cancelled,
    );
    _listings[listing.id] = listing.copyWith(
      quantityRemaining: nextRemaining,
      status: nextStatus,
      updatedAt: now,
    );

    _emitReservations();
    _emitListings();
  }

  @override
  Future<void> confirmPickup({
    required String listingId,
    required String reservationId,
    required String token,
    required String pickupCode,
  }) async {
    final listing = _listings[listingId];
    if (listing == null) {
      throw const ValidationException('Listing not found.');
    }
    _ensureEditable(listing, token);

    final reservation = _reservations[reservationId];
    if (reservation == null || reservation.listingId != listingId) {
      throw const ValidationException('Reservation not found.');
    }
    if (reservation.status != ReservationStatus.reserved) {
      throw const ValidationException('Reservation is not active.');
    }
    if (reservation.pickupCode != pickupCode) {
      await addAbuseSignal(
        listingId: listingId,
        claimerUid: reservation.claimerUid,
        reason: 'pickup_code_mismatch',
      );
      throw const ValidationException('Pickup code does not match.');
    }

    _reservations[reservationId] = reservation.copyWith(
      status: ReservationStatus.completed,
    );
    if (listing.quantityRemaining == 0) {
      _listings[listingId] = listing.copyWith(
        status: ListingStatus.completed,
        updatedAt: _now(),
      );
    }
    _emitReservations();
    _emitListings();
  }

  @override
  Future<int> reconcileExpiredListings() async {
    final now = _now();
    var updates = 0;

    for (final entry in _listings.entries.toList()) {
      final listing = entry.value;
      final resolved = listing.resolvedStatus(now);
      if (resolved != listing.status) {
        _listings[entry.key] = listing.copyWith(
          status: resolved,
          updatedAt: now,
        );
        updates++;
      }
    }

    for (final entry in _reservations.entries.toList()) {
      final reservation = entry.value;
      if (reservation.status == ReservationStatus.reserved &&
          (reservation.expiresAt.isBefore(now) ||
              reservation.expiresAt.isAtSameMomentAs(now))) {
        _reservations[entry.key] = reservation.copyWith(
          status: ReservationStatus.expired,
        );
        updates++;
      }
    }

    if (updates > 0) {
      _emitListings();
      _emitReservations();
    }

    return updates;
  }

  @override
  Future<void> addAbuseSignal({
    required String listingId,
    required String claimerUid,
    required String reason,
  }) async {
    _abuseSignals[randomId()] =
        '$listingId|$claimerUid|$reason|${_now().toIso8601String()}';
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

  void _ensureEditable(Listing listing, String token) {
    if (listing.editTokenHash.isEmpty ||
        !verifyTokenHash(token: token, hash: listing.editTokenHash)) {
      throw const PermissionDeniedException('Invalid edit token.');
    }
  }

  List<Venue> _sortedVenues() {
    final items = _venues.values.toList()
      ..sort((a, b) => a.name.compareTo(b.name));
    return items;
  }

  List<Listing> _activeListings() {
    final now = _now();
    final items =
        _listings.values
            .where(
              (item) =>
                  item.resolvedStatus(now) == ListingStatus.active ||
                  item.resolvedStatus(now) == ListingStatus.reserved,
            )
            .where((item) => item.expiresAt.isAfter(now))
            .toList()
          ..sort((a, b) => a.expiresAt.compareTo(b.expiresAt));
    return items;
  }

  List<Reservation> _reservationsByListing(String listingId) {
    final items =
        _reservations.values.where((r) => r.listingId == listingId).toList()
          ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return items;
  }

  void _emitAll() {
    _emitVenues();
    _emitListings();
    _emitReservations();
  }

  void _emitVenues() {
    _venuesController.add(_sortedVenues());
  }

  void _emitListings() {
    _listingsController.add(_listings.values.toList());
  }

  void _emitReservations() {
    _reservationsController.add(_reservations.values.toList());
  }
}
