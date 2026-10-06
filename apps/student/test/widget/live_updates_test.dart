import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/ui/navigation.dart';

import '../support/fakes.dart';
import '../support/fixtures.dart' as fx;

void main() {
  testWidgets('tracking: live order events move the timeline to "Ready for pickup"', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    final o = fx.order(status: 'PREPARING', number: 'SV1077');
    h.api.ordersById[o.id] = o;
    await h.pumpSignedIn(tester);
    openTracking(tester.element(find.byType(NavigationBar)), o.id);
    await tester.pumpAndSettle();
    expect(find.text('Your food is being prepared'), findsOneWidget);
    expect(find.text('SV1077'), findsOneWidget);

    h.realtime.emit('order.ready', {
      'order': fx.orderJson(id: o.id, number: 'SV1077', status: 'READY', updatedAt: '2026-10-06T19:50:00.000Z'),
      'previousStatus': 'PREPARING',
    });
    await tester.pumpAndSettle();
    expect(find.text('Ready for pickup'), findsWidgets);
    expect(find.textContaining('Show this number'), findsOneWidget);

    // A stale event (older updatedAt) never moves the order backwards.
    h.realtime.emit('order.preparing', {
      'order': fx.orderJson(id: o.id, number: 'SV1077', status: 'PREPARING', updatedAt: '2026-10-06T19:45:00.000Z'),
      'previousStatus': 'PAYMENT_CONFIRMED',
    });
    await tester.pumpAndSettle();
    expect(find.textContaining('Show this number'), findsOneWidget);
  });

  testWidgets('tracking refetches after a reconnect', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    final o = fx.order(status: 'PREPARING');
    h.api.ordersById[o.id] = o;
    await h.pumpSignedIn(tester);
    openTracking(tester.element(find.byType(NavigationBar)), o.id);
    await tester.pumpAndSettle();
    final before = h.api.calls.where((c) => c == 'order:${o.id}').length;
    h.api.ordersById[o.id] = fx.order(status: 'READY', updatedAt: '2026-10-06T19:55:00.000Z');
    h.realtime.connect();
    await tester.pumpAndSettle();
    expect(h.api.calls.where((c) => c == 'order:${o.id}').length, greaterThan(before));
    expect(find.textContaining('Show this number'), findsOneWidget);
  });

  testWidgets('menu subscribes to the selected canteen and reloads on menu events', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await h.pumpSignedIn(tester);
    expect(h.realtime.subscriptions, contains(fx.kgId));
    final before = h.api.calls.where((c) => c == 'menu:${fx.kgId}').length;
    h.realtime.emit('menu.item_availability_changed', {
      'itemId': 'x',
      'canteenId': fx.kgId,
      'isAvailable': false,
      'isActive': true,
      'availability': 'UNAVAILABLE',
      'isOrderable': false,
    });
    await tester.pumpAndSettle();
    expect(h.api.calls.where((c) => c == 'menu:${fx.kgId}').length, greaterThan(before));
  });

  testWidgets('notification badge counts live notifications', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness()..api.unread = 2;
    await h.pumpSignedIn(tester);
    expect(find.bySemanticsLabel('Notifications, 2'), findsOneWidget);
    h.realtime.emit('notification.created', {
      'notification': {
        'id': 'n9',
        'type': 'ORDER_READY',
        'title': 'Ready for pickup',
        'message': 'Show order #SV1 at the counter.',
        'orderId': null,
        'data': {},
        'readAt': null,
        'createdAt': '2026-10-06T19:00:00.000Z',
      },
    });
    await tester.pumpAndSettle();
    expect(find.bySemanticsLabel('Notifications, 3'), findsOneWidget);
  });

  testWidgets('logout asks, then clears the cart and returns to role selection', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await h.pumpSignedIn(tester);
    h.services.cart.add(fx.item('a1000000-0000-4000-8000-000000000001', 'Veg Grilled Sandwich'), canteenName: 'K&G');
    await tester.pump();
    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Profile')));
    await tester.pumpAndSettle();
    expect(find.text('Asha Rao'), findsOneWidget);
    await tester.tap(find.widgetWithText(OutlinedButton, 'Log out'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Log out'));
    await tester.pumpAndSettle();
    expect(find.text('Continue as'), findsOneWidget);
    expect(h.services.cart.isEmpty, isTrue);
    expect(h.realtime.started, isFalse);
  });
}
