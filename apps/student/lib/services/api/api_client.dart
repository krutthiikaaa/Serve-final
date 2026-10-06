import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../core/api_exception.dart';

typedef TokenProvider = Future<String?> Function({bool forceRefresh});

class ApiResponse {
  const ApiResponse(this.status, this.body, this.headers);
  final int status;
  final Map<String, dynamic> body;
  final Map<String, String> headers;

  T data<T>() => body['data'] as T;
}

/// HTTP client for the SERVE backend: `/api` prefix, bearer token, one retry
/// with a refreshed token after `AUTH_TOKEN_EXPIRED`, and the backend error
/// envelope mapped to [ApiException].
class ApiClient {
  ApiClient({required this.baseUrl, required this._token, http.Client? httpClient, this.timeout = const Duration(seconds: 20)})
    : _http = httpClient ?? http.Client();

  final String baseUrl;
  final TokenProvider _token;
  final http.Client _http;
  final Duration timeout;

  Future<ApiResponse> request(
    String method,
    String path, {
    Object? body,
    Map<String, Object?>? query,
    Map<String, String>? headers,
    bool anonymous = false,
  }) async {
    final uri = Uri.parse('$baseUrl/api$path').replace(
      queryParameters: query == null
          ? null
          : {
              for (final e in query.entries)
                if (e.value != null && e.value.toString().isNotEmpty) e.key: e.value.toString(),
            },
    );

    Future<http.Response> attempt({required bool forceRefresh}) async {
      final h = <String, String>{'Accept': 'application/json', ...?headers};
      if (body != null) h['Content-Type'] = 'application/json';
      if (!anonymous) {
        final token = await _token(forceRefresh: forceRefresh);
        if (token != null) h['Authorization'] = 'Bearer $token';
      }
      final req = http.Request(method, uri)..headers.addAll(h);
      if (body != null) req.body = jsonEncode(body);
      try {
        return await http.Response.fromStream(await _http.send(req).timeout(timeout));
      } catch (_) {
        throw const ApiException(0, 'NETWORK_ERROR', ApiException.networkMessage);
      }
    }

    var res = await attempt(forceRefresh: false);
    if (res.statusCode == 401 && !anonymous && _code(res) == 'AUTH_TOKEN_EXPIRED') {
      res = await attempt(forceRefresh: true);
    }
    final decoded = res.body.isEmpty ? <String, dynamic>{} : _decode(res.body);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      final error = (decoded['error'] as Map?)?.cast<String, dynamic>();
      throw ApiException(
        res.statusCode,
        (error?['code'] as String?) ?? 'UNKNOWN',
        (error?['message'] as String?) ?? '',
        details: error?['details'],
        requestId: error?['requestId'] as String?,
      );
    }
    return ApiResponse(res.statusCode, decoded, res.headers);
  }

  Future<T> data<T>(
    String method,
    String path, {
    Object? body,
    Map<String, Object?>? query,
    Map<String, String>? headers,
    bool anonymous = false,
  }) async => (await request(method, path, body: body, query: query, headers: headers, anonymous: anonymous)).data<T>();

  static Map<String, dynamic> _decode(String body) {
    try {
      return (jsonDecode(body) as Map).cast<String, dynamic>();
    } catch (_) {
      return {};
    }
  }

  static String? _code(http.Response res) => ((_decode(res.body)['error'] as Map?)?['code']) as String?;
}
