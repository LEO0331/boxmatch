import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';

import '../core/identity/firebase_recipient_identity_service.dart';
import '../core/identity/local_recipient_identity_service.dart';
import '../features/surplus/data/firestore_surplus_repository.dart';
import '../features/surplus/data/in_memory_surplus_repository.dart';
import 'app_dependencies.dart';

Future<AppDependencies> bootstrapApp() async {
  final localIdentity = LocalRecipientIdentityService();

  try {
    await Firebase.initializeApp();
    final repository = FirestoreSurplusRepository(FirebaseFirestore.instance);
    await repository.ensureSeedData();

    final identity = FirebaseRecipientIdentityService(
      FirebaseAuth.instance,
      localIdentity,
    );

    return AppDependencies(
      repository: repository,
      identityService: identity,
      usingFirebase: true,
    );
  } catch (_) {
    final repository = InMemorySurplusRepository();
    await repository.ensureSeedData();

    return AppDependencies(
      repository: repository,
      identityService: localIdentity,
      usingFirebase: false,
    );
  }
}
