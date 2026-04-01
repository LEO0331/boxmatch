import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';

const _tokenChars =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
final _tokenRandom = Random.secure();

String generateEditToken({int length = 32}) {
  final buffer = StringBuffer();
  for (var i = 0; i < length; i++) {
    buffer.write(_tokenChars[_tokenRandom.nextInt(_tokenChars.length)]);
  }
  return buffer.toString();
}

String hashToken(String token) {
  return sha256.convert(utf8.encode(token)).toString();
}

bool verifyTokenHash({required String token, required String hash}) {
  return hashToken(token) == hash;
}
