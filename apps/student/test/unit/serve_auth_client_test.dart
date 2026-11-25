import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:serve_student/config/app_config.dart';
import 'package:serve_student/core/api_exception.dart';
import 'package:serve_student/services/auth/serve_auth_client.dart';

const config = AppConfig(apiUrl: 'http://localhost:5001');

void main() {
  group('native sign-in (system browser + PKCE exchange)', () {
    test('opens the backend start URL with an S256 challenge and exchanges the code with its verifier', () async {
      String? opened;
      String? scheme;
      Map<String, dynamic>? exchanged;
      final client = ServeAuthClient(
        config,
        httpClient: MockClient((request) async {
          expect(request.url.toString(), 'http://localhost:5001/api/native-auth/exchange');
          exchanged = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response(
            jsonEncode({
              'data': {'token': 'session-token', 'expiresAt': '2026-11-23T00:00:00.000Z'},
            }),
            200,
          );
        }),
        browser: (url, callbackScheme) async {
          opened = url;
          scheme = callbackScheme;
          return 'app.serve.student://auth?code=one-time-code-from-backend';
        },
      );
      expect(await client.nativeSignIn(), 'session-token');

      final start = Uri.parse(opened!);
      expect(start.path, '/api/native-auth/start');
      expect(start.queryParameters['code_challenge_method'], 'S256');
      expect(scheme, 'app.serve.student');
      final verifier = exchanged!['code_verifier'] as String;
      expect(verifier.length, inInclusiveRange(43, 128));
      final challenge = base64Url.encode(sha256.convert(ascii.encode(verifier)).bytes).replaceAll('=', '');
      expect(start.queryParameters['code_challenge'], challenge);
      expect(exchanged!['code'], 'one-time-code-from-backend');
    });

    test('a refused account comes back as a friendly error, with no exchange', () async {
      var calls = 0;
      final client = ServeAuthClient(
        config,
        httpClient: MockClient((_) async {
          calls++;
          return http.Response('{}', 200);
        }),
        browser: (_, _) async => 'app.serve.student://auth?error=EMAIL_DOMAIN_NOT_ALLOWED',
      );
      await expectLater(
        client.nativeSignIn(),
        throwsA(
          isA<AuthException>()
              .having((e) => e.code, 'code', 'EMAIL_DOMAIN_NOT_ALLOWED')
              .having((e) => e.message, 'message', contains('@srmap.edu.in')),
        ),
      );
      expect(calls, 0);
    });

    test('closing the browser is a cancelled sign-in', () async {
      final client = ServeAuthClient(
        config,
        httpClient: MockClient((_) async => http.Response('{}', 200)),
        // What flutter_web_auth_2 throws when the user closes the browser / Custom Tab.
        browser: (_, _) async => throw PlatformException(code: 'CANCELED'),
      );
      await expectLater(
        client.nativeSignIn(),
        throwsA(
          isA<AuthException>()
              .having((e) => e.code, 'code', 'access_denied')
              .having((e) => e.message, 'message', 'Google sign-in was cancelled.'),
        ),
      );
    });

    test('a browser that cannot open is a failed sign-in, not a cancellation', () async {
      var calls = 0;
      final client = ServeAuthClient(
        config,
        httpClient: MockClient((_) async {
          calls++;
          return http.Response('{}', 200);
        }),
        browser: (_, _) async => throw PlatformException(code: 'NO_BROWSER', message: 'internal detail'),
      );
      await expectLater(
        client.nativeSignIn(),
        throwsA(
          isA<AuthException>()
              .having((e) => e.code, 'code', 'SIGN_IN_FAILED')
              .having((e) => e.message, 'message', 'Authentication failed. Please try again.'),
        ),
      );
      expect(calls, 0, reason: 'nothing is exchanged');
    });

    test('refusal messages are plain language, never internals', () {
      expect(
        signInErrorMessage('EMAIL_DOMAIN_NOT_ALLOWED'),
        'This account is not eligible to use SERVE. Please sign in using your SRM AP institutional account (@srmap.edu.in).',
      );
      expect(signInErrorMessage('EMAIL_NOT_VERIFIED'), startsWith('Your account could not be verified'));
      expect(signInErrorMessage('SESSION_EXPIRED'), 'Your session expired. Please sign in again.');
      expect(signInErrorMessage('Error: stack trace at line 3'), 'Authentication failed. Please try again.');
    });

    test('a staff or admin address is sent to the web portals', () {
      for (final code in ['STAFF_ADMIN_USE_PASSWORD', 'SIGN_IN_METHOD_NOT_ALLOWED']) {
        expect(signInErrorMessage(code), staffAdminPortalMessage);
      }
      expect(staffAdminPortalMessage, contains('staff dashboard'));
      expect(staffAdminPortalMessage, contains('admin portal'));
      expect(signInErrorMessage('account_not_linked'), contains('email and password'));
    });

    test('a native sign-in refused for a staff/admin address reports why', () async {
      final client = ServeAuthClient(
        config,
        httpClient: MockClient((_) async => http.Response('{}', 500)),
        browser: (_, _) async => 'app.serve.student://auth?error=STAFF_ADMIN_USE_PASSWORD',
      );
      await expectLater(
        client.nativeSignIn(),
        throwsA(
          isA<AuthException>()
              .having((e) => e.code, 'code', 'STAFF_ADMIN_USE_PASSWORD')
              .having((e) => e.message, 'message', staffAdminPortalMessage),
        ),
      );
    });

    test('an expired or reused code maps to a friendly message', () async {
      final client = ServeAuthClient(
        config,
        httpClient: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'error': {'code': 'NATIVE_CODE_INVALID', 'message': 'x'},
            }),
            401,
          ),
        ),
        browser: (_, _) async => 'app.serve.student://auth?code=old',
      );
      await expectLater(client.nativeSignIn(), throwsA(isA<AuthException>().having((e) => e.message, 'message', contains('expired'))));
    });

    test('every sign-in uses a fresh verifier', () async {
      final challenges = <String>{};
      final client = ServeAuthClient(
        config,
        httpClient: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'data': {'token': 't'},
            }),
            200,
          ),
        ),
        browser: (url, _) async {
          challenges.add(Uri.parse(url).queryParameters['code_challenge']!);
          return 'app.serve.student://auth?code=c';
        },
      );
      for (var i = 0; i < 5; i++) {
        await client.nativeSignIn();
      }
      expect(challenges, hasLength(5));
    });
  });

  group('web sign-in', () {
    test('asks Better Auth for the Google URL with this app as the return address', () async {
      late Map<String, dynamic> sent;
      final client = ServeAuthClient(
        config,
        httpClient: MockClient((request) async {
          expect(request.url.toString(), 'http://localhost:5001/api/auth/sign-in/social');
          sent = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response(jsonEncode({'url': 'https://accounts.google.com/o/oauth2/v2/auth?x=1', 'redirect': true}), 200);
        }),
      );
      final url = await client.webSignInUrl(Uri.parse('http://localhost:5555/'));
      expect(url.host, 'accounts.google.com');
      expect(sent, {'provider': 'google', 'callbackURL': 'http://localhost:5555/', 'errorCallbackURL': 'http://localhost:5555/'});
    });

    test('refuses anything but an https Google URL', () async {
      final client = ServeAuthClient(
        config,
        httpClient: MockClient((_) async => http.Response(jsonEncode({'url': 'http://evil.example/'}), 200)),
      );
      await expectLater(client.webSignInUrl(Uri.parse('http://localhost:5555/')), throwsA(isA<AuthException>()));
    });
  });

  test('sign-out tells the server (Bearer on native) and never throws offline', () async {
    http.Request? seen;
    final client = ServeAuthClient(
      config,
      httpClient: MockClient((request) async {
        seen = request;
        return http.Response('{}', 200);
      }),
    );
    await client.signOut(token: 'tok');
    expect(seen!.url.path, '/api/auth/sign-out');
    expect(seen!.headers['Authorization'], 'Bearer tok');
    final offline = ServeAuthClient(config, httpClient: MockClient((_) => throw http.ClientException('offline')));
    await offline.signOut(token: 'tok');
  });
}
