import 'package:boxmatch/app/app_dependencies.dart';
import 'package:boxmatch/core/identity/recipient_identity_service.dart';
import 'package:boxmatch/core/preferences/app_locale_controller.dart';
import 'package:boxmatch/core/preferences/venue_favorites_store.dart';
import 'package:boxmatch/features/surplus/data/in_memory_surplus_repository.dart';
import 'package:shared_preferences/shared_preferences.dart';

class FakeIdentityService implements RecipientIdentityService {
  @override
  bool get isUsingLocalFallback => false;

  @override
  Future<String> ensureRecipientUid() async => 'test-user';
}

Future<AppDependencies> buildTestDependencies({
  InMemorySurplusRepository? repository,
  RecipientIdentityService? identityService,
  String language = 'en',
  bool usingFirebase = false,
}) async {
  SharedPreferences.setMockInitialValues({'boxmatch.language': language});
  final prefs = await SharedPreferences.getInstance();
  final localeController = await AppLocaleController.create(prefs);
  final favoritesStore = await VenueFavoritesStore.create(prefs);
  final repo = repository ?? InMemorySurplusRepository();
  await repo.ensureSeedData();

  return AppDependencies(
    repository: repo,
    identityService: identityService ?? FakeIdentityService(),
    usingFirebase: usingFirebase,
    localeController: localeController,
    favoritesStore: favoritesStore,
  );
}
