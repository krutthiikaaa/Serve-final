import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/core/api_exception.dart';
import 'package:serve_student/services/api/models.dart';
import 'package:serve_student/ui/screens/payment_screen.dart';

import '../support/fakes.dart';
import '../support/fixtures.dart' as fx;

/// UPI claim queue, student side: the payment screen says where the order
/// stands — pending with a deadline, waiting for the cashier after "I've
/// paid", rejected by the cashier, or expired — and never shows a claim as a
/// payment.
void main() {
  final now = DateTime.utc(2026, 10, 6, 19, 50);
  String at(Duration offset) => now.add(offset).toIso8601String();

  Future<void> banner(WidgetTester tester, StudentOrder order) => tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: PaymentStateBanner(order: order, now: now),
      ),
    ),
  );

  group('PaymentStateBanner', () {
    testWidgets('unclaimed: pending, with the deadline', (tester) async {
      await banner(tester, fx.order(status: 'PLACED', payment: {'paymentDueAt': at(const Duration(minutes: 12, seconds: 30))}));
      expect(find.byKey(const Key('payment-state-pending')), findsOneWidget);
      expect(find.textContaining('PAYMENT PENDING'), findsOneWidget);
      expect(find.textContaining('13 min left'), findsOneWidget);
      expect(find.textContaining('or this order expires'), findsOneWidget);
    });

    testWidgets('claimed: waiting for the cashier, never "paid", never expiring', (tester) async {
      await banner(
        tester,
        fx.order(
          status: 'PLACED',
          payment: {'claimedAt': at(const Duration(minutes: -3)), 'paymentDueAt': at(const Duration(minutes: -1))},
        ),
      );
      expect(find.byKey(const Key('payment-state-claimed')), findsOneWidget);
      expect(find.textContaining('WAITING FOR THE CASHIER'), findsOneWidget);
      expect(find.textContaining('does not expire'), findsOneWidget);
      expect(find.textContaining('Paid'), findsNothing);
    });

    testWidgets('rejected: the cashier\'s reason and a fresh deadline', (tester) async {
      await banner(
        tester,
        fx.order(
          status: 'PLACED',
          payment: {
            'status': 'FAILED',
            'failureReason': 'No matching credit',
            'verifiedAt': at(const Duration(minutes: -1)),
            'paymentDueAt': at(const Duration(minutes: 20)),
          },
        ),
      );
      expect(find.byKey(const Key('payment-state-rejected')), findsOneWidget);
      expect(find.textContaining('No matching credit'), findsOneWidget);
      expect(find.textContaining('20 min left'), findsOneWidget);
    });

    testWidgets('expired: the reason, and what to do next', (tester) async {
      await banner(
        tester,
        fx.order(
          status: 'CANCELLED',
          cancelReason: 'Payment was not received within 20 minutes.',
          payment: {'status': 'FAILED', 'expiredAt': at(Duration.zero)},
        ),
      );
      expect(find.byKey(const Key('payment-state-expired')), findsOneWidget);
      expect(find.textContaining('ORDER EXPIRED'), findsOneWidget);
      expect(find.textContaining('not received within 20 minutes'), findsOneWidget);
      expect(find.textContaining('Place a new order'), findsOneWidget);
    });
  });

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

  testWidgets('claiming switches the screen to "waiting for the cashier" (still not paid)', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    final placed = fx.order(
      status: 'PLACED',
      total: 99900,
      payment: {'paymentDueAt': DateTime.now().add(const Duration(minutes: 20)).toUtc().toIso8601String()},
    );
    h.api.onPlaceOrder = (_, _, _) async => placed;
    h.api.ordersById[placed.id] = placed;
    await toPayment(tester, h);
    expect(find.byKey(const Key('payment-state-pending')), findsOneWidget);

    await tester.enterText(find.byKey(const Key('utr-field')), 'UTR777');
    await tester.tap(find.widgetWithText(FilledButton, 'Save reference'));
    await tester.pumpAndSettle();
    expect(h.api.calls, contains('claim:${placed.id}:UTR777'));
    expect(find.byKey(const Key('payment-state-claimed')), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Update UPI reference'), findsOneWidget);
    expect(find.text('Payment confirmed'), findsNothing);
  });

  testWidgets('an order that expires while open shows it live and can no longer be claimed', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    final placed = fx.order(status: 'PLACED', total: 99900);
    h.api.onPlaceOrder = (_, _, _) async => placed;
    h.api.ordersById[placed.id] = placed;
    await toPayment(tester, h);

    final expired = fx.orderMap(
      status: 'CANCELLED',
      total: 99900,
      updatedAt: '2026-10-06T20:05:00.000Z',
      cancelReason: 'Payment was not received within 20 minutes.',
      payment: {'status': 'FAILED', 'expiredAt': '2026-10-06T20:05:00.000Z', 'failureReason': 'Payment window expired'},
    );
    h.api.ordersById[placed.id] = StudentOrder.fromJson(expired);
    h.realtime.emit('order.cancelled', {'order': expired, 'previousStatus': 'PLACED'});
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('payment-state-expired')), findsOneWidget);
    final button = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Order expired'));
    expect(button.onPressed, isNull);
    final field = tester.widget<TextField>(find.byKey(const Key('utr-field')));
    expect(field.enabled, isFalse);
  });

  testWidgets('a claim refused because the order just expired shows the expired state', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    final placed = fx.order(status: 'PLACED', total: 99900);
    h.api.onPlaceOrder = (_, _, _) async => placed;
    h.api.ordersById[placed.id] = placed;
    h.api.onClaim = (_, _) async {
      h.api.ordersById[placed.id] = fx.order(
        status: 'CANCELLED',
        total: 99900,
        cancelReason: 'Payment was not received within 20 minutes.',
        payment: {'status': 'FAILED', 'expiredAt': '2026-10-06T20:05:00.000Z'},
      );
      throw const ApiException(409, 'ORDER_EXPIRED', 'This order expired because payment was not received in time. Place a new order.');
    };
    await toPayment(tester, h);
    await tester.tap(find.widgetWithText(FilledButton, 'Save reference'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('payment-state-expired')), findsOneWidget);
  });

  testWidgets('the Orders list says "waiting for cashier" and "expired"', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    h.api.activeOrders = [
      fx.order(status: 'PLACED', number: 'SV2001', payment: {'claimedAt': '2026-10-06T19:45:00.000Z'}),
    ];
    h.api.pastOrders = [
      fx.order(
        status: 'CANCELLED',
        number: 'SV2002',
        cancelReason: 'Payment was not received within 20 minutes.',
        payment: {'status': 'FAILED', 'expiredAt': '2026-10-06T20:05:00.000Z'},
      ),
    ];
    await h.pumpSignedIn(tester);
    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Orders')));
    await tester.pumpAndSettle();
    expect(find.text('WAITING FOR CASHIER'), findsOneWidget);
    expect(find.text('PAYMENT PENDING'), findsNothing);
    final past = find.text('Past');
    if (past.evaluate().isNotEmpty) {
      await tester.tap(past.first);
      await tester.pumpAndSettle();
    }
    expect(find.text('EXPIRED'), findsOneWidget);
  });
}
