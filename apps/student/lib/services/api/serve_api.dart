import '../../core/api_exception.dart';
import 'api_client.dart';
import 'models.dart';

Map<String, dynamic> _m(Object? v) => (v! as Map).cast<String, dynamic>();
List<Map<String, dynamic>> _l(Object? v) => (v! as List).map((e) => (e as Map).cast<String, dynamic>()).toList();

class CartLineInput {
  const CartLineInput(this.menuItemId, this.quantity);
  final String menuItemId;
  final int quantity;
  Map<String, Object> toJson() => {'menuItemId': menuItemId, 'quantity': quantity};
}

/// Thrown by [ServeApi.quote] / [ServeApi.placeOrder] when cart lines are refused.
class CartIssuesException implements Exception {
  const CartIssuesException(this.issues, this.message);
  final List<CartIssue> issues;
  final String message;
}

/// Typed student endpoints. The client never sends prices, totals, roles,
/// student ids or anything the contract does not ask for.
class ServeApi {
  ServeApi(this.client);
  final ApiClient client;

  Future<Me> me() async => Me.fromJson(_m(await client.data<Object>('GET', '/auth/me')));

  Future<List<Hostel>> hostels() async => _l(await client.data<Object>('GET', '/hostels', anonymous: true)).map(Hostel.fromJson).toList();

  Future<StudentMe> registerStudent({required String name, required String email, required String hostelId}) async => StudentMe.fromJson(
    _m(await client.data<Object>('POST', '/auth/student/register', body: {'name': name, 'email': email, 'hostelId': hostelId})),
  );

  Future<List<Canteen>> canteens() async => _l(await client.data<Object>('GET', '/canteens')).map(Canteen.fromJson).toList();

  Future<Menu> menu(String canteenId) async => Menu.fromJson(_m(await client.data<Object>('GET', '/canteens/$canteenId/menu')));

  Future<MenuItemDetail> menuItem(String id) async => MenuItemDetail.fromJson(_m(await client.data<Object>('GET', '/menu/items/$id')));

  Future<Recommendations> recommendations(String canteenId) async =>
      Recommendations.fromJson(_m(await client.data<Object>('GET', '/students/me/recommendations', query: {'canteenId': canteenId})));

  Future<Quote> quote(String canteenId, List<CartLineInput> items) => _withCartIssues(
    () async => Quote.fromJson(
      _m(await client.data<Object>('POST', '/cart/quote', body: {'canteenId': canteenId, 'items': items.map((i) => i.toJson()).toList()})),
    ),
  );

  /// [idempotencyKey] is generated once per checkout attempt and reused on retries.
  Future<StudentOrder> placeOrder(String canteenId, List<CartLineInput> items, {required String idempotencyKey}) => _withCartIssues(
    () async => StudentOrder.fromJson(
      _m(
        await client.data<Object>(
          'POST',
          '/orders',
          body: {'canteenId': canteenId, 'items': items.map((i) => i.toJson()).toList()},
          headers: {'Idempotency-Key': idempotencyKey},
        ),
      ),
    ),
  );

  Future<PageResult<StudentOrder>> orders({required String status, String? cursor, int limit = 20}) async {
    final res = await client.request('GET', '/orders', query: {'status': status, 'limit': limit, 'cursor': cursor});
    return PageResult(_l(res.body['data']).map(StudentOrder.fromJson).toList(), res.body['nextCursor'] as String?);
  }

  Future<StudentOrder> order(String id) async => StudentOrder.fromJson(_m(await client.data<Object>('GET', '/orders/$id')));

  Future<StudentOrder> cancelOrder(String id) async => StudentOrder.fromJson(_m(await client.data<Object>('POST', '/orders/$id/cancel')));

  Future<PaymentSession> initiatePayment(String orderId) async =>
      PaymentSession.fromJson(_m(await client.data<Object>('POST', '/payments/$orderId/initiate')));

  /// Development mock gateway. Real Razorpay checkout will call `/verify` instead.
  Future<StudentOrder> completeMockPayment(String orderId, {bool succeed = true}) async {
    final data = _m(
      await client.data<Object>('POST', '/payments/$orderId/mock-complete', body: {'outcome': succeed ? 'success' : 'failure'}),
    );
    return StudentOrder.fromJson(_m(data['order']));
  }

  Future<PageResult<AppNotification>> notifications({String? cursor, bool unreadOnly = false}) async {
    final res = await client.request('GET', '/notifications', query: {'limit': 20, 'cursor': cursor, 'unread': unreadOnly ? 'true' : null});
    return PageResult(
      _l(res.body['data']).map(AppNotification.fromJson).toList(),
      res.body['nextCursor'] as String?,
      unreadCount: res.body['unreadCount'] as int?,
    );
  }

  Future<void> markNotificationRead(String id) => client.request('PATCH', '/notifications/$id/read');

  Future<void> markAllNotificationsRead() => client.request('PATCH', '/notifications/read-all');

  static Future<T> _withCartIssues<T>(Future<T> Function() call) async {
    try {
      return await call();
    } on ApiException catch (e) {
      final details = e.details;
      if (e.code == 'ITEM_UNAVAILABLE' && details is Map && details['items'] is List) {
        final issues = [
          for (final raw in details['items'] as List)
            if (raw is Map) CartIssue(raw['menuItemId'] as String, raw['reason'] as String),
        ];
        throw CartIssuesException(issues, e.userMessage);
      }
      rethrow;
    }
  }
}
