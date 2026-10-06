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
import 'package:serve_student/services/auth/firebase_auth_client.dart';
import 'package:serve_student/services/auth/session_store.dart';
import 'package:serve_student/services/realtime/realtime_service.dart';

/// The student app's real service layer (Firebase REST auth, API client,
/// Socket.IO) against a running backend and the Firebase Auth Emulator.
///
///   SERVE_INTEGRATION=1 DEV_SEED_PASSWORD=… flutter test --tags integration
///
/// Uses the development demo staff account (staff.kg@serve.dev) to move the
/// order through the kitchen, and collects it at the end.
void main() {
  final env = Platform.environment;
  final enabled = env['SERVE_INTEGRATION'] == '1';
  final config = AppConfig(
    apiUrl: env['API_URL'] ?? 'http://localhost:5001',
    firebaseApiKey: 'demo-api-key',
    firebaseProjectId: 'demo-serve',
    authEmulatorHost: env['FIREBASE_AUTH_EMULATOR_HOST'] ?? '127.0.0.1:9099',
  );

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

  Future<void> staffSetStatus(String orderId, String status) async {
    final email = env['SERVE_STAFF_EMAIL'] ?? 'staff.kg@serve.dev';
    final staff = await FirebaseAuthClient(config).signIn(email, env['DEV_SEED_PASSWORD'] ?? '');
    final res = await http.patch(
      Uri.parse('${config.apiUrl}/api/staff/orders/$orderId/status'),
      headers: {'Authorization': 'Bearer ${staff.idToken}', 'Content-Type': 'application/json'},
      body: jsonEncode({'status': status}),
    );
    expect(res.statusCode, 200, reason: res.body);
  }

  setUpAll(() {
    if (!enabled) return;
    auth = AuthController(firebase: FirebaseAuthClient(config), store: MemorySessionStore());
    api = ServeApi(ApiClient(baseUrl: config.apiUrl, token: auth.idToken));
    auth.attach(api.me);
    realtime = SocketRealtimeService(url: config.apiUrl, token: auth.idToken);
    sub = realtime.events.listen(events.add);
  });

  tearDownAll(() async {
    if (!enabled) return;
    await sub?.cancel();
    realtime.dispose();
  });

  test('register → browse → quote → idempotent order → mock payment → live kitchen updates → pickup', () async {
    // 1. Firebase account + SERVE registration (hostel decides the default canteen).
    final email = 'flutter.${DateTime.now().millisecondsSinceEpoch}@serve.test';
    await auth.createAccount(email, 'flutter-pass-1');
    expect(await api.me(), isA<UnregisteredMe>());
    final hostels = await api.hostels();
    final krishna = hostels.firstWhere((h) => h.name == 'Krishna');
    final me = await api.registerStudent(name: 'Flutter Integration', email: email, hostelId: krishna.id);
    auth.setMe(me);
    expect(me.defaultCanteen.id, krishna.canteen.id);

    // 2. Authenticated socket; the server assigns the rooms.
    realtime.start();
    await eventually(() => realtime.state == LiveState.connected ? true : null);
    expect(await realtime.subscribeMenu(me.defaultCanteen.id), isTrue);

    // 3. Menu, recommendations and an authoritative quote.
    final menu = await api.menu(me.defaultCanteen.id);
    final item = menu.visibleCategories.expand((c) => c.items).firstWhere((i) => i.isOrderable);
    final recommendations = await api.recommendations(me.defaultCanteen.id);
    expect(recommendations.items, isNotEmpty);
    final quote = await api.quote(me.defaultCanteen.id, [CartLineInput(item.id, 2)]);
    expect(quote.totalPaise, item.pricePaise * 2);

    // 4. One key per checkout attempt: a retry returns the same order.
    final key = uuidV4();
    final placed = await api.placeOrder(me.defaultCanteen.id, [CartLineInput(item.id, 2)], idempotencyKey: key);
    final replay = await api.placeOrder(me.defaultCanteen.id, [CartLineInput(item.id, 2)], idempotencyKey: key);
    expect(replay.id, placed.id);
    expect(placed.status, OrderStatus.placed);
    expect(placed.totalPaise, quote.totalPaise);

    // 5. Mock gateway.
    final session = await api.initiatePayment(placed.id);
    expect(session.amountPaise, placed.totalPaise);
    final paid = await api.completeMockPayment(placed.id);
    expect(paid.status, OrderStatus.paymentConfirmed);
    await eventually(() => events.where((e) => e.type == 'order.payment_confirmed' && e.orderId == placed.id).firstOrNull);

    // 6. The kitchen moves the order; the student sees each step live.
    for (final (status, event) in [('PREPARING', 'order.preparing'), ('READY', 'order.ready')]) {
      await staffSetStatus(placed.id, status);
      final live = await eventually(() => events.where((e) => e.type == event && e.orderId == placed.id).firstOrNull);
      final order = StudentOrder.fromJson((live.data['order'] as Map).cast<String, dynamic>());
      expect(order.orderNumber, placed.orderNumber);
      expect((live.data['order'] as Map).containsKey('student'), isFalse, reason: 'students get the student view');
    }
    await eventually(() => events.where((e) => e.type == 'notification.created').firstOrNull);
    final notes = await api.notifications(unreadOnly: true);
    expect(notes.items.map((n) => n.type), contains('ORDER_READY'));

    // 7. Pickup.
    await staffSetStatus(placed.id, 'COLLECTED');
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
  }, skip: enabled ? false : 'Set SERVE_INTEGRATION=1 (needs backend + Firebase Auth Emulator)');
}
