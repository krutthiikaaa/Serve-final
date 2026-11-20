import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/app.dart';
import 'package:serve_student/config/app_config.dart';
import 'package:serve_student/core/api_exception.dart';
import 'package:serve_student/services/api/api_client.dart';
import 'package:serve_student/services/api/models.dart';
import 'package:serve_student/services/api/serve_api.dart';
import 'package:serve_student/services/auth/auth_controller.dart';
import 'package:serve_student/services/auth/serve_auth_client.dart';
import 'package:serve_student/services/auth/session_store.dart';
import 'package:serve_student/services/favourites/favourites_store.dart';
import 'package:serve_student/services/realtime/realtime_service.dart';

import 'fixtures.dart' as fx;

const testConfig = AppConfig(
  apiUrl: 'http://localhost:5001',
  staffDashboardUrl: 'http://localhost:5173',
  adminPortalUrl: 'http://localhost:5174',
);

/// In-memory backend double with call recording. Every method can be
/// overridden per test; defaults return realistic fixtures.
class FakeServeApi extends ServeApi {
  FakeServeApi() : super(ApiClient(baseUrl: 'http://fake', token: ({bool forceRefresh = false}) async => 'token'));

  final calls = <String>[];
  Me meValue = fx.studentMe();
  List<Hostel> hostelList = [
    Hostel.fromJson({
      'id': '1c35f533-0000-4000-8000-000000000001',
      'name': 'Krishna',
      'serviceArea': {'id': fx.kgAreaId, 'name': 'Krishna & Godavari'},
      'canteen': {'id': fx.kgId, 'name': 'Krishna & Godavari Night Canteen', 'type': 'NIGHT'},
    }),
  ];
  List<Canteen> canteenList = [
    Canteen.fromJson(fx.canteenJson()),
    Canteen.fromJson(fx.canteenJson(id: fx.vedId, name: 'Vedavathi Night Canteen')),
  ];
  Map<String, Menu> menus = {
    fx.kgId: fx.menu(),
    fx.vedId: fx.menu(canteenId: fx.vedId, name: 'Vedavathi Night Canteen'),
    fx.kgDayId: fx.menu(canteenId: fx.kgDayId, name: 'Krishna & Godavari Day Canteen', status: 'PAUSED', state: 'OTHER_SERVICE_ACTIVE'),
  };

  /// The student's service area: Night serves, Day is off duty (seed default).
  StudentService? serviceValue;
  Recommendations recommendationsValue = Recommendations(RecommendationBasis.popular, [
    fx.item('a1000000-0000-4000-8000-000000000001', 'Veg Grilled Sandwich', price: 5000),
  ]);
  List<StudentOrder> activeOrders = [];
  List<StudentOrder> pastOrders = [];
  Map<String, StudentOrder> ordersById = {};
  Future<Quote> Function(String canteenId, List<CartLineInput> items, ServicePeriod period)? onQuote;
  Future<StudentOrder> Function(String canteenId, List<CartLineInput> items, String key)? onPlaceOrder;
  Future<StudentOrder> Function(String orderId, bool succeed)? onMockComplete;
  Future<StudentOrder> Function(String orderId, String? utr)? onClaim;
  Map<String, CanteenPaymentConfig> paymentConfigs = {
    fx.kgId: CanteenPaymentConfig.fromJson(fx.paymentConfigJson()),
    fx.vedId: CanteenPaymentConfig.fromJson(fx.paymentConfigJson(canteenId: fx.vedId)),
  };
  StudentMe Function(String name, String hostelId)? onRegister;
  List<AppNotification> notificationList = [];
  int unread = 0;
  final idempotencyKeys = <String>[];

  @override
  Future<Me> me() async {
    final error = meError;
    if (error != null) throw error;
    return meValue;
  }

  /// When set, `/api/auth/me` fails with it (e.g. a 401 after the session ended).
  Object? meError;

  @override
  Future<List<Hostel>> hostels() async => hostelList;

  @override
  Future<StudentMe> registerStudent({required String name, required String hostelId}) async {
    calls.add('register:$name:$hostelId');
    return onRegister?.call(name, hostelId) ?? fx.studentMe();
  }

  @override
  Future<List<Canteen>> canteens() async => canteenList;

  @override
  Future<List<Ref>> canteenDirectory() async => [for (final c in canteenList) Ref(c.id, c.name, c.type)];

  @override
  Future<Menu> menu(String canteenId) async {
    final m = menus[canteenId]!;
    calls.add('menu:$canteenId:${m.servicePeriod.apiValue}');
    return m;
  }

  @override
  Future<StudentService> studentService() async {
    calls.add('service');
    if (serviceValue != null) return serviceValue!;
    final canteens = [
      for (final id in [fx.kgDayId, fx.kgId])
        if (menus[id] != null) menus[id]!.canteen,
    ];
    final open = canteens.where((c) => c.availability?.state == AvailabilityState.open).toList();
    return StudentService(
      hostel: const Ref('1c35f533-0000-4000-8000-000000000001', 'Krishna'),
      serviceArea: const Ref(fx.kgAreaId, 'Krishna & Godavari'),
      canteens: canteens,
      current: open.isNotEmpty ? open.first : (canteens.isEmpty ? null : canteens.last),
      unavailable: open.isEmpty,
    );
  }

  @override
  Future<CanteenPaymentConfig> orderPaymentConfig(String orderId) async {
    calls.add('orderPaymentConfig:$orderId');
    final canteenId = ordersById[orderId]?.canteen.id ?? fx.kgId;
    return paymentConfigs[canteenId] ?? CanteenPaymentConfig.fromJson(fx.paymentConfigJson(canteenId: canteenId));
  }

  @override
  Future<CanteenPaymentConfig> paymentConfig(String canteenId) async {
    calls.add('paymentConfig:$canteenId');
    return paymentConfigs[canteenId] ?? CanteenPaymentConfig.fromJson(fx.paymentConfigJson(canteenId: canteenId));
  }

  @override
  Future<MenuItemDetail> menuItem(String id) async {
    for (final m in menus.values) {
      for (final c in m.categories) {
        for (final i in c.items) {
          if (i.id == id) return MenuItemDetail(item: i, category: Ref(c.id, c.name), canteen: m.canteen);
        }
      }
    }
    throw const ApiException(404, 'MENU_ITEM_NOT_FOUND', 'Menu item not found.');
  }

  @override
  Future<Recommendations> recommendations(String canteenId) async => recommendationsValue;

  @override
  Future<Quote> quote(String canteenId, List<CartLineInput> items) async {
    final period = menus[canteenId]?.servicePeriod ?? ServicePeriod.night;
    calls.add('quote:${period.apiValue}:${items.map((i) => '${i.menuItemId}x${i.quantity}').join(',')}');
    if (onQuote != null) return onQuote!(canteenId, items, period);
    final m = menus[canteenId]!;
    final lines = [
      for (final i in items)
        () {
          final mi = m.categories.expand((c) => c.items).firstWhere((x) => x.id == i.menuItemId);
          return {
            'menuItemId': mi.id,
            'itemName': mi.name,
            'unitPricePaise': mi.pricePaise,
            'quantity': i.quantity,
            'lineTotalPaise': mi.pricePaise * i.quantity,
          };
        }(),
    ];
    return Quote.fromJson({
      'canteen': {'id': canteenId, 'name': m.canteen.name},
      'servicePeriod': period.apiValue,
      'items': lines,
      'itemCount': items.fold<int>(0, (n, i) => n + i.quantity),
      'subtotalPaise': 99900,
      // Deliberately different from any client-side sum: the UI must show this value.
      'totalPaise': 99900,
      'currency': 'INR',
    });
  }

  @override
  Future<StudentOrder> placeOrder(String canteenId, List<CartLineInput> items, {required String idempotencyKey}) async {
    idempotencyKeys.add(idempotencyKey);
    calls.add('placeOrder');
    if (onPlaceOrder != null) return onPlaceOrder!(canteenId, items, idempotencyKey);
    return fx.order(status: 'PLACED', total: 99900);
  }

  @override
  Future<PageResult<StudentOrder>> orders({required String status, String? cursor, int limit = 20}) async =>
      PageResult(status == 'active' ? activeOrders.take(limit).toList() : pastOrders, null);

  @override
  Future<StudentOrder> order(String id) async {
    calls.add('order:$id');
    return ordersById[id] ?? fx.order(status: 'PAYMENT_CONFIRMED');
  }

  @override
  Future<StudentOrder> cancelOrder(String id) async => fx.order(status: 'CANCELLED');

  @override
  Future<PaymentSession> initiatePayment(String orderId) async {
    calls.add('initiate:$orderId');
    return PaymentSession(orderId: orderId, provider: 'MOCK', providerOrderId: 'mock_order_1', amountPaise: 99900);
  }

  @override
  Future<StudentOrder> claimPayment(String orderId, {String? utr}) async {
    calls.add('claim:$orderId:${utr ?? ''}');
    if (onClaim != null) return onClaim!(orderId, utr);
    return fx.order(status: 'PLACED', total: 99900);
  }

  @override
  Future<StudentOrder> completeMockPayment(String orderId, {bool succeed = true}) async {
    calls.add('mockComplete:$succeed');
    if (onMockComplete != null) return onMockComplete!(orderId, succeed);
    if (!succeed) throw const ApiException(422, 'PAYMENT_FAILED', 'Payment failed.');
    return fx.order(status: 'PAYMENT_CONFIRMED', total: 99900);
  }

  @override
  Future<PageResult<AppNotification>> notifications({String? cursor, bool unreadOnly = false}) async =>
      PageResult(unreadOnly ? notificationList.where((n) => !n.isRead).toList() : notificationList, null, unreadCount: unread);

  @override
  Future<void> markNotificationRead(String id) async => calls.add('read:$id');

  @override
  Future<void> markAllNotificationsRead() async {
    calls.add('readAll');
    unread = 0;
  }
}

class FakeRealtime extends RealtimeService {
  final _events = StreamController<RealtimeEvent>.broadcast();
  LiveState _state = LiveState.disconnected;
  int _epoch = 0;
  final subscriptions = <String>[];
  bool started = false;

  @override
  LiveState get state => _state;
  @override
  int get epoch => _epoch;
  @override
  Stream<RealtimeEvent> get events => _events.stream;

  @override
  void start() {
    started = true;
    connect();
  }

  @override
  void stop() {
    started = false;
    _state = LiveState.disconnected;
    notifyListeners();
  }

  /// Simulates a (re)connection.
  void connect() {
    _epoch++;
    _state = LiveState.connected;
    notifyListeners();
  }

  void emit(String type, Map<String, dynamic> data) => _events.add(RealtimeEvent(type, data));

  @override
  Future<bool> subscribeMenu(String canteenId) async {
    subscriptions.add(canteenId);
    return true;
  }
}

/// Google sign-in double: the system-browser step and the backend exchange
/// are replaced; AuthController and everything above it are real.
class FakeAuthClient extends ServeAuthClient {
  FakeAuthClient() : super(testConfig);
  final calls = <String>[];

  /// When set, sign-in fails with this (e.g. a non-SRM account).
  AuthException? signInError;

  /// When set, sign-in waits for it to complete (to observe loading states).
  Completer<void>? signInGate;

  @override
  Future<String> nativeSignIn() async {
    calls.add('google');
    await signInGate?.future;
    if (signInError != null) throw signInError!;
    return 'session-token';
  }

  @override
  Future<void> signOut({String? token}) async {
    calls.add('signOut:$token');
  }
}

class TestHarness {
  TestHarness({FakeServeApi? api, FavouritesStore? favouritesStore, AppConfig config = testConfig}) : api = api ?? FakeServeApi() {
    auth = AuthController(client: google, store: store, isWeb: false)..attach(this.api.me);
    services = AppServices(config: config, auth: auth, api: this.api, realtime: realtime, favouritesStore: favouritesStore);
  }

  final FakeServeApi api;
  final realtime = FakeRealtime();
  final google = FakeAuthClient();
  final store = MemorySessionStore();
  late final AuthController auth;
  late final AppServices services;

  Widget get app => ServeApp(services: services);

  /// Signed in as a registered student, on the home tab.
  Future<void> pumpSignedIn(WidgetTester tester) async {
    await tester.pumpWidget(app);
    await auth.signInWithGoogle();
    await tester.pumpAndSettle();
  }
}

/// A phone-sized surface for widget tests.
void usePhoneSize(WidgetTester tester) {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}
