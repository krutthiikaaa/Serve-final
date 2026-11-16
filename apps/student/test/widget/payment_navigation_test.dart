import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/services/api/models.dart';
import 'package:serve_student/ui/screens/order_confirmation_screen.dart';
import 'package:serve_student/ui/screens/order_tracking_screen.dart';
import 'package:serve_student/ui/screens/payment_screen.dart';

import '../support/fakes.dart';
import '../support/fixtures.dart' as fx;

/// Regression: after a cashier confirms payment, the confirmation screen must
/// appear exactly once, and later order events must never bring it back.
void main() {
  Map<String, dynamic> event(String status, String updatedAt) => {
    'order': fx.orderJson(status: status, total: 99900, updatedAt: updatedAt),
    'previousStatus': null,
  };

  Future<void> toPayment(WidgetTester tester, TestHarness h) async {
    await h.pumpSignedIn(tester);
    h.services.cart.add(
      fx.item('a1000000-0000-4000-8000-000000000001', 'Veg Grilled Sandwich'),
      canteenName: 'K&G',
      period: ServicePeriod.night,
    );
    await tester.pump();
    await tester.tap(find.bySemanticsLabel('Cart, 1'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Checkout'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Place order'));
    await tester.pumpAndSettle();
    expect(find.byType(PaymentScreen), findsOneWidget);
  }

  testWidgets('confirmation appears once; tracking then updates live without it reappearing', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    final placed = fx.order(status: 'PLACED', total: 99900, updatedAt: '2026-10-06T19:43:00.000Z');
    h.api.onPlaceOrder = (_, _, _) async => placed;
    await toPayment(tester, h);

    // The cashier confirms the payment: the confirmation screen opens once.
    h.api.ordersById[placed.id] = fx.order(total: 99900, updatedAt: '2026-10-06T19:44:00.000Z');
    h.realtime.emit('order.payment_confirmed', event('PAYMENT_CONFIRMED', '2026-10-06T19:44:00.000Z'));
    await tester.pumpAndSettle();
    expect(find.byType(OrderConfirmationScreen), findsOneWidget);
    expect(find.byType(PaymentScreen), findsNothing);

    await tester.tap(find.widgetWithText(FilledButton, 'Track order'));
    await tester.pumpAndSettle();
    expect(find.byType(OrderTrackingScreen), findsOneWidget);

    // Kitchen progress, a duplicate event and a socket reconnect.
    var minute = 45;
    for (final status in ['PREPARING', 'READY', 'READY', 'COLLECTED']) {
      h.realtime.emit('order.${status.toLowerCase()}', event(status, '2026-10-06T19:${minute++}:00.000Z'));
      await tester.pumpAndSettle();
      expect(find.byType(OrderConfirmationScreen), findsNothing, reason: 'after $status');
      expect(find.byType(OrderTrackingScreen), findsOneWidget);
    }
    h.realtime.connect();
    await tester.pumpAndSettle();
    expect(find.byType(OrderConfirmationScreen), findsNothing);
    expect(find.text('Collected — enjoy!'), findsWidgets);
  });

  testWidgets('leaving payment for tracking never opens the confirmation later', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    final placed = fx.order(status: 'PLACED', total: 99900, updatedAt: '2026-10-06T19:43:00.000Z');
    h.api.onPlaceOrder = (_, _, _) async => placed;
    h.api.ordersById[placed.id] = placed;
    await toPayment(tester, h);

    await tester.tap(find.widgetWithText(OutlinedButton, 'Track this order'));
    await tester.pumpAndSettle();
    expect(find.byType(OrderTrackingScreen), findsOneWidget);
    expect(find.byType(PaymentScreen), findsNothing);

    h.api.ordersById[placed.id] = fx.order(total: 99900, updatedAt: '2026-10-06T19:44:00.000Z');
    h.realtime.emit('order.payment_confirmed', event('PAYMENT_CONFIRMED', '2026-10-06T19:44:00.000Z'));
    await tester.pumpAndSettle();
    h.realtime.emit('order.preparing', event('PREPARING', '2026-10-06T19:45:00.000Z'));
    await tester.pumpAndSettle();
    h.realtime.connect();
    await tester.pumpAndSettle();
    expect(find.byType(OrderConfirmationScreen), findsNothing);
    expect(find.byType(OrderTrackingScreen), findsOneWidget);
    expect(find.text('Your food is being prepared'), findsWidgets);
  });

  testWidgets('a payment screen that was replaced but is not yet disposed ignores later order events', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    final placed = fx.order(status: 'PLACED', total: 99900, updatedAt: '2026-10-06T19:43:00.000Z');
    h.api.onPlaceOrder = (_, _, _) async => placed;
    h.api.ordersById[placed.id] = placed;
    await toPayment(tester, h);

    // Leave for tracking, and deliver order events while the route transition
    // is still running: the replaced payment route is removed but its State is
    // still mounted (Flutter disposes it only when the transition completes).
    await tester.tap(find.widgetWithText(OutlinedButton, 'Track this order'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 16));
    h.api.ordersById[placed.id] = fx.order(total: 99900, updatedAt: '2026-10-06T19:44:00.000Z');
    h.realtime.emit('order.payment_confirmed', event('PAYMENT_CONFIRMED', '2026-10-06T19:44:00.000Z'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 16));
    h.realtime.emit('order.preparing', event('PREPARING', '2026-10-06T19:45:00.000Z'));
    await tester.pumpAndSettle();

    expect(find.byType(OrderConfirmationScreen, skipOffstage: false), findsNothing);
    expect(find.byType(OrderTrackingScreen), findsOneWidget);
    expect(find.text('Your food is being prepared'), findsWidgets);
  });
}
