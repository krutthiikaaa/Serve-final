/// Every failed backend call surfaces as an [ApiException] carrying the
/// backend's error envelope (`{ error: { code, message, details, requestId } }`).
class ApiException implements Exception {
  const ApiException(this.status, this.code, this.message, {this.details, this.requestId});

  /// HTTP status; 0 means the backend could not be reached.
  final int status;
  final String code;
  final String message;
  final Object? details;
  final String? requestId;

  bool get isNetwork => status == 0;

  static const networkMessage = 'Unable to connect to SERVE. Please try again.';

  /// A short message that is safe to show to students (never internals).
  String get userMessage {
    switch (status) {
      case 0:
      case 503:
        return networkMessage;
      case 401:
        return 'Your session has expired. Please sign in again.';
      case 403:
        if (code == 'EMAIL_DOMAIN_NOT_ALLOWED') return 'Please use your university email address.';
        return message.isNotEmpty ? message : 'You do not have permission to do that.';
      case 404:
        return message.isNotEmpty ? message : 'This is no longer available.';
      case 409:
        if (code == 'CANTEEN_NOT_ACCEPTING_ORDERS') return 'This canteen is currently not accepting orders.';
        return message.isNotEmpty ? message : 'This changed in the meantime. Please refresh and try again.';
      case 422:
        return message.isNotEmpty && message != 'Validation failed' ? message : 'Please check your details and try again.';
      case 429:
        return 'Too many requests. Please wait a moment and try again.';
      default:
        return 'Something went wrong. Please try again.';
    }
  }

  @override
  String toString() => 'ApiException($status $code: $message)';
}

/// User-facing message for any error.
String errorMessage(Object error) {
  if (error is ApiException) return error.userMessage;
  if (error is AuthException) return error.message;
  return 'Something went wrong. Please try again.';
}

/// Firebase Authentication failure with a friendly message.
class AuthException implements Exception {
  const AuthException(this.code, this.message);
  final String code;
  final String message;

  @override
  String toString() => 'AuthException($code)';
}
