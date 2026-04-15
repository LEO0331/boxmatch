import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import 'recipient_identity_service.dart';

class FirebaseRecipientIdentityService implements RecipientIdentityService {
  FirebaseRecipientIdentityService(this._auth, this._fallback);

  final FirebaseAuth _auth;
  final RecipientIdentityService _fallback;
  bool _usingLocalFallback = false;

  @override
  bool get isUsingLocalFallback => _usingLocalFallback;

  @override
  Future<String> ensureRecipientUid() async {
    try {
      final currentUser = _auth.currentUser;
      if (currentUser != null) {
        _usingLocalFallback = false;
        return currentUser.uid;
      }

      final credential = await _auth.signInAnonymously();
      final uid = credential.user?.uid;
      if (uid != null) {
        _usingLocalFallback = false;
        return uid;
      }
    } on FirebaseAuthException catch (error, stackTrace) {
      _usingLocalFallback = true;
      debugPrint(
        'BOXMATCH_ERROR {"source":"identity.firebase_auth","message":"${error.code}: ${error.message}","stack":"$stackTrace"}',
      );
      // If Firebase Auth isn't configured in this environment, continue locally.
    } catch (_) {
      _usingLocalFallback = true;
      // Non-auth runtime errors also fallback to local identity.
    }
    return _fallback.ensureRecipientUid();
  }
}
