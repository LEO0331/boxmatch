abstract interface class RecipientIdentityService {
  Future<String> ensureRecipientUid();

  bool get isUsingLocalFallback;
}
