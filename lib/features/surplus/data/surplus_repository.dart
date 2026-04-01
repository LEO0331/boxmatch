import '../domain/listing.dart';
import '../domain/listing_input.dart';
import '../domain/reservation.dart';
import '../domain/venue.dart';

abstract interface class SurplusRepository {
  Future<void> ensureSeedData();

  Stream<List<Venue>> watchVenues();

  Stream<List<Listing>> watchActiveListings();

  Stream<Listing?> watchListing(String listingId);

  Stream<Reservation?> watchReservation(String reservationId);

  Stream<List<Reservation>> watchReservationsForListing({
    required String listingId,
    required String token,
  });

  Future<bool> canEditListing({
    required String listingId,
    required String token,
  });

  Future<CreatedListingResult> createListing(ListingInput input);

  Future<void> updateListing({
    required String listingId,
    required String token,
    required ListingInput input,
  });

  Future<String> rotateEditToken({
    required String listingId,
    required String token,
  });

  Future<void> revokeEditToken({
    required String listingId,
    required String token,
  });

  Future<Reservation> reserveListing({
    required String listingId,
    required String claimerUid,
    required int qty,
    required bool disclaimerAccepted,
  });

  Future<void> confirmPickup({
    required String listingId,
    required String reservationId,
    required String token,
    required String pickupCode,
  });

  Future<int> reconcileExpiredListings();

  Future<void> addAbuseSignal({
    required String listingId,
    required String claimerUid,
    required String reason,
  });
}
