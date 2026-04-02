import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../core/identity/firebase_recipient_identity_service.dart';
import '../core/identity/local_recipient_identity_service.dart';
import '../core/preferences/app_locale_controller.dart';
import '../core/preferences/venue_favorites_store.dart';
import '../features/surplus/data/firestore_surplus_repository.dart';
import '../features/surplus/data/in_memory_surplus_repository.dart';
import '../firebase_options.dart';
import 'app_dependencies.dart';

Future<AppDependencies> bootstrapApp() async {
  final localIdentity = LocalRecipientIdentityService();
  final prefs = await SharedPreferences.getInstance();
  final localeController = await AppLocaleController.create(prefs);
  final favoritesStore = await VenueFavoritesStore.create(prefs);

  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
    final customApiBaseUrl = const String.fromEnvironment(
      'BOXMATCH_API_BASE_URL',
    );
    final apiBaseUrl = customApiBaseUrl.isNotEmpty
        ? customApiBaseUrl
        : 'https://boxmatch-api.onrender.com';

    final repository = FirestoreSurplusRepository(
      FirebaseFirestore.instance,
      apiBaseUrl: apiBaseUrl,
      idTokenProvider: () async {
        final user = FirebaseAuth.instance.currentUser;
        if (user == null) {
          return null;
        }
        return user.getIdToken();
      },
    );
    await repository.ensureSeedData();
    unawaited(_warmUpApi(apiBaseUrl));

    final identity = FirebaseRecipientIdentityService(
      FirebaseAuth.instance,
      localIdentity,
    );

    return AppDependencies(
      repository: repository,
      identityService: identity,
      usingFirebase: true,
      localeController: localeController,
      favoritesStore: favoritesStore,
    );
  } catch (error, stackTrace) {
    final line = jsonEncode({
      'tag': 'BOXMATCH_ERROR',
      'source': 'bootstrap.firebase_fallback',
      'fatal': false,
      'errorType': error.runtimeType.toString(),
      'message': error.toString(),
      'stackTrace': stackTrace.toString(),
      'ts': DateTime.now().toIso8601String(),
    });
    debugPrint(line);
    developer.log(line, name: 'BOXMATCH_ERROR');

    final repository = InMemorySurplusRepository();
    await repository.ensureSeedData();

    return AppDependencies(
      repository: repository,
      identityService: localIdentity,
      usingFirebase: false,
      localeController: localeController,
      favoritesStore: favoritesStore,
    );
  }
}

Future<void> _warmUpApi(String apiBaseUrl) async {
  final normalized = apiBaseUrl.replaceAll(RegExp(r'/+$'), '');
  final uri = Uri.parse('$normalized/health');
  try {
    await http.get(uri).timeout(const Duration(seconds: 6));
  } catch (_) {
    // Best-effort warm-up only.
  }
}
