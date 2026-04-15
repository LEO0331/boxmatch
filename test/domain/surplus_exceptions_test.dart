import 'package:boxmatch/features/surplus/domain/surplus_exceptions.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('SurplusException keeps message and string output', () {
    const exception = SurplusException('base failure');
    expect(exception.message, 'base failure');
    expect(exception.toString(), 'base failure');
  });

  test('PermissionDeniedException is a SurplusException', () {
    const exception = PermissionDeniedException('permission denied');
    expect(exception, isA<SurplusException>());
    expect(exception.toString(), 'permission denied');
  });

  test('ValidationException is a SurplusException', () {
    const exception = ValidationException('invalid data');
    expect(exception, isA<SurplusException>());
    expect(exception.toString(), 'invalid data');
  });

  test('ApiUnavailableException is a SurplusException', () {
    final exception = ApiUnavailableException('api offline');
    expect(exception, isA<SurplusException>());
    expect(exception.toString(), 'api offline');
  });
}
