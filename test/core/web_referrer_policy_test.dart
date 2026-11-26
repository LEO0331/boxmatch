import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('web referrer policy permits map tiles without leaking URL details', () {
    final html = File('web/index.html').readAsStringSync();
    final policies = RegExp(
      r'<meta\s+name="referrer"\s+content="([^"]+)"\s*/?>',
    ).allMatches(html).map((match) => match.group(1)).toList();

    expect(policies, ['strict-origin']);
  });
}
