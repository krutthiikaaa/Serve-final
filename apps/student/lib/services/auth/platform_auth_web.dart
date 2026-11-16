// dart:html is the supported page/history API on Flutter web here (as in sso_tab_web).
// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use
import 'dart:html' as html;

import 'package:http/browser_client.dart';
import 'package:http/http.dart' as http;

/// The session is an HttpOnly cookie on the SERVE backend: send it.
http.Client httpClient() => BrowserClient()..withCredentials = true;

Future<void> navigateTo(Uri url) async => html.window.location.assign(url.toString());

String? takeSignInError() {
  final uri = Uri.base;
  final code = uri.queryParameters['error'];
  if (code == null || code.isEmpty) return null;
  final params = Map<String, String>.of(uri.queryParameters)
    ..remove('error')
    ..remove('error_description');
  final clean = uri.replace(queryParameters: params.isEmpty ? null : params);
  html.window.history.replaceState(null, '', clean.toString().replaceFirst(RegExp(r'\?$'), ''));
  return code;
}

Uri? webAppRoot() {
  final base = Uri.base;
  return Uri(scheme: base.scheme, host: base.host, port: base.hasPort ? base.port : null, path: '/');
}
