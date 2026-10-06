import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../config/app_config.dart';
import '../../core/api_exception.dart';

/// A Firebase Authentication session (email/password).
class FirebaseSession {
  const FirebaseSession({
    required this.uid,
    required this.email,
    required this.idToken,
    required this.refreshToken,
    required this.expiresAt,
  });

  final String uid;
  final String? email;
  final String idToken;
  final String refreshToken;
  final DateTime expiresAt;

  bool expiresWithin(Duration margin, DateTime now) => !expiresAt.isAfter(now.add(margin));
}

/// Firebase Authentication over its documented REST API (Identity Toolkit +
/// Secure Token). Works identically against the Auth Emulator and production,
/// needs no native Firebase configuration files, and is fully testable in the
/// Dart VM. The backend still verifies every ID token with Firebase Admin.
class FirebaseAuthClient {
  FirebaseAuthClient(this._config, {http.Client? httpClient, DateTime Function()? clock})
    : _http = httpClient ?? http.Client(),
      _now = clock ?? DateTime.now;

  final AppConfig _config;
  final http.Client _http;
  final DateTime Function() _now;

  Uri _identity(String method) {
    final emulator = _config.authEmulatorHost;
    final base = emulator == null ? 'https://identitytoolkit.googleapis.com' : 'http://$emulator/identitytoolkit.googleapis.com';
    return Uri.parse('$base/v1/accounts:$method?key=${_config.firebaseApiKey}');
  }

  Uri get _secureToken {
    final emulator = _config.authEmulatorHost;
    final base = emulator == null ? 'https://securetoken.googleapis.com' : 'http://$emulator/securetoken.googleapis.com';
    return Uri.parse('$base/v1/token?key=${_config.firebaseApiKey}');
  }

  Future<FirebaseSession> signUp(String email, String password) =>
      _passwordCall('signUp', {'email': email.trim(), 'password': password, 'returnSecureToken': true});

  Future<FirebaseSession> signIn(String email, String password) =>
      _passwordCall('signInWithPassword', {'email': email.trim(), 'password': password, 'returnSecureToken': true});

  /// Exchanges the refresh token for a fresh ID token.
  Future<FirebaseSession> refresh(FirebaseSession session) async {
    final res = await _send(
      () => _http.post(
        _secureToken,
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: {'grant_type': 'refresh_token', 'refresh_token': session.refreshToken},
      ),
    );
    return FirebaseSession(
      uid: res['user_id'] as String,
      email: session.email,
      idToken: res['id_token'] as String,
      refreshToken: res['refresh_token'] as String,
      expiresAt: _now().add(Duration(seconds: int.parse(res['expires_in'] as String))),
    );
  }

  Future<FirebaseSession> _passwordCall(String method, Map<String, Object> body) async {
    final res = await _send(() => _http.post(_identity(method), headers: {'Content-Type': 'application/json'}, body: jsonEncode(body)));
    return FirebaseSession(
      uid: res['localId'] as String,
      email: res['email'] as String?,
      idToken: res['idToken'] as String,
      refreshToken: res['refreshToken'] as String,
      expiresAt: _now().add(Duration(seconds: int.parse(res['expiresIn'] as String))),
    );
  }

  Future<Map<String, dynamic>> _send(Future<http.Response> Function() request) async {
    final http.Response res;
    try {
      res = await request();
    } catch (_) {
      throw const AuthException('network-request-failed', 'Unable to reach the sign-in service. Check your connection.');
    }
    final body = res.body.isEmpty ? <String, dynamic>{} : (jsonDecode(res.body) as Map).cast<String, dynamic>();
    if (res.statusCode >= 200 && res.statusCode < 300) return body;
    final code = ((body['error'] as Map?)?['message'] as String?) ?? 'UNKNOWN';
    throw AuthException(code, firebaseErrorMessage(code));
  }
}

/// Friendly messages for Identity Toolkit error codes.
String firebaseErrorMessage(String code) {
  if (code.startsWith('WEAK_PASSWORD')) return 'Choose a password with at least 6 characters.';
  return switch (code) {
    'EMAIL_EXISTS' => 'An account with this email already exists. Sign in instead.',
    'INVALID_LOGIN_CREDENTIALS' || 'EMAIL_NOT_FOUND' || 'INVALID_PASSWORD' || 'INVALID_EMAIL' => 'Incorrect email or password.',
    'MISSING_PASSWORD' => 'Enter your password.',
    'TOO_MANY_ATTEMPTS_TRY_LATER' => 'Too many attempts. Please wait and try again.',
    'USER_DISABLED' => 'This account has been disabled.',
    'TOKEN_EXPIRED' || 'INVALID_REFRESH_TOKEN' || 'USER_NOT_FOUND' => 'Your session has expired. Please sign in again.',
    _ => 'Sign-in failed. Please try again.',
  };
}
