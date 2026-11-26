class VisitEnvironment {
  const VisitEnvironment({
    required this.uri,
    this.referrer = '',
    this.privacyOptOut = false,
  });

  final Uri uri;
  final String referrer;
  final bool privacyOptOut;
}
