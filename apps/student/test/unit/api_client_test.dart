import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:serve_student/core/api_exception.dart';
import 'package:serve_student/services/api/api_client.dart';
import 'package:serve_student/services/api/serve_api.dart';

http.Response json(int status, Object body) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});
Map<String, Object> err(String code, [String message = 'msg', Object? details]) => {
  'error': {'code': code, 'message': message, 'requestId': 'req-1', 'details': ?details},
};

void main() {
  group('ApiClient', () {
    test('prefixes /api, drops empty query values and sends the bearer token', () async {
      late http.Request seen;
      final client = ApiClient(
        baseUrl: 'http://localhost:5001',
        token: ({bool forceRefresh = false}) async => 'cached',
        httpClient: MockClient((req) async {
          seen = req;
          return json(200, {'data': []});
        }),
      );
      await client.request('GET', '/orders', query: {'status': 'active', 'cursor': null, 'limit': 20});
      expect(seen.url.toString(), 'http://localhost:5001/api/orders?status=active&limit=20');
      expect(seen.headers['Authorization'], 'Bearer cached');
    });

    test('retries once with a forced refresh after AUTH_TOKEN_EXPIRED', () async {
      final forced = <bool>[];
      var calls = 0;
      final client = ApiClient(
        baseUrl: 'http://x',
        token: ({bool forceRefresh = false}) async {
          forced.add(forceRefresh);
          return forceRefresh ? 'fresh' : 'stale';
        },
        httpClient: MockClient((req) async {
          calls++;
          return req.headers['Authorization'] == 'Bearer fresh' ? json(200, {'data': 'ok'}) : json(401, err('AUTH_TOKEN_EXPIRED'));
        }),
      );
      expect(await client.data<String>('GET', '/auth/me'), 'ok');
      expect(calls, 2);
      expect(forced, [false, true]);
    });

    test('maps the error envelope and keeps details', () async {
      final client = ApiClient(
        baseUrl: 'http://x',
        token: ({bool forceRefresh = false}) async => 't',
        httpClient: MockClient((_) async => json(409, err('CANTEEN_NOT_ACCEPTING_ORDERS', 'paused'))),
      );
      final e = await caught(client.request('POST', '/orders', body: {}));
      expect(e.status, 409);
      expect(e.code, 'CANTEEN_NOT_ACCEPTING_ORDERS');
      expect(e.requestId, 'req-1');
      expect(e.userMessage, 'This canteen is currently not accepting orders.');
    });

    test('network failures become status 0 with a friendly message', () async {
      final client = ApiClient(
        baseUrl: 'http://x',
        token: ({bool forceRefresh = false}) async => 't',
        httpClient: MockClient((_) async => throw const SocketLikeException()),
      );
      final e = await caught(client.request('GET', '/canteens'));
      expect(e.isNetwork, isTrue);
      expect(e.userMessage, ApiException.networkMessage);
    });

    test('public endpoints send no token', () async {
      late http.Request seen;
      final client = ApiClient(
        baseUrl: 'http://x',
        token: ({bool forceRefresh = false}) async => fail('token requested'),
        httpClient: MockClient((req) async {
          seen = req;
          return json(200, {'data': []});
        }),
      );
      await client.request('GET', '/hostels', anonymous: true);
      expect(seen.headers.containsKey('Authorization'), isFalse);
    });
  });

  group('ServeApi request bodies (never prices, totals or ids the contract does not ask for)', () {
    late List<http.Request> requests;
    ServeApi api(http.Response Function(http.Request) handler) {
      requests = [];
      return ServeApi(
        ApiClient(
          baseUrl: 'http://x',
          token: ({bool forceRefresh = false}) async => 't',
          httpClient: MockClient((req) async {
            requests.add(req);
            return handler(req);
          }),
        ),
      );
    }

    test('placeOrder sends only canteenId + item ids/quantities and the Idempotency-Key', () async {
      final a = api((_) => json(201, {'data': _orderJson}));
      await a.placeOrder('c1', const [CartLineInput('i1', 2)], idempotencyKey: 'key-123456789');
      expect(jsonDecode(requests.single.body), {
        'canteenId': 'c1',
        'items': [
          {'menuItemId': 'i1', 'quantity': 2},
        ],
      });
      expect(requests.single.headers['Idempotency-Key'], 'key-123456789');
    });

    test('quote problems surface as CartIssuesException', () async {
      final a = api(
        (_) => json(
          422,
          err('ITEM_UNAVAILABLE', 'This item is currently unavailable.', {
            'items': [
              {'menuItemId': 'i1', 'reason': 'UNAVAILABLE'},
              {'menuItemId': 'i2', 'reason': 'INACTIVE'},
            ],
          }),
        ),
      );
      await expectLater(
        a.quote('c1', const [CartLineInput('i1', 1), CartLineInput('i2', 1)]),
        throwsA(isA<CartIssuesException>().having((e) => e.issues.map((i) => i.reason).toList(), 'reasons', ['UNAVAILABLE', 'INACTIVE'])),
      );
    });

    test('mock payment posts the outcome only', () async {
      final a = api(
        (_) => json(200, {
          'data': {'order': _orderJson, 'confirmation': {}},
        }),
      );
      await a.completeMockPayment('o1', succeed: false);
      expect(jsonDecode(requests.single.body), {'outcome': 'failure'});
    });
  });
}

Future<ApiException> caught(Future<Object?> call) async {
  try {
    await call;
  } on ApiException catch (e) {
    return e;
  }
  throw StateError('expected an ApiException');
}

class SocketLikeException implements Exception {
  const SocketLikeException();
}

const _orderJson = {
  'id': 'o1',
  'orderNumber': 'SV1001',
  'status': 'PLACED',
  'totalPaise': 12000,
  'currency': 'INR',
  'canteen': {'id': 'c1', 'name': 'K&G'},
  'items': <Object>[],
  'payment': null,
  'createdAt': '2026-10-06T19:00:00.000Z',
  'updatedAt': '2026-10-06T19:00:00.000Z',
  'paidAt': null,
  'preparingAt': null,
  'readyAt': null,
  'collectedAt': null,
  'cancelledAt': null,
  'cancelReason': null,
  'timeline': [
    {'status': 'PLACED', 'at': '2026-10-06T19:00:00.000Z'},
  ],
};
