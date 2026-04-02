import 'listing_visibility.dart';

DateTime _readDateTime(Object? raw) {
  if (raw is DateTime) {
    return raw;
  }
  if (raw is int) {
    return DateTime.fromMillisecondsSinceEpoch(raw);
  }
  if (raw is String) {
    return DateTime.tryParse(raw) ?? DateTime.fromMillisecondsSinceEpoch(0);
  }
  if (raw != null) {
    final dynamic value = raw;
    try {
      return value.toDate() as DateTime;
    } catch (_) {
      // no-op
    }
  }
  return DateTime.fromMillisecondsSinceEpoch(0);
}

enum ListingStatus { active, reserved, expired, completed }

extension ListingStatusX on ListingStatus {
  static ListingStatus fromName(String? raw) {
    for (final value in ListingStatus.values) {
      if (value.name == raw) {
        return value;
      }
    }
    return ListingStatus.active;
  }
}

class Listing {
  const Listing({
    required this.id,
    required this.venueId,
    required this.pickupPointText,
    required this.itemType,
    required this.description,
    required this.quantityTotal,
    required this.quantityRemaining,
    required this.price,
    required this.currency,
    required this.pickupStartAt,
    required this.pickupEndAt,
    required this.expiresAt,
    required this.displayNameOptional,
    this.templateId,
    this.enterpriseVerified = false,
    this.enterpriseBadges = const <String>[],
    required this.visibility,
    required this.status,
    required this.editTokenHash,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String venueId;
  final String pickupPointText;
  final String itemType;
  final String description;
  final int quantityTotal;
  final int quantityRemaining;
  final double price;
  final String currency;
  final DateTime pickupStartAt;
  final DateTime pickupEndAt;
  final DateTime expiresAt;
  final String? displayNameOptional;
  final String? templateId;
  final bool enterpriseVerified;
  final List<String> enterpriseBadges;
  final ListingVisibility visibility;
  final ListingStatus status;
  final String editTokenHash;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool isExpiredAt(DateTime now) =>
      expiresAt.isBefore(now) || expiresAt.isAtSameMomentAs(now);
  bool get hasRemaining => quantityRemaining > 0;

  ListingStatus resolvedStatus(DateTime now) {
    if (status == ListingStatus.completed) {
      return ListingStatus.completed;
    }
    if (isExpiredAt(now)) {
      return ListingStatus.expired;
    }
    if (quantityRemaining <= 0) {
      return ListingStatus.reserved;
    }
    return ListingStatus.active;
  }

  bool canReserve(DateTime now) {
    return resolvedStatus(now) == ListingStatus.active && quantityRemaining > 0;
  }

  Listing copyWith({
    String? id,
    String? venueId,
    String? pickupPointText,
    String? itemType,
    String? description,
    int? quantityTotal,
    int? quantityRemaining,
    double? price,
    String? currency,
    DateTime? pickupStartAt,
    DateTime? pickupEndAt,
    DateTime? expiresAt,
    String? displayNameOptional,
    String? templateId,
    bool? enterpriseVerified,
    List<String>? enterpriseBadges,
    ListingVisibility? visibility,
    ListingStatus? status,
    String? editTokenHash,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return Listing(
      id: id ?? this.id,
      venueId: venueId ?? this.venueId,
      pickupPointText: pickupPointText ?? this.pickupPointText,
      itemType: itemType ?? this.itemType,
      description: description ?? this.description,
      quantityTotal: quantityTotal ?? this.quantityTotal,
      quantityRemaining: quantityRemaining ?? this.quantityRemaining,
      price: price ?? this.price,
      currency: currency ?? this.currency,
      pickupStartAt: pickupStartAt ?? this.pickupStartAt,
      pickupEndAt: pickupEndAt ?? this.pickupEndAt,
      expiresAt: expiresAt ?? this.expiresAt,
      displayNameOptional: displayNameOptional ?? this.displayNameOptional,
      templateId: templateId ?? this.templateId,
      enterpriseVerified: enterpriseVerified ?? this.enterpriseVerified,
      enterpriseBadges: enterpriseBadges ?? this.enterpriseBadges,
      visibility: visibility ?? this.visibility,
      status: status ?? this.status,
      editTokenHash: editTokenHash ?? this.editTokenHash,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'venueId': venueId,
      'pickupPointText': pickupPointText,
      'itemType': itemType,
      'description': description,
      'quantityTotal': quantityTotal,
      'quantityRemaining': quantityRemaining,
      'price': price,
      'currency': currency,
      'pickupStartAt': pickupStartAt,
      'pickupEndAt': pickupEndAt,
      'expiresAt': expiresAt,
      'displayNameOptional': displayNameOptional,
      'templateId': templateId,
      'enterpriseVerified': enterpriseVerified,
      'enterpriseBadges': enterpriseBadges,
      'visibility': visibility.name,
      'status': status.name,
      'editTokenHash': editTokenHash,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
    };
  }

  factory Listing.fromMap(Map<String, dynamic> map, {required String id}) {
    return Listing(
      id: id,
      venueId: map['venueId'] as String? ?? '',
      pickupPointText: map['pickupPointText'] as String? ?? '',
      itemType: map['itemType'] as String? ?? '',
      description: map['description'] as String? ?? '',
      quantityTotal: map['quantityTotal'] as int? ?? 0,
      quantityRemaining: map['quantityRemaining'] as int? ?? 0,
      price: (map['price'] as num?)?.toDouble() ?? 0,
      currency: map['currency'] as String? ?? 'TWD',
      pickupStartAt: _readDateTime(map['pickupStartAt']),
      pickupEndAt: _readDateTime(map['pickupEndAt']),
      expiresAt: _readDateTime(map['expiresAt']),
      displayNameOptional: map['displayNameOptional'] as String?,
      templateId: map['templateId'] as String?,
      enterpriseVerified: map['enterpriseVerified'] == true,
      enterpriseBadges: (map['enterpriseBadges'] as List?)
              ?.whereType<String>()
              .toList() ??
          const <String>[],
      visibility: ListingVisibilityX.fromName(map['visibility'] as String?),
      status: ListingStatusX.fromName(map['status'] as String?),
      editTokenHash: map['editTokenHash'] as String? ?? '',
      createdAt: _readDateTime(map['createdAt']),
      updatedAt: _readDateTime(map['updatedAt']),
    );
  }
}
