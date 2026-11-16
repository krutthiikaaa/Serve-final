import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists the native app's SERVE session token so students stay signed in.
/// Only the opaque session token is stored (Keychain / Android Keystore) —
/// never a password. Flutter web keeps no token: its session is an HttpOnly
/// cookie the page cannot read.
abstract class SessionStore {
  Future<StoredSession?> read();
  Future<void> write(StoredSession session);
  Future<void> clear();
}

class StoredSession {
  const StoredSession({required this.token});

  /// Better Auth session token, sent as `Authorization: Bearer`.
  final String token;

  Map<String, Object?> toJson() => {'v': 2, 'token': token};

  /// Null for anything else, including a pre-Better-Auth (Firebase) session.
  static StoredSession? fromJson(Map<String, dynamic> j) {
    final token = j['token'];
    return j['v'] == 2 && token is String && token.isNotEmpty ? StoredSession(token: token) : null;
  }
}

/// Keychain (iOS) / EncryptedSharedPreferences-backed keystore (Android).
class SecureSessionStore implements SessionStore {
  SecureSessionStore([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _storage;
  static const _key = 'serve.session';

  @override
  Future<StoredSession?> read() async {
    try {
      final raw = await _storage.read(key: _key);
      return raw == null ? null : StoredSession.fromJson((jsonDecode(raw) as Map).cast<String, dynamic>());
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(StoredSession session) => _storage.write(key: _key, value: jsonEncode(session.toJson()));

  @override
  Future<void> clear() => _storage.delete(key: _key);
}

/// For tests.
class MemorySessionStore implements SessionStore {
  StoredSession? value;

  @override
  Future<StoredSession?> read() async => value;

  @override
  Future<void> write(StoredSession session) async => value = session;

  @override
  Future<void> clear() async => value = null;
}
