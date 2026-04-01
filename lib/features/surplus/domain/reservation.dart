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

enum ReservationStatus { reserved, cancelled, completed, expired }

extension ReservationStatusX on ReservationStatus {
  static ReservationStatus fromName(String? raw) {
    for (final value in ReservationStatus.values) {
      if (value.name == raw) {
        return value;
      }
    }
    return ReservationStatus.reserved;
  }
}

class Reservation {
  const Reservation({
    required this.id,
    required this.listingId,
    required this.claimerUid,
    required this.qty,
    required this.pickupCode,
    required this.status,
    required this.createdAt,
    required this.expiresAt,
  });

  final String id;
  final String listingId;
  final String claimerUid;
  final int qty;
  final String pickupCode;
  final ReservationStatus status;
  final DateTime createdAt;
  final DateTime expiresAt;

  bool get isActive => status == ReservationStatus.reserved;

  Reservation copyWith({
    String? id,
    String? listingId,
    String? claimerUid,
    int? qty,
    String? pickupCode,
    ReservationStatus? status,
    DateTime? createdAt,
    DateTime? expiresAt,
  }) {
    return Reservation(
      id: id ?? this.id,
      listingId: listingId ?? this.listingId,
      claimerUid: claimerUid ?? this.claimerUid,
      qty: qty ?? this.qty,
      pickupCode: pickupCode ?? this.pickupCode,
      status: status ?? this.status,
      createdAt: createdAt ?? this.createdAt,
      expiresAt: expiresAt ?? this.expiresAt,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'listingId': listingId,
      'claimerUid': claimerUid,
      'qty': qty,
      'pickupCode': pickupCode,
      'status': status.name,
      'createdAt': createdAt,
      'expiresAt': expiresAt,
    };
  }

  factory Reservation.fromMap(Map<String, dynamic> map, {required String id}) {
    return Reservation(
      id: id,
      listingId: map['listingId'] as String? ?? '',
      claimerUid: map['claimerUid'] as String? ?? '',
      qty: map['qty'] as int? ?? 0,
      pickupCode: map['pickupCode'] as String? ?? '',
      status: ReservationStatusX.fromName(map['status'] as String?),
      createdAt: _readDateTime(map['createdAt']),
      expiresAt: _readDateTime(map['expiresAt']),
    );
  }
}
