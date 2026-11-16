import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/services/api/models.dart';
import 'package:serve_student/ui/screens/order_details_screen.dart';

import '../support/fakes.dart';
import '../support/fixtures.dart' as fx;

Finder navTab(String label) => find.descendant(of: find.byType(NavigationBar), matching: find.text(label));

void main() {
  testWidgets('home shows the area’s Day and Night canteens; switching loads the Day canteen menu', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await h.pumpSignedIn(tester);
    expect(find.text('SERVING KRISHNA & GODAVARI'), findsOneWidget);
    expect(find.byKey(const Key('service-NIGHT')), findsOneWidget);
    expect(find.byKey(const Key('service-DAY')), findsOneWidget);
    expect(find.text('Taking orders'), findsWidgets);
    expect(find.text('Off duty'), findsOneWidget);
    expect(h.services.selection.period, ServicePeriod.night);

    await tester.tap(find.byKey(const Key('service-DAY')));
    await tester.pumpAndSettle();
    expect(h.api.calls, contains('menu:${fx.kgDayId}:DAY'));
    expect(h.services.selection.id, fx.kgDayId);
    expect(h.services.selection.period, ServicePeriod.day);
    // The Day canteen is off duty while Night serves: browsable, not orderable.
    expect(find.text('Krishna & Godavari Night Canteen is serving your area right now.'), findsOneWidget);
  });

  testWidgets('switching to the other canteen with a cart asks to clear it', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await h.pumpSignedIn(tester);
    h.services.cart.add(
      fx.item('a1000000-0000-4000-8000-000000000001', 'Veg Grilled Sandwich'),
      canteenName: 'K&G',
      period: ServicePeriod.night,
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('service-DAY')));
    await tester.pumpAndSettle();
    expect(find.textContaining('items from another canteen'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(h.services.cart.isEmpty, isFalse);
    expect(h.services.selection.id, fx.kgId);
    expect(h.services.selection.period, ServicePeriod.night);
  });

  testWidgets('shows a clear unavailable state when neither canteen takes orders', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    h.api.menus[fx.kgId] = fx.menu(status: 'PAUSED', state: 'PAUSED');
    await h.pumpSignedIn(tester);
    expect(find.byKey(const Key('area-unavailable')), findsOneWidget);
  });

  testWidgets('order details show a simulated-payment warning and keep historical orders without a period', (tester) async {
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
    expect(find.text('Simulated'), findsWidgets);
    expect(find.text('Service period not recorded'), findsOneWidget);
    await tester.tap(find.text('SV8801'));
    await tester.pumpAndSettle();
    expect(find.byType(OrderDetailsScreen), findsOneWidget);
    expect(find.text('SIMULATED TRANSACTION — NO REAL PAYMENT'), findsOneWidget);
    expect(find.textContaining('DEMO'), findsNothing);
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
