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
