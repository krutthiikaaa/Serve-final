import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists the Firebase refresh token so students stay signed in.
/// Only the refresh token, uid and email are stored — never passwords.
abstract class SessionStore {
  Future<StoredSession?> read();
  Future<void> write(StoredSession session);
  Future<void> clear();
}

class StoredSession {
  const StoredSession({required this.uid, required this.email, required this.refreshToken});
  final String uid;
  final String? email;
  final String refreshToken;

  Map<String, Object?> toJson() => {'uid': uid, 'email': email, 'refreshToken': refreshToken};
  static StoredSession fromJson(Map<String, dynamic> j) =>
      StoredSession(uid: j['uid'] as String, email: j['email'] as String?, refreshToken: j['refreshToken'] as String);
}

/// Keychain (iOS) / EncryptedSharedPreferences-backed keystore (Android) / web storage.
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
