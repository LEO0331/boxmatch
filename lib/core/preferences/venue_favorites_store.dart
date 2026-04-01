import 'dart:collection';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class VenueFavoritesStore extends ChangeNotifier {
  VenueFavoritesStore._(this._prefs, this._favoriteVenueIds);

  static const String _storageKey = 'boxmatch.favoriteVenueIds';

  final SharedPreferences _prefs;
  final Set<String> _favoriteVenueIds;

  static Future<VenueFavoritesStore> create(SharedPreferences prefs) async {
    final stored = prefs.getStringList(_storageKey) ?? const <String>[];
    return VenueFavoritesStore._(prefs, stored.toSet());
  }

  UnmodifiableSetView<String> get favoriteVenueIds =>
      UnmodifiableSetView(_favoriteVenueIds);

  bool isFavorite(String venueId) => _favoriteVenueIds.contains(venueId);

  Future<void> toggleFavorite(String venueId) async {
    if (venueId.isEmpty) {
      return;
    }

    if (_favoriteVenueIds.contains(venueId)) {
      _favoriteVenueIds.remove(venueId);
    } else {
      _favoriteVenueIds.add(venueId);
    }

    await _prefs.setStringList(_storageKey, _favoriteVenueIds.toList()..sort());
    notifyListeners();
  }
}
