import 'package:firebase_auth/firebase_auth.dart';

import 'recipient_identity_service.dart';

class FirebaseRecipientIdentityService implements RecipientIdentityService {
  FirebaseRecipientIdentityService(this._auth, this._fallback);

  final FirebaseAuth _auth;
  final RecipientIdentityService _fallback;

  @override
  Future<String> ensureRecipientUid() async {
    try {
      final currentUser = _auth.currentUser;
      if (currentUser != null) {
        return currentUser.uid;
      }

      final credential = await _auth.signInAnonymously();
      final uid = credential.user?.uid;
      if (uid != null) {
        return uid;
      }
    } catch (_) {
      // If Firebase Auth isn't configured in this environment, continue locally.
    }
    return _fallback.ensureRecipientUid();
  }
}
