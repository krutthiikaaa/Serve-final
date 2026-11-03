import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/services/api/models.dart';
import 'package:serve_student/ui/screens/order_details_screen.dart';

import '../support/fakes.dart';
import '../support/fixtures.dart' as fx;

Finder navTab(String label) => find.descendant(of: find.byType(NavigationBar), matching: find.text(label));

void main() {
  testWidgets('home shows DAY and NIGHT from the backend and switching period reloads the menu', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await h.pumpSignedIn(tester);
    expect(find.text('DAY'), findsWidgets);
    expect(find.text('NIGHT'), findsWidgets);
    expect(find.textContaining('Open now'), findsWidgets);
    final before = h.api.calls.where((c) => c.startsWith('menu:')).length;
    await tester.tap(find.text('DAY').first);
    await tester.pumpAndSettle();
    expect(h.api.calls.where((c) => c.startsWith('menu:')).length, greaterThan(before));
    expect(h.api.calls, contains('menu:${fx.kgId}:DAY'));
    expect(h.services.selection.period, ServicePeriod.day);
  });

  testWidgets('switching period with a cart asks to clear it', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await h.pumpSignedIn(tester);
    h.services.cart.add(
      fx.item('a1000000-0000-4000-8000-000000000001', 'Veg Grilled Sandwich'),
      canteenName: 'K&G',
      period: ServicePeriod.night,
    );
    await tester.pump();
    await tester.tap(find.text('DAY').first);
    await tester.pumpAndSettle();
    expect(find.textContaining('different day or night service'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(h.services.cart.isEmpty, isFalse);
    expect(h.services.selection.period, ServicePeriod.night);
  });

  testWidgets('order details show a demo receipt warning and keep historical orders without a period', (tester) async {
    usePhoneSize(tester);
    final demo = fx.order(status: 'COLLECTED', simulated: true, number: 'SV8801');
    final historic = fx.order(status: 'COLLECTED', servicePeriod: null, number: 'SV0900');
    final h = TestHarness()..api.pastOrders = [demo, historic];
    h.api.ordersById[demo.id] = demo;
    await h.pumpSignedIn(tester);
    await tester.tap(navTab('Orders'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Past'));
    await tester.pumpAndSettle();
    expect(find.text('DEMO'), findsWidgets);
    expect(find.text('Service period not recorded'), findsOneWidget);
    await tester.tap(find.text('SV8801'));
    await tester.pumpAndSettle();
    expect(find.byType(OrderDetailsScreen), findsOneWidget);
    expect(find.text('DEMO TRANSACTION — NO REAL PAYMENT'), findsOneWidget);
    expect(find.textContaining('Receipt RC1001'), findsOneWidget);
  });

  testWidgets('pending payments are not shown as paid receipts', (tester) async {
    usePhoneSize(tester);
    final placed = fx.order(status: 'PLACED', number: 'SV3001');
    final h = TestHarness()..api.activeOrders = [placed];
    h.api.ordersById[placed.id] = placed;
    await h.pumpSignedIn(tester);
    await tester.tap(navTab('Orders'));
    await tester.pumpAndSettle();
    expect(find.text('PAYMENT PENDING'), findsWidgets);
    await tester.tap(find.text('SV3001'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Receipt'), findsNothing);
    expect(find.text('PAYMENT PENDING'), findsWidgets);
  });
}
