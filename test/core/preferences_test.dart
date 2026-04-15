import 'package:boxmatch/core/preferences/app_locale_controller.dart';
import 'package:boxmatch/core/preferences/venue_favorites_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('locale controller defaults and updates language', () async {
    SharedPreferences.setMockInitialValues({'boxmatch.language': 'zh-TW'});
    final prefs = await SharedPreferences.getInstance();
    final controller = await AppLocaleController.create(prefs);

    expect(controller.isZhTw, isTrue);
    expect(controller.languageCode, 'zh');

    var notified = 0;
    controller.addListener(() {
      notified++;
    });

    await controller.setLanguage(AppLanguage.en);

    expect(controller.languageCode, 'en');
    expect(controller.languageLabel, 'EN');
    expect(prefs.getString('boxmatch.language'), 'en');
    expect(notified, 1);
  });

  test('favorites store toggles and persists', () async {
    SharedPreferences.setMockInitialValues({
      'boxmatch.favoriteVenueIds': ['v1'],
    });
    final prefs = await SharedPreferences.getInstance();
    final store = await VenueFavoritesStore.create(prefs);

    expect(store.isFavorite('v1'), isTrue);
    expect(store.isFavorite('v2'), isFalse);

    await store.toggleFavorite('v2');
    expect(store.isFavorite('v2'), isTrue);

    await store.toggleFavorite('v1');
    expect(store.isFavorite('v1'), isFalse);

    await store.toggleFavorite('');
    expect(store.favoriteVenueIds.contains(''), isFalse);

    final persisted = prefs.getStringList('boxmatch.favoriteVenueIds') ?? [];
    expect(persisted, contains('v2'));
    expect(persisted, isNot(contains('v1')));
  });
}
