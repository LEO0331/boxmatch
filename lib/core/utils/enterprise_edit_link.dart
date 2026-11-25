/// Keeps the edit capability in the fragment, outside HTTP requests/referrers.
String buildEnterpriseEditLink({
  required Uri base,
  required String listingId,
  required String token,
}) {
  final route = Uri(
    pathSegments: ['', 'enterprise', 'edit', listingId],
    queryParameters: {'token': token},
  );
  return Uri(
    scheme: base.scheme,
    userInfo: base.userInfo,
    host: base.hasAuthority ? base.host : null,
    port: base.hasPort ? base.port : null,
    path: base.path,
    fragment: route.toString(),
  ).toString();
}
