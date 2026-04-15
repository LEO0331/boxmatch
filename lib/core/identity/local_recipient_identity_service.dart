import 'package:shared_preferences/shared_preferences.dart';

import '../utils/id_utils.dart';
import 'recipient_identity_service.dart';

class LocalRecipientIdentityService implements RecipientIdentityService {
  static const _uidKey = 'boxmatch.local_uid';
  String? _cachedUid;

  @override
  bool get isUsingLocalFallback => true;

  @override
  Future<String> ensureRecipientUid() async {
    if (_cachedUid != null) {
      return _cachedUid!;
    }

    final preferences = await SharedPreferences.getInstance();
    final existing = preferences.getString(_uidKey);
    if (existing != null && existing.isNotEmpty) {
      _cachedUid = existing;
      return existing;
    }

    final generated = 'guest_${randomId(length: 12)}';
    await preferences.setString(_uidKey, generated);
    _cachedUid = generated;
    return generated;
  }
}
