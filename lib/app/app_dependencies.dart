import '../core/identity/recipient_identity_service.dart';
import '../core/preferences/app_locale_controller.dart';
import '../core/preferences/venue_favorites_store.dart';
import '../features/surplus/data/surplus_repository.dart';

class AppDependencies {
  AppDependencies({
    required this.repository,
    required this.identityService,
    required this.usingFirebase,
    required this.localeController,
    required this.favoritesStore,
  });

  final SurplusRepository repository;
  final RecipientIdentityService identityService;
  final bool usingFirebase;
  final AppLocaleController localeController;
  final VenueFavoritesStore favoritesStore;
}
