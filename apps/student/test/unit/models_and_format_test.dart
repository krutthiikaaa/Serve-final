import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/config/app_config.dart';
import 'package:serve_student/core/format.dart';
import 'package:serve_student/core/ids.dart';
import 'package:serve_student/services/api/models.dart';

import '../support/fixtures.dart';

void main() {
  test('formats paise as rupees', () {
    expect(formatRupees(12000), '₹120');
    expect(formatRupees(9950), '₹99.50');
    expect(formatRupees(12500000), '₹1,25,000');
  });

  test('menus hide INACTIVE items but keep UNAVAILABLE ones', () {
    final m = menu();
    final names = m.visibleCategories.single.items.map((i) => i.name);
    expect(names, ['Veg Grilled Sandwich', 'Paneer Grilled Sandwich']);
    expect(m.visibleCategories.single.items[1].isOrderable, isFalse);
  });

  test('parses the canteen type and backend availability, not the phone clock', () {
    final open = Canteen.fromJson(canteenJson());
    expect(open.type, ServicePeriod.night);
    expect(open.serviceArea?.name, 'Krishna & Godavari');
    expect(open.availability?.state, AvailabilityState.open);
    expect(open.blockReason, isNull);
    expect(open.availabilityFor(ServicePeriod.night), ServiceAvailability.open);
    expect(open.availabilityLabel(ServicePeriod.night), 'Open now');

    final day = Canteen.fromJson(
      canteenJson(id: kgDayId, name: 'Krishna & Godavari Day Canteen', status: 'PAUSED', state: 'OTHER_SERVICE_ACTIVE'),
    );
    expect(day.type, ServicePeriod.day);
    expect(day.availability?.state, AvailabilityState.otherServiceActive);
    expect(day.blockReason, 'Krishna & Godavari Night Canteen is serving your area right now.');
    final closedJson = canteenJson();
    closedJson['supportedPeriods'] = ['NIGHT'];
    closedJson['services'] = [
      {'period': 'NIGHT', 'isEnabled': true, 'override': 'AUTO', 'isOpenNow': false},
    ];
    closedJson['configurationWarnings'] = [
      {'period': 'DAY', 'code': 'AUTO_WITHOUT_SCHEDULE'},
    ];
    final closed = Canteen.fromJson(closedJson);
    expect(closed.availabilityFor(ServicePeriod.night), ServiceAvailability.closed);
    expect(closed.availabilityFor(ServicePeriod.day), ServiceAvailability.notConfigured);
    expect(closed.orderingBlockReason(ServicePeriod.night), contains('closed'));
  });

  test('names every canteen state the way the staff and admin apps do', () {
    Canteen withState(String state, {String message = 'Not taking orders.'}) {
      final json = canteenJson(status: 'PAUSED', state: state);
      (json['availability'] as Map<String, dynamic>)['message'] = message;
      return Canteen.fromJson(json);
    }

    expect(Canteen.fromJson(canteenJson()).availability?.label, 'Taking orders');
    expect(withState('PAUSED').availability?.label, 'Paused');
    expect(withState('OFF_DUTY').availability?.state, AvailabilityState.offDuty);
    expect(withState('OFF_DUTY').availability?.label, 'Off duty');
    expect(withState('OFF_DUTY').blockReason, 'No canteen is serving your area right now.');
    expect(withState('OTHER_SERVICE_ACTIVE').availability?.label, 'Off duty');
    final scheduled = withState('CLOSED_BY_SCHEDULE', message: 'Closed by schedule. Opens at 18:00.');
    expect(scheduled.availability?.state, AvailabilityState.closedBySchedule);
    expect(scheduled.availability?.label, 'Closed by schedule');
    expect(scheduled.blockReason, 'Closed by schedule. Opens at 18:00.');
    expect(withState('INACTIVE').availability?.label, 'Temporarily disabled');
    expect(withState('SERVICE_DISABLED').availability?.label, 'Unavailable');
    // A state this build does not know yet is never treated as open.
    final future = withState('SOMETHING_NEW');
    expect(future.availability?.state, isNot(AvailabilityState.open));
    expect(future.blockReason, isNotNull);
  });

  test('demo QR payload is unique and never a UPI payment URI', () {
    final demo = DemoQr.fromJson({
      'payload': 'SERVE-DEMO:$kgId',
      'svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      'warning': 'DEMO ONLY — NOT PAYABLE',
    });
    expect(demo.payload.contains('upi://'), isFalse);
    expect(demo.svg.contains('upi://'), isFalse);
    expect(demo.warning, 'DEMO ONLY — NOT PAYABLE');
    expect(demo.isPayable, isFalse);
  });

  test('historical orders without a service period still parse', () {
    final json = orderJson();
    json.remove('servicePeriod');
    json.remove('receiptNumber');
    final o = StudentOrder.fromJson(json);
    expect(o.servicePeriod, isNull);
    expect(formatServicePeriod(o.servicePeriod), 'Service period not recorded');
    expect(o.hasReceipt, isFalse);
  });

  test('demo receipts are marked and pending payments are not receipts', () {
    expect(order(status: 'PAYMENT_CONFIRMED', simulated: true).hasReceipt, isTrue);
    expect(order(status: 'PAYMENT_CONFIRMED', simulated: true).payment!.isSimulated, isTrue);
    expect(order(status: 'PLACED').hasReceipt, isFalse);
  });

  test('parses the student order contract', () {
    final o = order(status: 'READY');
    expect(o.status, OrderStatus.ready);
    expect(o.timeline.map((t) => t.status), [OrderStatus.placed, OrderStatus.paymentConfirmed, OrderStatus.preparing, OrderStatus.ready]);
    expect(o.status.isActive, isTrue);
    expect(order(status: 'COLLECTED').status.isActive, isFalse);
  });

  test('parses /me variants', () {
    expect(Me.fromJson({'registered': false, 'role': null, 'authUserId': 'u', 'email': 'x@srmap.edu.in'}), isA<UnregisteredMe>());
    expect(
      Me.fromJson({'registered': true, 'role': 'STAFF', 'name': 'S', 'id': 'i', 'email': 'e', 'authUserId': 'u', 'isActive': true}),
      isA<OtherRoleMe>(),
    );
    expect(studentMe().firstName, 'Asha');
  });

  test('idempotency keys are v4 UUIDs and unique', () {
    final keys = List.generate(50, (_) => uuidV4());
    expect(keys.toSet().length, 50);
    expect(keys.first, matches(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')));
  });

  group('development defaults (a plain `flutter run` works against the local stack)', () {
    test('web / iOS / desktop use localhost', () {
      final c = AppConfig.resolve(isRelease: false, isAndroidDevice: false);
      expect(c.apiUrl, 'http://localhost:5001');
      expect(c.staffDashboardUrl, 'http://localhost:5173');
      expect(c.adminPortalUrl, 'http://localhost:5174');
    });

    test('the Android emulator reaches the host as 10.0.2.2', () {
      final c = AppConfig.resolve(isRelease: false, isAndroidDevice: true);
      expect(c.apiUrl, 'http://10.0.2.2:5001');
    });

    test('explicit --dart-define values always win', () {
      final c = AppConfig.resolve(apiUrl: 'http://192.168.1.20:5001/', isRelease: false, isAndroidDevice: true);
      expect(c.apiUrl, 'http://192.168.1.20:5001');
    });

    test('release builds get no local defaults and still need real settings', () {
      final c = AppConfig.resolve(isRelease: true, isAndroidDevice: false);
      expect(() => c.validate(isRelease: true), throwsStateError);
      final prod = AppConfig.resolve(apiUrl: 'https://api.serve.app', isRelease: true, isAndroidDevice: false);
      expect(() => prod.validate(isRelease: true), returnsNormally);
      expect(prod.staffDashboardUrl, isNull);
    });
  });

  group('single-domain web deployment (a built web app is served by the SERVE domain)', () {
    test('API, staff dashboard and admin portal default to the serving origin', () {
      final c = AppConfig.resolve(isRelease: true, isAndroidDevice: false, servedFrom: 'https://serve.example');
      expect(c.apiUrl, 'https://serve.example');
      expect(c.staffDashboardUrl, 'https://serve.example/staff/');
      expect(c.adminPortalUrl, 'https://serve.example/admin/');
      expect(() => c.validate(isRelease: true), returnsNormally);
    });

    test('a release build served over plain http is still rejected', () {
      final c = AppConfig.resolve(isRelease: true, isAndroidDevice: false, servedFrom: 'http://serve.example');
      expect(() => c.validate(isRelease: true), throwsStateError);
    });

    test('explicit --dart-define values still win', () {
      final c = AppConfig.resolve(
        apiUrl: 'https://api.serve.example',
        staffDashboardUrl: 'https://staff.serve.example',
        isRelease: true,
        isAndroidDevice: false,
        servedFrom: 'https://serve.example',
      );
      expect(c.apiUrl, 'https://api.serve.example');
      expect(c.staffDashboardUrl, 'https://staff.serve.example');
      expect(c.adminPortalUrl, 'https://serve.example/admin/');
    });

    test('a profile build for local testing uses the serving origin', () {
      final c = AppConfig.resolve(isRelease: false, isAndroidDevice: false, servedFrom: 'http://localhost:5199');
      expect(c.apiUrl, 'http://localhost:5199');
      expect(c.staffDashboardUrl, 'http://localhost:5199/staff/');
    });
  });

  test('release builds refuse plain-http and localhost APIs', () {
    const dev = AppConfig(apiUrl: 'http://localhost:5001');
    expect(() => dev.validate(isRelease: false), returnsNormally);
    expect(() => dev.validate(isRelease: true), throwsStateError);
    const prod = AppConfig(apiUrl: 'https://api.serve.app');
    expect(() => prod.validate(isRelease: true), returnsNormally);
  });
}
