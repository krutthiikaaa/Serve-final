/// DTOs mirroring the frozen backend contract (packages/contracts). Parsing
/// is strict about the fields the app uses; money is always integer paise.
library;

DateTime _date(Object? v) => DateTime.parse(v! as String);
DateTime? _dateOrNull(Object? v) => v == null ? null : DateTime.parse(v as String);
Map<String, dynamic> _map(Object? v) => (v! as Map).cast<String, dynamic>();
List<Map<String, dynamic>> _list(Object? v) => (v! as List).map((e) => (e as Map).cast<String, dynamic>()).toList();

class Ref {
  const Ref(this.id, this.name);
  factory Ref.fromJson(Map<String, dynamic> j) => Ref(j['id'] as String, j['name'] as String);
  final String id;
  final String name;
}

class Hostel {
  const Hostel({required this.id, required this.name, required this.canteen});
  factory Hostel.fromJson(Map<String, dynamic> j) =>
      Hostel(id: j['id'] as String, name: j['name'] as String, canteen: Ref.fromJson(_map(j['canteen'])));
  final String id;
  final String name;
  final Ref canteen;
}

class CanteenState {
  const CanteenState({required this.id, required this.name, required this.isActive, required this.isAcceptingOrders});
  factory CanteenState.fromJson(Map<String, dynamic> j) => CanteenState(
    id: j['id'] as String,
    name: j['name'] as String,
    isActive: j['isActive'] as bool,
    isAcceptingOrders: j['isAcceptingOrders'] as bool,
  );
  final String id;
  final String name;
  final bool isActive;
  final bool isAcceptingOrders;
}

/// `/api/auth/me`. The role comes from PostgreSQL via the backend, never from the token.
sealed class Me {
  const Me();
  factory Me.fromJson(Map<String, dynamic> j) {
    if (j['registered'] != true) return UnregisteredMe(email: j['email'] as String?);
    if (j['role'] == 'STUDENT') return StudentMe.fromJson(j);
    return OtherRoleMe(role: j['role'] as String, name: j['name'] as String);
  }
}

class UnregisteredMe extends Me {
  const UnregisteredMe({this.email});
  final String? email;
}

class OtherRoleMe extends Me {
  const OtherRoleMe({required this.role, required this.name});
  final String role;
  final String name;
}

class StudentMe extends Me {
  const StudentMe({required this.id, required this.name, required this.email, required this.hostel, required this.defaultCanteen});
  factory StudentMe.fromJson(Map<String, dynamic> j) => StudentMe(
    id: j['id'] as String,
    name: j['name'] as String,
    email: j['email'] as String,
    hostel: Ref.fromJson(_map(j['hostel'])),
    defaultCanteen: CanteenState.fromJson(_map(j['defaultCanteen'])),
  );
  final String id;
  final String name;
  final String email;
  final Ref hostel;
  final CanteenState defaultCanteen;

  String get firstName => name.trim().split(RegExp(r'\s+')).first;
}

enum CanteenStatus { acceptingOrders, paused, inactive }

CanteenStatus _canteenStatus(String s) => switch (s) {
  'ACCEPTING_ORDERS' => CanteenStatus.acceptingOrders,
  'PAUSED' => CanteenStatus.paused,
  _ => CanteenStatus.inactive,
};

class Canteen {
  const Canteen({required this.id, required this.name, required this.location, required this.openingHours, required this.status});
  factory Canteen.fromJson(Map<String, dynamic> j) => Canteen(
    id: j['id'] as String,
    name: j['name'] as String,
    location: j['location'] as String?,
    openingHours: j['openingHours'] as String?,
    status: _canteenStatus(j['status'] as String),
  );
  final String id;
  final String name;
  final String? location;
  final String? openingHours;
  final CanteenStatus status;

  bool get acceptingOrders => status == CanteenStatus.acceptingOrders;
}

enum Availability { available, unavailable, inactive }

Availability _availability(String s) => switch (s) {
  'AVAILABLE' => Availability.available,
  'UNAVAILABLE' => Availability.unavailable,
  _ => Availability.inactive,
};

class MenuItem {
  const MenuItem({
    required this.id,
    required this.canteenId,
    required this.categoryId,
    required this.name,
    required this.description,
    required this.pricePaise,
    required this.imageUrl,
    required this.availability,
    required this.isOrderable,
  });
  factory MenuItem.fromJson(Map<String, dynamic> j) => MenuItem(
    id: j['id'] as String,
    canteenId: j['canteenId'] as String,
    categoryId: j['categoryId'] as String,
    name: j['name'] as String,
    description: j['description'] as String?,
    pricePaise: j['pricePaise'] as int,
    imageUrl: j['imageUrl'] as String?,
    availability: _availability(j['availability'] as String),
    isOrderable: j['isOrderable'] as bool,
  );
  final String id;
  final String canteenId;
  final String categoryId;
  final String name;
  final String? description;
  final int pricePaise;
  final String? imageUrl;
  final Availability availability;
  final bool isOrderable;
}

class MenuCategory {
  const MenuCategory({required this.id, required this.name, required this.items});
  factory MenuCategory.fromJson(Map<String, dynamic> j) =>
      MenuCategory(id: j['id'] as String, name: j['name'] as String, items: _list(j['items']).map(MenuItem.fromJson).toList());
  final String id;
  final String name;
  final List<MenuItem> items;
}

class Menu {
  const Menu({required this.canteen, required this.categories});
  factory Menu.fromJson(Map<String, dynamic> j) =>
      Menu(canteen: Canteen.fromJson(_map(j['canteen'])), categories: _list(j['categories']).map(MenuCategory.fromJson).toList());
  final Canteen canteen;
  final List<MenuCategory> categories;

  /// INACTIVE items are never shown to students.
  List<MenuCategory> get visibleCategories => [
    for (final c in categories)
      if (c.items.any((i) => i.availability != Availability.inactive))
        MenuCategory(id: c.id, name: c.name, items: c.items.where((i) => i.availability != Availability.inactive).toList()),
  ];

  String? categoryName(String categoryId) {
    for (final c in categories) {
      if (c.id == categoryId) return c.name;
    }
    return null;
  }
}

/// `GET /api/menu/items/:id` adds the category and canteen.
class MenuItemDetail {
  const MenuItemDetail({required this.item, required this.category, required this.canteen});
  factory MenuItemDetail.fromJson(Map<String, dynamic> j) => MenuItemDetail(
    item: MenuItem.fromJson(j),
    category: Ref.fromJson(_map(j['category'])),
    canteen: Canteen.fromJson(_map(j['canteen'])),
  );
  final MenuItem item;
  final Ref category;
  final Canteen canteen;
}

class QuoteLine {
  const QuoteLine({
    required this.menuItemId,
    required this.itemName,
    required this.unitPricePaise,
    required this.quantity,
    required this.lineTotalPaise,
  });
  factory QuoteLine.fromJson(Map<String, dynamic> j) => QuoteLine(
    menuItemId: j['menuItemId'] as String,
    itemName: j['itemName'] as String,
    unitPricePaise: j['unitPricePaise'] as int,
    quantity: j['quantity'] as int,
    lineTotalPaise: j['lineTotalPaise'] as int,
  );
  final String menuItemId;
  final String itemName;
  final int unitPricePaise;
  final int quantity;
  final int lineTotalPaise;
}

/// Authoritative prices and total from `POST /api/cart/quote`.
class Quote {
  const Quote({required this.canteen, required this.items, required this.itemCount, required this.totalPaise});
  factory Quote.fromJson(Map<String, dynamic> j) => Quote(
    canteen: Ref.fromJson(_map(j['canteen'])),
    items: _list(j['items']).map(QuoteLine.fromJson).toList(),
    itemCount: j['itemCount'] as int,
    totalPaise: j['totalPaise'] as int,
  );
  final Ref canteen;
  final List<QuoteLine> items;
  final int itemCount;
  final int totalPaise;
}

enum OrderStatus { placed, paymentConfirmed, preparing, ready, collected, cancelled }

OrderStatus orderStatusFrom(String s) => switch (s) {
  'PLACED' => OrderStatus.placed,
  'PAYMENT_CONFIRMED' => OrderStatus.paymentConfirmed,
  'PREPARING' => OrderStatus.preparing,
  'READY' => OrderStatus.ready,
  'COLLECTED' => OrderStatus.collected,
  'CANCELLED' => OrderStatus.cancelled,
  _ => throw FormatException('Unknown order status $s'),
};

extension OrderStatusX on OrderStatus {
  bool get isActive =>
      this == OrderStatus.placed || this == OrderStatus.paymentConfirmed || this == OrderStatus.preparing || this == OrderStatus.ready;
}

class OrderLine {
  const OrderLine({
    required this.id,
    required this.itemName,
    required this.unitPricePaise,
    required this.quantity,
    required this.lineTotalPaise,
  });
  factory OrderLine.fromJson(Map<String, dynamic> j) => OrderLine(
    id: j['id'] as String,
    itemName: j['itemName'] as String,
    unitPricePaise: j['unitPricePaise'] as int,
    quantity: j['quantity'] as int,
    lineTotalPaise: j['lineTotalPaise'] as int,
  );
  final String id;
  final String itemName;
  final int unitPricePaise;
  final int quantity;
  final int lineTotalPaise;
}

class Payment {
  const Payment({required this.provider, required this.status, required this.amountPaise, this.failureReason});
  factory Payment.fromJson(Map<String, dynamic> j) => Payment(
    provider: j['provider'] as String,
    status: j['status'] as String,
    amountPaise: j['amountPaise'] as int,
    failureReason: j['failureReason'] as String?,
  );
  final String provider;
  final String status;
  final int amountPaise;
  final String? failureReason;
}

class TimelineStep {
  const TimelineStep(this.status, this.at);
  factory TimelineStep.fromJson(Map<String, dynamic> j) => TimelineStep(orderStatusFrom(j['status'] as String), _date(j['at']));
  final OrderStatus status;
  final DateTime at;
}

/// Student view of an order (`studentOrderSchema`).
class StudentOrder {
  const StudentOrder({
    required this.id,
    required this.orderNumber,
    required this.status,
    required this.totalPaise,
    required this.canteen,
    required this.items,
    required this.payment,
    required this.createdAt,
    required this.updatedAt,
    required this.cancelReason,
    required this.timeline,
  });
  factory StudentOrder.fromJson(Map<String, dynamic> j) => StudentOrder(
    id: j['id'] as String,
    orderNumber: j['orderNumber'] as String,
    status: orderStatusFrom(j['status'] as String),
    totalPaise: j['totalPaise'] as int,
    canteen: Ref.fromJson(_map(j['canteen'])),
    items: _list(j['items']).map(OrderLine.fromJson).toList(),
    payment: j['payment'] == null ? null : Payment.fromJson(_map(j['payment'])),
    createdAt: _date(j['createdAt']),
    updatedAt: _date(j['updatedAt']),
    cancelReason: j['cancelReason'] as String?,
    timeline: _list(j['timeline']).map(TimelineStep.fromJson).toList(),
  );
  final String id;
  final String orderNumber;
  final OrderStatus status;
  final int totalPaise;
  final Ref canteen;
  final List<OrderLine> items;
  final Payment? payment;
  final DateTime createdAt;
  final DateTime updatedAt;
  final String? cancelReason;
  final List<TimelineStep> timeline;

  int get itemCount => items.fold(0, (n, i) => n + i.quantity);

  DateTime? reachedAt(OrderStatus s) {
    for (final step in timeline) {
      if (step.status == s) return step.at;
    }
    return null;
  }
}

class AppNotification {
  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.message,
    required this.orderId,
    required this.readAt,
    required this.createdAt,
  });
  factory AppNotification.fromJson(Map<String, dynamic> j) => AppNotification(
    id: j['id'] as String,
    type: j['type'] as String,
    title: j['title'] as String,
    message: j['message'] as String,
    orderId: j['orderId'] as String?,
    readAt: _dateOrNull(j['readAt']),
    createdAt: _date(j['createdAt']),
  );
  final String id;
  final String type;
  final String title;
  final String message;
  final String? orderId;
  final DateTime? readAt;
  final DateTime createdAt;

  bool get isRead => readAt != null;

  AppNotification markedRead(DateTime at) =>
      AppNotification(id: id, type: type, title: title, message: message, orderId: orderId, readAt: readAt ?? at, createdAt: createdAt);
}

class PageResult<T> {
  const PageResult(this.items, this.nextCursor, {this.unreadCount});
  final List<T> items;
  final String? nextCursor;
  final int? unreadCount;
}

enum RecommendationBasis { mostOrdered, popular, menu }

class Recommendations {
  const Recommendations(this.basis, this.items);
  factory Recommendations.fromJson(Map<String, dynamic> j) => Recommendations(switch (j['basis']) {
    'MOST_ORDERED' => RecommendationBasis.mostOrdered,
    'POPULAR' => RecommendationBasis.popular,
    _ => RecommendationBasis.menu,
  }, _list(j['items']).map(MenuItem.fromJson).toList());
  final RecommendationBasis basis;
  final List<MenuItem> items;
}

class PaymentSession {
  const PaymentSession({required this.orderId, required this.provider, required this.providerOrderId, required this.amountPaise});
  factory PaymentSession.fromJson(Map<String, dynamic> j) => PaymentSession(
    orderId: j['orderId'] as String,
    provider: j['provider'] as String,
    providerOrderId: j['providerOrderId'] as String,
    amountPaise: j['amountPaise'] as int,
  );
  final String orderId;
  final String provider;
  final String providerOrderId;
  final int amountPaise;
}

/// A cart line the backend refused (`ITEM_UNAVAILABLE` details).
class CartIssue {
  const CartIssue(this.menuItemId, this.reason);
  final String menuItemId;

  /// NOT_IN_CANTEEN | INACTIVE | UNAVAILABLE
  final String reason;
}
