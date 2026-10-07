import 'package:serve_student/services/api/models.dart';

const kgId = '9703a1b2-0000-4000-8000-000000000001';
const vedId = '9703a1b2-0000-4000-8000-000000000002';
const sandwichesId = '958c0000-0000-4000-8000-000000000001';
const juicesId = '958c0000-0000-4000-8000-000000000002';

Map<String, dynamic> canteenJson({
  String id = kgId,
  String name = 'Krishna & Godavari Night Canteen',
  String status = 'ACCEPTING_ORDERS',
}) => {
  'id': id,
  'name': name,
  'slug': name.toLowerCase().replaceAll(RegExp('[^a-z]+'), '-'),
  'location': 'Between Krishna and Godavari hostels',
  'openingHours': '9:00 PM – 3:00 AM',
  'isActive': status != 'INACTIVE',
  'isAcceptingOrders': status == 'ACCEPTING_ORDERS',
  'status': status,
};

Map<String, dynamic> itemJson(
  String id,
  String name, {
  String canteenId = kgId,
  String categoryId = sandwichesId,
  int price = 6000,
  String availability = 'AVAILABLE',
}) => {
  'id': id,
  'canteenId': canteenId,
  'categoryId': categoryId,
  'name': name,
  'description': '$name description',
  'pricePaise': price,
  'imageUrl': null,
  'isAvailable': availability != 'UNAVAILABLE',
  'isActive': availability != 'INACTIVE',
  'availability': availability,
  'isOrderable': availability == 'AVAILABLE',
  'updatedAt': '2026-10-06T18:00:00.000Z',
};

MenuItem item(
  String id,
  String name, {
  String canteenId = kgId,
  int price = 6000,
  String availability = 'AVAILABLE',
  String categoryId = sandwichesId,
}) => MenuItem.fromJson(itemJson(id, name, canteenId: canteenId, price: price, availability: availability, categoryId: categoryId));

Menu menu({
  String canteenId = kgId,
  String name = 'Krishna & Godavari Night Canteen',
  String status = 'ACCEPTING_ORDERS',
  List<Map<String, dynamic>>? sandwiches,
}) => Menu.fromJson({
  'canteen': canteenJson(id: canteenId, name: name, status: status),
  'categories': [
    {
      'id': sandwichesId,
      'canteenId': canteenId,
      'name': 'Sandwiches',
      'sortOrder': 10,
      'isActive': true,
      'updatedAt': '2026-10-06T18:00:00.000Z',
      'items':
          sandwiches ??
          [
            itemJson('a1000000-0000-4000-8000-000000000001', 'Veg Grilled Sandwich', canteenId: canteenId, price: 5000),
            itemJson(
              'a1000000-0000-4000-8000-000000000002',
              'Paneer Grilled Sandwich',
              canteenId: canteenId,
              price: 7500,
              availability: 'UNAVAILABLE',
            ),
            itemJson('a1000000-0000-4000-8000-000000000003', 'Retired Sandwich', canteenId: canteenId, availability: 'INACTIVE'),
          ],
    },
  ],
});

StudentMe studentMe() => StudentMe.fromJson({
  'registered': true,
  'role': 'STUDENT',
  'id': 'cfef0fa5-0000-4000-8000-000000000001',
  'firebaseUid': 'uid-asha',
  'name': 'Asha Rao',
  'email': 'asha@example.edu',
  'isActive': true,
  'hostel': {'id': '1c35f533-0000-4000-8000-000000000001', 'name': 'Krishna'},
  'defaultCanteen': {'id': kgId, 'name': 'Krishna & Godavari Night Canteen', 'isActive': true, 'isAcceptingOrders': true},
});

Map<String, dynamic> orderJson({
  String id = 'd8c5c17f-0000-4000-8000-000000000001',
  String number = 'SV1002',
  String status = 'PAYMENT_CONFIRMED',
  int total = 22500,
  String updatedAt = '2026-10-06T19:43:00.000Z',
}) {
  const reached = ['PLACED', 'PAYMENT_CONFIRMED', 'PREPARING', 'READY', 'COLLECTED'];
  final upTo = status == 'CANCELLED' ? 1 : reached.indexOf(status);
  return {
    'id': id,
    'orderNumber': number,
    'status': status,
    'totalPaise': total,
    'currency': 'INR',
    'canteen': {'id': kgId, 'name': 'Krishna & Godavari Night Canteen'},
    'items': [
      {
        'id': '59a50000-0000-4000-8000-000000000001',
        'menuItemId': 'a1000000-0000-4000-8000-000000000001',
        'itemName': 'Veg Grilled Sandwich',
        'unitPricePaise': total ~/ 2,
        'quantity': 2,
        'lineTotalPaise': total,
      },
    ],
    'payment': {
      'provider': 'MOCK',
      'status': status == 'PLACED' ? 'PENDING' : (status == 'CANCELLED' ? 'REFUNDED' : 'SUCCESS'),
      'amountPaise': total,
      'currency': 'INR',
      'paidAt': null,
      'refundedAt': null,
      'failureReason': null,
    },
    'createdAt': '2026-10-06T19:42:58.710Z',
    'updatedAt': updatedAt,
    'paidAt': null,
    'preparingAt': null,
    'readyAt': null,
    'collectedAt': null,
    'cancelledAt': status == 'CANCELLED' ? updatedAt : null,
    'cancelReason': status == 'CANCELLED' ? 'Item ran out' : null,
    'timeline': [
      for (var i = 0; i <= upTo; i++) {'status': reached[i], 'at': '2026-10-06T19:4${i + 2}:00.000Z'},
      if (status == 'CANCELLED') {'status': 'CANCELLED', 'at': updatedAt},
    ],
  };
}

StudentOrder order({
  String status = 'PAYMENT_CONFIRMED',
  String number = 'SV1002',
  int total = 22500,
  String updatedAt = '2026-10-06T19:43:00.000Z',
}) => StudentOrder.fromJson(orderJson(status: status, number: number, total: total, updatedAt: updatedAt));
