import 'listing_visibility.dart';

class EnterpriseProfileLite {
  const EnterpriseProfileLite({
    this.displayName,
    this.visibility = ListingVisibility.minimal,
  });

  final String? displayName;
  final ListingVisibility visibility;

  Map<String, dynamic> toMap() {
    return {'displayNameOptional': displayName, 'visibility': visibility.name};
  }

  factory EnterpriseProfileLite.fromMap(Map<String, dynamic> map) {
    return EnterpriseProfileLite(
      displayName: map['displayNameOptional'] as String?,
      visibility: ListingVisibilityX.fromName(map['visibility'] as String?),
    );
  }
}
