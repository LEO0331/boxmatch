class SurplusException implements Exception {
  const SurplusException(this.message);

  final String message;

  @override
  String toString() => message;
}

class PermissionDeniedException extends SurplusException {
  const PermissionDeniedException(super.message);
}

class ValidationException extends SurplusException {
  const ValidationException(super.message);
}
