import 'package:boxmatch/core/utils/enterprise_edit_link.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('keeps hosted base path and token out of the HTTP URL', () {
    final link = Uri.parse(
      buildEnterpriseEditLink(
        base: Uri.parse(
          'https://example.com/boxmatch/?old=secret#/enterprise/new',
        ),
        listingId: 'listing-1',
        token: 'private-token',
      ),
    );

    expect(link.path, '/boxmatch/');
    expect(link.query, isEmpty);
    expect(link.fragment, '/enterprise/edit/listing-1?token=private-token');
    expect(link.removeFragment().toString(), 'https://example.com/boxmatch/');
  });

  test('encodes route and token values safely', () {
    final link = Uri.parse(
      buildEnterpriseEditLink(
        base: Uri.parse('https://example.com/'),
        listingId: 'listing/1',
        token: 'a&b=c',
      ),
    );
    final route = Uri.parse(link.fragment);
    expect(route.pathSegments.last, 'listing/1');
    expect(route.queryParameters['token'], 'a&b=c');
  });
}
