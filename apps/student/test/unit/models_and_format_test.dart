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

  test('parses the student order contract', () {
    final o = order(status: 'READY');
    expect(o.status, OrderStatus.ready);
    expect(o.timeline.map((t) => t.status), [OrderStatus.placed, OrderStatus.paymentConfirmed, OrderStatus.preparing, OrderStatus.ready]);
    expect(o.status.isActive, isTrue);
    expect(order(status: 'COLLECTED').status.isActive, isFalse);
  });

  test('parses /me variants', () {
    expect(Me.fromJson({'registered': false, 'role': null, 'firebaseUid': 'u', 'email': 'x@y.z'}), isA<UnregisteredMe>());
    expect(
      Me.fromJson({'registered': true, 'role': 'STAFF', 'name': 'S', 'id': 'i', 'email': 'e', 'firebaseUid': 'u', 'isActive': true}),
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
    test('web / iOS / desktop use localhost and the Auth Emulator', () {
      final c = AppConfig.resolve(isRelease: false, isAndroidDevice: false);
      expect(c.apiUrl, 'http://localhost:5001');
      expect(c.authEmulatorHost, '127.0.0.1:9099');
      expect(c.firebaseProjectId, 'demo-serve');
      expect(c.staffDashboardUrl, 'http://localhost:5173');
    });

    test('the Android emulator reaches the host as 10.0.2.2', () {
      final c = AppConfig.resolve(isRelease: false, isAndroidDevice: true);
      expect(c.apiUrl, 'http://10.0.2.2:5001');
      expect(c.authEmulatorHost, '10.0.2.2:9099');
    });

    test('explicit --dart-define values always win', () {
      final c = AppConfig.resolve(
        apiUrl: 'http://192.168.1.20:5001/',
        authEmulatorHost: '192.168.1.20:9099',
        isRelease: false,
        isAndroidDevice: true,
      );
      expect(c.apiUrl, 'http://192.168.1.20:5001');
      expect(c.authEmulatorHost, '192.168.1.20:9099');
    });

    test('a real Firebase project never defaults to the emulator', () {
      final c = AppConfig.resolve(firebaseProjectId: 'serve-prod', isRelease: false, isAndroidDevice: false);
      expect(c.authEmulatorHost, isNull);
    });

    test('release builds get no emulator default and still need real settings', () {
      final c = AppConfig.resolve(isRelease: true, isAndroidDevice: false);
      expect(c.authEmulatorHost, isNull);
      expect(() => c.validate(isRelease: true), throwsStateError);
      final prod = AppConfig.resolve(
        apiUrl: 'https://api.serve.app',
        firebaseProjectId: 'serve-prod',
        firebaseApiKey: 'k',
        isRelease: true,
        isAndroidDevice: false,
      );
      expect(() => prod.validate(isRelease: true), returnsNormally);
      expect(prod.staffDashboardUrl, isNull);
    });
  });

  test('release builds refuse emulator, demo project and plain-http APIs', () {
    const dev = AppConfig(
      apiUrl: 'http://localhost:5001',
      firebaseApiKey: 'k',
      firebaseProjectId: 'demo-serve',
      authEmulatorHost: '127.0.0.1:9099',
    );
    expect(() => dev.validate(isRelease: false), returnsNormally);
    expect(() => dev.validate(isRelease: true), throwsStateError);
    const prod = AppConfig(apiUrl: 'https://api.serve.app', firebaseApiKey: 'k', firebaseProjectId: 'serve-prod');
    expect(() => prod.validate(isRelease: true), returnsNormally);
  });
}
