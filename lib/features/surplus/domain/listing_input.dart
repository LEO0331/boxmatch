import 'listing_visibility.dart';

class ListingInput {
  const ListingInput({
    required this.venueId,
    required this.pickupPointText,
    required this.itemType,
    required this.description,
    required this.quantityTotal,
    required this.price,
    required this.currency,
    required this.pickupStartAt,
    required this.pickupEndAt,
    required this.expiresAt,
    required this.visibility,
    required this.disclaimerAccepted,
    this.displayNameOptional,
  });

  final String venueId;
  final String pickupPointText;
  final String itemType;
  final String description;
  final int quantityTotal;
  final double price;
  final String currency;
  final DateTime pickupStartAt;
  final DateTime pickupEndAt;
  final DateTime expiresAt;
  final String? displayNameOptional;
  final ListingVisibility visibility;
  final bool disclaimerAccepted;
}

class CreatedListingResult {
  const CreatedListingResult({
    required this.listingId,
    required this.editToken,
  });

  final String listingId;
  final String editToken;
}
