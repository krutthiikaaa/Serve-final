import 'package:http/http.dart' as http;

http.Client httpClient() => http.Client();

Future<void> navigateTo(Uri url) => throw UnsupportedError('Web only');

String? takeSignInError() => null;

Uri? webAppRoot() => null;
