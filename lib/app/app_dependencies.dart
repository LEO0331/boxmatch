import '../core/identity/recipient_identity_service.dart';
import '../features/surplus/data/surplus_repository.dart';

class AppDependencies {
  const AppDependencies({
    required this.repository,
    required this.identityService,
    required this.usingFirebase,
  });

  final SurplusRepository repository;
  final RecipientIdentityService identityService;
  final bool usingFirebase;
}
