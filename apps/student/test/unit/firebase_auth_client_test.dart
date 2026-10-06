import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:serve_student/config/app_config.dart';
import 'package:serve_student/core/api_exception.dart';
import 'package:serve_student/services/auth/firebase_auth_client.dart';

void main() {
  const emulator = AppConfig(
    apiUrl: 'http://localhost:5001',
    firebaseApiKey: 'demo-key',
    firebaseProjectId: 'demo-serve',
    authEmulatorHost: '127.0.0.1:9099',
  );
  const production = AppConfig(apiUrl: 'https://api.serve.app', firebaseApiKey: 'prod-key', firebaseProjectId: 'serve-prod');
  final now = DateTime.utc(2026, 10, 6, 20);

  test('signs in against the emulator and computes the expiry', () async {
    late http.Request seen;
    final client = FirebaseAuthClient(
      emulator,
      clock: () => now,
      httpClient: MockClient((req) async {
        seen = req;
        return http.Response(
          jsonEncode({'localId': 'uid1', 'email': 'a@b.edu', 'idToken': 'id1', 'refreshToken': 'r1', 'expiresIn': '3600'}),
          200,
        );
      }),
    );
    final session = await client.signIn(' a@b.edu ', 'pw');
    expect(seen.url.toString(), 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key');
    expect(jsonDecode(seen.body), {'email': 'a@b.edu', 'password': 'pw', 'returnSecureToken': true});
    expect(session.uid, 'uid1');
    expect(session.expiresAt, now.add(const Duration(hours: 1)));
  });

  test('uses the real Google endpoints without an emulator', () async {
    late Uri url;
    final client = FirebaseAuthClient(
      production,
      httpClient: MockClient((req) async {
        url = req.url;
        return http.Response(jsonEncode({'user_id': 'u', 'id_token': 'i', 'refresh_token': 'r', 'expires_in': '3600'}), 200);
      }),
    );
    await client.refresh(FirebaseSession(uid: 'u', email: null, idToken: '', refreshToken: 'r0', expiresAt: now));
    expect(url.toString(), 'https://securetoken.googleapis.com/v1/token?key=prod-key');
  });

  test('maps Identity Toolkit errors to friendly messages', () async {
    final client = FirebaseAuthClient(
      emulator,
      httpClient: MockClient(
        (_) async => http.Response(
          jsonEncode({
            'error': {'message': 'INVALID_LOGIN_CREDENTIALS'},
          }),
          400,
        ),
      ),
    );
    await expectLater(
      client.signIn('a@b.edu', 'bad'),
      throwsA(isA<AuthException>().having((e) => e.message, 'message', 'Incorrect email or password.')),
    );
    expect(firebaseErrorMessage('EMAIL_EXISTS'), contains('already exists'));
    expect(firebaseErrorMessage('WEAK_PASSWORD : Password should be at least 6 characters'), contains('6 characters'));
  });
}
