import 'dart:math';

const _tokenAlphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
final _secureRandom = Random.secure();

String randomId({int length = 20}) {
  final buffer = StringBuffer();
  for (var i = 0; i < length; i++) {
    buffer.write(_tokenAlphabet[_secureRandom.nextInt(_tokenAlphabet.length)]);
  }
  return buffer.toString();
}

String randomDigits({int length = 4}) {
  final buffer = StringBuffer();
  for (var i = 0; i < length; i++) {
    buffer.write(_secureRandom.nextInt(10));
  }
  return buffer.toString();
}
