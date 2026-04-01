import 'package:boxmatch/core/utils/token_utils.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('hash + verify token', () {
    final token = generateEditToken();
    final hash = hashToken(token);

    expect(verifyTokenHash(token: token, hash: hash), isTrue);
    expect(verifyTokenHash(token: '${token}x', hash: hash), isFalse);
  });
}
