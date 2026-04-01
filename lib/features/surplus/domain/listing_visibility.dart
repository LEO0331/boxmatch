enum ListingVisibility { minimal }

extension ListingVisibilityX on ListingVisibility {
  static ListingVisibility fromName(String? raw) {
    for (final value in ListingVisibility.values) {
      if (value.name == raw) {
        return value;
      }
    }
    return ListingVisibility.minimal;
  }
}
