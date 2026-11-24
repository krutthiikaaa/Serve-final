@Tags(['integration'])
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:serve_student/config/app_config.dart';
import 'package:serve_student/core/ids.dart';
import 'package:serve_student/services/api/api_client.dart';
import 'package:serve_student/services/api/models.dart';
import 'package:serve_student/services/api/serve_api.dart';
import 'package:serve_student/services/auth/auth_controller.dart';
import 'package:serve_student/services/auth/serve_auth_client.dart';
import 'package:serve_student/services/auth/session_store.dart';
import 'package:serve_student/services/realtime/realtime_service.dart';

/// The student app's real service layer (session restore, Bearer API client,
/// Socket.IO) against a running backend in test mode (NODE_ENV=test,
/// AUTH_TEST_SIGN_IN=true). Google cannot run here, so the student's identity
/// comes from the backend's test-only sign-in, which applies the same SRM
/// rules and records a Google session.
///
///   SERVE_INTEGRATION=1 API_URL=http://localhost:5101 flutter test --tags integration
///
/// Uses an approved K&G Night staff account with the KITCHEN and CASHIER
/// capabilities (admin portal → Staff) to move the order through the kitchen.
/// Staff sign in with email + password: SERVE_STAFF_EMAIL and
/// SERVE_STAFF_PASSWORD (required).
void main() {
  final env = Platform.environment;
  final enabled = env['SERVE_INTEGRATION'] == '1';
  final config = AppConfig(apiUrl: env['API_URL'] ?? 'http://localhost:5001');
  final store = MemorySessionStore();

  /// A real Better Auth session token from the backend's test-only sign-in.
  Future<String> testSignIn(String email) async {
    final res = await http.post(
      Uri.parse('${config.apiUrl}/api/auth/test/sign-in'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email}),
    );
    expect(res.statusCode, 200, reason: res.body);
    return (jsonDecode(res.body) as Map)['token'] as String;
  }

  /// A staff session: the real email + password sign-in (staff cannot use Google).
  String? staffToken;
  Future<String> staffSignIn() async {
    final res = await http.post(
      Uri.parse('${config.apiUrl}/api/auth/sign-in/email'),
      headers: {'Content-Type': 'application/json', 'Origin': 'http://localhost:5173'},
      body: jsonEncode({'email': env['SERVE_STAFF_EMAIL'], 'password': env['SERVE_STAFF_PASSWORD']}),
    );
    expect(res.statusCode, 200, reason: res.body);
    // The signed session cookie value is the Bearer credential.
    final cookie = RegExp(r'serve\.session_token=([^;]+)').firstMatch(res.headers['set-cookie'] ?? '');
    expect(cookie, isNotNull, reason: 'session cookie');
    return Uri.decodeComponent(cookie!.group(1)!);
  }

  late AuthController auth;
  late ServeApi api;
  late SocketRealtimeService realtime;
  final events = <RealtimeEvent>[];
  StreamSubscription<RealtimeEvent>? sub;

  Future<T> eventually<T>(T? Function() probe, {Duration timeout = const Duration(seconds: 10)}) async {
    final deadline = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(deadline)) {
      final value = probe();
      if (value != null) return value;
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
    throw TimeoutException('condition not met; events: ${events.map((e) => e.type).toList()}');
  }

  Future<http.Response> staffRequest(String method, String path, {Object? body, String? canteenId}) async {
    staffToken ??= await staffSignIn();
    final uri = Uri.parse('${config.apiUrl}$path').replace(queryParameters: canteenId == null ? null : {'canteenId': canteenId});
    final request = http.Request(method, uri)..headers.addAll({'Authorization': 'Bearer $staffToken', 'Content-Type': 'application/json'});
    if (body != null) request.body = jsonEncode(body);
    return http.Response.fromStream(await http.Client().send(request));
  }

  Future<void> staffConfirmDemo(String orderId, String canteenId) async {
    final res = await staffRequest(
      'POST',
      '/api/staff/orders/$orderId/confirm-demo-payment',
      body: {'simulatedPaymentReceived': true},
      canteenId: canteenId,
    );
    expect(res.statusCode, 200, reason: res.body);
  }

  Future<void> staffSetStatus(String orderId, String status, String canteenId) async {
    final res = await staffRequest('PATCH', '/api/staff/orders/$orderId/status', body: {'status': status}, canteenId: canteenId);
    expect(res.statusCode, 200, reason: res.body);
  }

  setUpAll(() {
    if (!enabled) return;
    auth = AuthController(client: ServeAuthClient(config), store: store, isWeb: false);
    api = ServeApi(ApiClient(baseUrl: config.apiUrl, token: auth.sessionToken));
    auth.attach(api.me);
    realtime = SocketRealtimeService(url: config.apiUrl, token: auth.sessionToken);
    sub = realtime.events.listen(events.add);
  });

  tearDownAll(() async {
    if (!enabled) return;
    await sub?.cancel();
    realtime.dispose();
  });

  test('register → browse → quote → idempotent order → demo claim → cashier confirm → live kitchen updates → pickup', () async {
    // 1. A signed-in SRM identity restored like an app restart, then SERVE
    //    registration (hostel decides the default canteen; email from the session).
    final email = 'flutter.${DateTime.now().millisecondsSinceEpoch}@srmap.edu.in';
    store.value = StoredSession(token: await testSignIn(email));
    await auth.restore();
    expect(auth.status, AuthStatus.ready);
    expect(auth.me, isA<UnregisteredMe>());
    expect(auth.email, email);
    final hostels = await api.hostels();
    final krishna = hostels.firstWhere((h) => h.name == 'Krishna');
    final me = await api.registerStudent(name: 'Flutter Integration', hostelId: krishna.id);
    auth.setMe(me);
    final canteen = me.defaultCanteen!;
    expect(canteen.id, krishna.canteen!.id);
    // The area's Night canteen serves by default; it identifies its type.
    expect(canteen.type, ServicePeriod.night);
    expect(me.serviceArea?.name, 'Krishna & Godavari');

    // 2. Authenticated socket; the server assigns the rooms.
    realtime.start();
    await eventually(() => realtime.state == LiveState.connected ? true : null);
    expect(await realtime.subscribeMenu(canteen.id), isTrue);

    // 3. Menu, recommendations and an authoritative quote for the selected period.
    final menu = await api.menu(canteen.id);
    expect(menu.servicePeriod, ServicePeriod.night);
    expect(menu.canteen.type, ServicePeriod.night);

    // The student's service area has a Day and a Night canteen; only Night serves now.
    final service = await api.studentService();
    expect(service.current?.id, canteen.id);
    expect(service.unavailable, isFalse);
    expect(service.ofType(ServicePeriod.day)?.availability?.state, AvailabilityState.otherServiceActive);
    final item = menu.visibleCategories.expand((c) => c.items).firstWhere((i) => i.isOrderable);
    final recommendations = await api.recommendations(canteen.id);
    expect(recommendations.items, isNotEmpty);
    final quote = await api.quote(canteen.id, [CartLineInput(item.id, 2)]);
    expect(quote.totalPaise, item.pricePaise * 2);
    expect(quote.servicePeriod, ServicePeriod.night);

    final payConfig = await api.paymentConfig(canteen.id);
    expect(payConfig.mode, PaymentMode.demo);
    expect(payConfig.demoQr?.warning, 'DEMO ONLY — NOT PAYABLE');
    expect(payConfig.upiVpa, isNull);

    // 4. One key per checkout attempt: a retry returns the same order.
    final key = uuidV4();
    final placed = await api.placeOrder(canteen.id, [CartLineInput(item.id, 2)], idempotencyKey: key);
    final replay = await api.placeOrder(canteen.id, [CartLineInput(item.id, 2)], idempotencyKey: key);
    expect(replay.id, placed.id);
    expect(placed.status, OrderStatus.placed);
    expect(placed.totalPaise, quote.totalPaise);

    // 5. Student UTR claim does not confirm payment. Cashier demo confirmation does.
    final claimed = await api.claimPayment(placed.id, utr: 'FLUTTERUTR1');
    expect(claimed.status, OrderStatus.placed);
    expect(claimed.payment?.status, 'PENDING');
    await staffConfirmDemo(placed.id, placed.canteen.id);
    final paid = await api.order(placed.id);
    expect(paid.status, OrderStatus.paymentConfirmed);
    expect(paid.payment?.isSimulated, isTrue);
    await eventually(() => events.where((e) => e.type == 'order.payment_confirmed' && e.orderId == placed.id).firstOrNull);

    // 6. The kitchen moves the order; the student sees each step live.
    for (final (status, event) in [('PREPARING', 'order.preparing'), ('READY', 'order.ready')]) {
      await staffSetStatus(placed.id, status, placed.canteen.id);
      final live = await eventually(() => events.where((e) => e.type == event && e.orderId == placed.id).firstOrNull);
      final order = StudentOrder.fromJson((live.data['order'] as Map).cast<String, dynamic>());
      expect(order.orderNumber, placed.orderNumber);
      expect((live.data['order'] as Map).containsKey('student'), isFalse, reason: 'students get the student view');
    }
    await eventually(() => events.where((e) => e.type == 'notification.created').firstOrNull);
    final notes = await api.notifications(unreadOnly: true);
    expect(notes.items.map((n) => n.type), contains('ORDER_READY'));

    // 7. Pickup.
    await staffSetStatus(placed.id, 'COLLECTED', placed.canteen.id);
    final collected = await api.order(placed.id);
    expect(collected.status, OrderStatus.collected);
    expect(collected.timeline.map((t) => t.status), [
      OrderStatus.placed,
      OrderStatus.paymentConfirmed,
      OrderStatus.preparing,
      OrderStatus.ready,
      OrderStatus.collected,
    ]);
    final past = await api.orders(status: 'past');
    expect(past.items.map((o) => o.id), contains(placed.id));
    // 8. Sign-out ends the session on the server; the token no longer works.
    await auth.signOut();
    expect(auth.status, AuthStatus.signedOut);
    expect(store.value, isNull);
  }, skip: enabled ? false : 'Set SERVE_INTEGRATION=1, SERVE_STAFF_EMAIL and SERVE_STAFF_PASSWORD (needs a backend with NODE_ENV=test and AUTH_TEST_SIGN_IN=true)');
}
