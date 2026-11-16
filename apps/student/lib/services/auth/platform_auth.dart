import 'package:http/http.dart' as http;

import 'platform_auth_stub.dart' if (dart.library.js_interop) 'platform_auth_web.dart' as platform;

/// Platform pieces of sign-in that differ between Flutter web and the
/// native (Android / iOS) app.
abstract final class PlatformAuth {
  /// An HTTP client that sends the SERVE session cookie (web) or a plain one.
  static http.Client httpClient() => platform.httpClient();

  /// Web: leave this page for [url] (Google sign-in) in the same tab.
  static Future<void> navigateTo(Uri url) => platform.navigateTo(url);

  /// Web: the `?error=` code Better Auth added after a refused Google sign-in,
  /// removed from the address bar so a refresh does not repeat it.
  static String? takeSignInError() => platform.takeSignInError();

  /// Web: this app's root URL (where Google sign-in returns).
  static Uri? webAppRoot() => platform.webAppRoot();
}
