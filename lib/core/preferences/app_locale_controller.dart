import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum AppLanguage { en, zhTw }

class AppLocaleController extends ChangeNotifier {
  AppLocaleController._(this._prefs, this._language);

  static const String _languageKey = 'boxmatch.language';

  final SharedPreferences _prefs;
  AppLanguage _language;

  static Future<AppLocaleController> create(SharedPreferences prefs) async {
    final raw = prefs.getString(_languageKey) ?? 'zh-TW';
    final language = raw == 'en' ? AppLanguage.en : AppLanguage.zhTw;
    return AppLocaleController._(prefs, language);
  }

  AppLanguage get language => _language;

  String get languageCode {
    switch (_language) {
      case AppLanguage.en:
        return 'en';
      case AppLanguage.zhTw:
        return 'zh';
    }
  }

  bool get isZhTw => _language == AppLanguage.zhTw;

  String get languageLabel => isZhTw ? '繁中' : 'EN';

  Future<void> setLanguage(AppLanguage next) async {
    if (next == _language) {
      return;
    }

    _language = next;
    await _prefs.setString(
      _languageKey,
      next == AppLanguage.en ? 'en' : 'zh-TW',
    );
    notifyListeners();
  }
}
