import 'package:serve_student/services/api/models.dart';

const kgId = '9703a1b2-0000-4000-8000-000000000001';
const vedId = '9703a1b2-0000-4000-8000-000000000002';
const sandwichesId = '958c0000-0000-4000-8000-000000000001';
const juicesId = '958c0000-0000-4000-8000-000000000002';

const kgAreaId = '7a7a0000-0000-4000-8000-000000000001';
const kgDayId = '9703a1b2-0000-4000-8000-000000000003';

/// A canteen as the backend sends it. The type follows the name ("Day" →
/// DAY) unless given; `state` is the backend availability state.
Map<String, dynamic> canteenJson({
  String id = kgId,
  String name = 'Krishna & Godavari Night Canteen',
  String status = 'ACCEPTING_ORDERS',
  String? type,
  String? state,
  String areaId = kgAreaId,
  String areaName = 'Krishna & Godavari',
}) {
  final t = type ?? (name.contains('Day') ? 'DAY' : 'NIGHT');
  final open = status == 'ACCEPTING_ORDERS';
  final s =
      state ??
      (status == 'INACTIVE'
          ? 'INACTIVE'
          : open
          ? 'OPEN'
          : 'PAUSED');
  return {
    'id': id,
    'name': name,
    'slug': name.toLowerCase().replaceAll(RegExp('[^a-z]+'), '-'),
    'type': t,
    'serviceArea': {'id': areaId, 'name': areaName},
    'location': 'Between Krishna and Godavari hostels',
    'openingHours': t == 'DAY' ? '8:00 AM – 8:00 PM' : '9:00 PM – 3:00 AM',
    'isActive': status != 'INACTIVE',
    'isAcceptingOrders': open,
    'isPaused': s == 'PAUSED',
    'status': status,
    'availability': {
      'state': s,
      'isOpenNow': s == 'OPEN',
      'message': s == 'OPEN' ? 'Taking orders now.' : 'Not taking orders.',
      'override': 'FORCE_OPEN',
      'today': null,
      'otherServiceCanteen': s == 'OTHER_SERVICE_ACTIVE'
          ? {
              'id': t == 'DAY' ? kgId : kgDayId,
              'name': t == 'DAY' ? 'Krishna & Godavari Night Canteen' : 'Krishna & Godavari Day Canteen',
              'type': t == 'DAY' ? 'NIGHT' : 'DAY',
            }
          : null,
    },
    'supportedPeriods': [t],
    'services': [
      {'period': t, 'isEnabled': true, 'override': 'FORCE_OPEN', 'isOpenNow': s == 'OPEN'},
    ],
    'configurationWarnings': <Object>[],
  };
}

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
  String? state,
}) => Menu.fromJson({
  'canteen': canteenJson(id: canteenId, name: name, status: status, state: state),
  'servicePeriod': name.contains('Day') ? 'DAY' : 'NIGHT',
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

StudentMe studentMe({String id = 'cfef0fa5-0000-4000-8000-000000000001', String name = 'Asha Rao', String email = 'asha@srmap.edu.in'}) =>
    StudentMe.fromJson({
      'registered': true,
      'role': 'STUDENT',
      'id': id,
      'authUserId': 'uid-$id',
      'name': name,
      'email': email,
      'isActive': true,
      'hostel': {'id': '1c35f533-0000-4000-8000-000000000001', 'name': 'Krishna'},
      'serviceArea': {'id': kgAreaId, 'name': 'Krishna & Godavari'},
      'defaultCanteen': {
        'id': kgId,
        'name': 'Krishna & Godavari Night Canteen',
        'type': 'NIGHT',
        'isActive': true,
        'isAcceptingOrders': true,
      },
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
    'receiptNumber': status == 'PLACED' || status == 'CANCELLED' ? null : 'RC1001',
    'status': status,
    'servicePeriod': 'NIGHT',
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
      'provider': 'UPI',
      'status': status == 'PLACED' ? 'PENDING' : (status == 'CANCELLED' ? 'REFUNDED' : 'SUCCESS'),
      'amountPaise': total,
      'currency': 'INR',
      'utr': null,
      'verifiedAt': null,
      'paidAt': null,
      'refundedAt': null,
      'failureReason': null,
      'isSimulated': false,
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
  bool simulated = false,
  String? servicePeriod = 'NIGHT',
}) {
  final json = orderJson(status: status, number: number, total: total, updatedAt: updatedAt);
  json['servicePeriod'] = servicePeriod;
  final payment = json['payment'] as Map<String, dynamic>?;
  if (payment != null) payment['isSimulated'] = simulated;
  return StudentOrder.fromJson(json);
}

Map<String, dynamic> paymentConfigJson({
  String canteenId = kgId,
  String mode = 'DEMO',
  String? upiVpa,
  String? merchantName,
  String? qrImageUrl,
  String? qrId,
  bool withDemoQr = true,
}) => {
  'qr': qrId == null
      ? null
      : {'id': qrId, 'url': '/api/qr-codes/$qrId', 'contentType': 'image/png', 'uploadedAt': '2026-11-16T10:00:00.000Z'},
  'canteenId': canteenId,
  'mode': mode,
  'upiVpa': upiVpa,
  'merchantName': merchantName,
  'qrImageUrl': qrImageUrl,
  'instructions': null,
  'isActive': mode == 'LIVE',
  'demoQr': mode == 'DEMO' && withDemoQr
      ? {'payload': 'SERVE-DEMO:$canteenId', 'svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'warning': 'DEMO ONLY — NOT PAYABLE'}
      : null,
  'warnings': [if (mode == 'DEMO') 'DEMO_MODE_ACTIVE'],
  'updatedAt': '2026-10-06T18:00:00.000Z',
};
