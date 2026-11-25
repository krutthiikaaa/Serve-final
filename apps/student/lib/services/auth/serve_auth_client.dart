import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';
import 'package:http/http.dart' as http;

import '../../config/app_config.dart';
import '../../core/api_exception.dart';

/// Opens [url] in the system browser (Custom Tab / ASWebAuthenticationSession)
/// and resolves with the URL it was redirected to on [callbackScheme].
typedef BrowserAuthenticator = Future<String> Function(String url, String callbackScheme);

Future<String> _systemBrowser(String url, String callbackScheme) =>
    FlutterWebAuth2.authenticate(url: url, callbackUrlScheme: callbackScheme);

/// Sign-in against the SERVE backend's Better Auth (Google, verified
/// @srmap.edu.in accounts only). The backend proves identity and creates the
/// session; nothing here decides a role.
///
/// - Web: [startWebSignIn] sends the browser to Google; it comes back to the
///   app signed in with an HttpOnly session cookie.
/// - Android / iOS: [nativeSignIn] runs the same Google flow in the system
///   browser and returns a session token for `Authorization: Bearer`, bound
///   to a PKCE verifier that never leaves the app (RFC 8252).
class ServeAuthClient {
  ServeAuthClient(this._config, {http.Client? httpClient, BrowserAuthenticator? browser, Random? random})
    : _http = httpClient ?? http.Client(),
      _browser = browser ?? _systemBrowser,
      _random = random ?? Random.secure();

  /// Native sign-in returns to the app on this URL scheme (AndroidManifest.xml; iOS needs none).
  static const nativeCallbackScheme = 'app.serve.student';

  final AppConfig _config;
  final http.Client _http;
  final BrowserAuthenticator _browser;
  final Random _random;

  Uri _api(String path) => Uri.parse('${_config.apiUrl}/api$path');

  /// Web: asks Better Auth for the Google sign-in URL. [appRoot] receives the
  /// browser back (signed in, or with `?error=`).
  Future<Uri> webSignInUrl(Uri appRoot) async {
    final body = await _send(
      () => _http.post(
        _api('/auth/sign-in/social'),
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
        body: jsonEncode({'provider': 'google', 'callbackURL': '$appRoot', 'errorCallbackURL': '$appRoot'}),
      ),
    );
    final url = body['url'];
    if (url is! String || !url.startsWith('https://')) {
      throw const AuthException('GOOGLE_SIGN_IN_UNAVAILABLE', 'Google sign-in is not available right now. Please try again later.');
    }
    return Uri.parse(url);
  }

  /// Native: Google in the system browser → one-time code → session token.
  Future<String> nativeSignIn() async {
    final verifier = _codeVerifier();
    final challenge = base64Url.encode(sha256.convert(ascii.encode(verifier)).bytes).replaceAll('=', '');
    final start = _api('/native-auth/start').replace(queryParameters: {'code_challenge': challenge, 'code_challenge_method': 'S256'});
    final String result;
    try {
      result = await _browser(start.toString(), nativeCallbackScheme);
    } on PlatformException catch (e) {
      // The user closed the browser / Custom Tab: not an error to alarm them with.
      if (e.code == 'CANCELED') throw AuthException('access_denied', signInErrorMessage('access_denied'));
      throw AuthException('SIGN_IN_FAILED', signInErrorMessage('SIGN_IN_FAILED'));
    } catch (_) {
      throw AuthException('SIGN_IN_FAILED', signInErrorMessage('SIGN_IN_FAILED'));
    }
    final params = Uri.parse(result).queryParameters;
    final error = params['error'];
    if (error != null) throw AuthException(error, signInErrorMessage(error));
    final code = params['code'];
    if (code == null || code.isEmpty) throw AuthException('SIGN_IN_FAILED', signInErrorMessage('SIGN_IN_FAILED'));
    final body = await _send(
      () => _http.post(
        _api('/native-auth/exchange'),
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
        body: jsonEncode({'code': code, 'code_verifier': verifier}),
      ),
    );
    final token = (body['data'] as Map?)?['token'];
    if (token is! String || token.isEmpty) {
      throw AuthException('SIGN_IN_FAILED', signInErrorMessage('SIGN_IN_FAILED'));
    }
    return token;
  }

  /// Ends the session on the server (cookie on web, [token] on native). Best effort.
  Future<void> signOut({String? token}) async {
    try {
      await _http.post(
        _api('/auth/sign-out'),
        headers: {'Content-Type': 'application/json', if (token != null) 'Authorization': 'Bearer $token'},
        body: '{}',
      );
    } catch (_) {
      // Offline: the local session is cleared anyway; the server one expires.
    }
  }

  /// 43–128 unreserved characters (RFC 7636); 64 here.
  String _codeVerifier() {
    final bytes = List<int>.generate(48, (_) => _random.nextInt(256));
    return base64Url.encode(bytes).replaceAll('=', '');
  }

  Future<Map<String, dynamic>> _send(Future<http.Response> Function() request) async {
    final http.Response res;
    try {
      res = await request();
    } catch (_) {
      throw const AuthException('network-request-failed', 'Unable to reach SERVE. Check your connection.');
    }
    Map<String, dynamic> body;
    try {
      body = res.body.isEmpty ? <String, dynamic>{} : (jsonDecode(res.body) as Map).cast<String, dynamic>();
    } catch (_) {
      body = <String, dynamic>{};
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return body;
    final error = body['error'];
    final code = (error is Map ? error['code'] : body['code'])?.toString() ?? 'SIGN_IN_FAILED';
    throw AuthException(code, signInErrorMessage(code));
  }
}

/// Shown when a staff or admin account tries to sign in to the student app.
const staffAdminPortalMessage =
    'Google sign-in is for students only. Staff sign in on the SERVE staff dashboard and admins on the admin portal, with their email and password.';

/// Plain-language reasons for sign-in refusals. Never internal details:
/// unknown codes get the generic message.
String signInErrorMessage(String code) => switch (code) {
  'EMAIL_DOMAIN_NOT_ALLOWED' =>
    'This account is not eligible to use SERVE. Please sign in using your SRM AP institutional account (@srmap.edu.in).',
  // A staff or admin address tried Google (students only), or a staff/admin
  // session reached the student app. They sign in on the web portals.
  'STAFF_ADMIN_USE_PASSWORD' || 'SIGN_IN_METHOD_NOT_ALLOWED' => staffAdminPortalMessage,
  'EMAIL_NOT_VERIFIED' => 'Your account could not be verified. Make sure your Google account email is verified, then try again.',
  // Google cannot attach to an address that already signs in another way
  // (a staff/admin password account) or to another student's account.
  'account_not_linked' => 'This email already has a SERVE account that does not sign in with Google. Staff and admins: use the staff dashboard or admin portal with your email and password. Students: ask a SERVE administrator for help.',
  'access_denied' => 'Google sign-in was cancelled.',
  'network-request-failed' => 'Unable to reach SERVE. Check your connection.',
  'NATIVE_CODE_INVALID' => 'That sign-in expired. Please try again.',
  'SESSION_EXPIRED' => 'Your session expired. Please sign in again.',
  _ => 'Authentication failed. Please try again.',
};
