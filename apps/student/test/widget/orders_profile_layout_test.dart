import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/services/api/models.dart';
import 'package:serve_student/theme/serve_layout.dart';
import 'package:serve_student/ui/screens/orders_screen.dart';

import '../support/fakes.dart';
import '../support/fixtures.dart' as fx;

Finder navTab(String label) => find.descendant(of: find.byType(NavigationBar), matching: find.text(label));

void useLogicalSize(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Future<void> openOrders(WidgetTester tester, {bool wide = false}) async {
  if (wide) {
    await tester.tap(find.widgetWithText(TextButton, 'Orders'));
  } else {
    await tester.tap(navTab('Orders'));
  }
  await tester.pumpAndSettle();
}

Future<void> openProfile(WidgetTester tester, {bool wide = false}) async {
  if (wide) {
    await tester.tap(find.widgetWithText(TextButton, 'Profile'));
  } else {
    await tester.tap(navTab('Profile'));
  }
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('orders page heading, tabs, empty states, and View Menu', (tester) async {
    useLogicalSize(tester, const Size(390, 844));
    await TestHarness().pumpSignedIn(tester);
    await openOrders(tester);

    expect(find.text('My Orders'), findsOneWidget);
    expect(find.text('Track your orders and revisit your previous purchases.'), findsOneWidget);
    expect(find.text('Active'), findsOneWidget);
    expect(find.text('Past'), findsOneWidget);
    expect(find.text('No active orders'), findsOneWidget);
    expect(find.text('Your current orders will appear here.'), findsOneWidget);
    expect(find.text('View Menu'), findsOneWidget);

    await tester.tap(find.text('Past'));
    await tester.pumpAndSettle();
    expect(find.text('No previous orders yet'), findsOneWidget);
    expect(find.text('Your completed orders will appear here.'), findsOneWidget);

    await tester.tap(find.text('View Menu'));
    await tester.pumpAndSettle();
    expect(find.text('Sandwiches'), findsWidgets);
  });

  testWidgets('active and past cards show real order data and details', (tester) async {
    useLogicalSize(tester, const Size(390, 844));
    final active = StudentOrder.fromJson(fx.orderJson(id: 'ord-active', status: 'PREPARING', number: 'SV1004', total: 22500));
    final past = StudentOrder.fromJson(fx.orderJson(id: 'ord-past', status: 'COLLECTED', number: 'SV1001', total: 18000));
    final cancelled = StudentOrder.fromJson(fx.orderJson(id: 'ord-cancel', status: 'CANCELLED', number: 'SV1003', total: 9000));
    final h = TestHarness()
      ..api.activeOrders = [active]
      ..api.pastOrders = [past, cancelled]
      ..api.ordersById[active.id] = active
      ..api.ordersById[past.id] = past;
    await h.pumpSignedIn(tester);
    await openOrders(tester);

    expect(find.byType(OrderCard), findsOneWidget);
    expect(find.text('SV1004'), findsOneWidget);
    expect(find.text('Krishna & Godavari Night Canteen'), findsOneWidget);
    expect(find.text('2 items'), findsOneWidget);
    expect(find.text('₹225'), findsOneWidget);
    expect(find.text('Preparing'), findsWidgets);
    expect(find.text('Placed'), findsOneWidget);
    expect(find.text('Ready'), findsOneWidget);
    expect(find.text('Collected'), findsOneWidget);
    expect(find.text('View Details'), findsOneWidget);

    await tester.tap(find.text('View Details'));
    await tester.pumpAndSettle();
    expect(find.text('SV1004'), findsWidgets);
    await tester.pageBack();
    await tester.pumpAndSettle();

    await tester.tap(find.text('Past'));
    await tester.pumpAndSettle();
    expect(find.text('SV1001'), findsOneWidget);
    expect(find.text('This order was collected.'), findsOneWidget);
    expect(find.text('SV1003'), findsOneWidget);
    expect(find.text('This order was cancelled.'), findsOneWidget);
    expect(find.text('Cancelled'), findsWidgets);
  });

  testWidgets('profile shows student data, pickup, activity, and logout', (tester) async {
    useLogicalSize(tester, const Size(390, 844));
    await TestHarness().pumpSignedIn(tester);
    await openProfile(tester);

    expect(find.text('Asha Rao'), findsOneWidget);
    expect(find.text('asha@example.edu'), findsOneWidget);
    expect(find.text('Student · Krishna'), findsOneWidget);
    expect(find.text('Pickup'), findsOneWidget);
    expect(find.text('Hostel'), findsOneWidget);
    expect(find.text('Krishna'), findsWidgets);
    expect(find.text('Default canteen'), findsOneWidget);
    expect(find.text('Krishna & Godavari Night Canteen'), findsWidgets);
    expect(find.text('Ordering from'), findsOneWidget);
    expect(find.text('Activity'), findsOneWidget);
    expect(find.text('Favourites'), findsOneWidget);
    expect(find.text('Your orders'), findsOneWidget);
    expect(find.text('Notifications'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, 'Log out'), findsOneWidget);

    await tester.tap(find.widgetWithText(OutlinedButton, 'Log out'));
    await tester.pumpAndSettle();
    expect(find.text('Log out?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Your orders'));
    await tester.pumpAndSettle();
    expect(find.text('My Orders'), findsOneWidget);

    await openProfile(tester);
    await tester.tap(find.text('Favourites'));
    await tester.pumpAndSettle();
    expect(find.text('No favourites yet'), findsOneWidget);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Notifications'));
    await tester.pumpAndSettle();
    expect(find.text('Notifications'), findsWidgets);
  });

  for (final size in const [
    Size(320, 568),
    Size(360, 640),
    Size(375, 812),
    Size(390, 844),
    Size(430, 932),
    Size(768, 1024),
    Size(1024, 768),
    Size(1280, 800),
    Size(1440, 900),
  ]) {
    testWidgets('orders and profile fit ${size.width.toInt()}x${size.height.toInt()}', (tester) async {
      useLogicalSize(tester, size);
      final wide = size.width >= ServeLayout.sidebarMin;
      final h = TestHarness()..api.activeOrders = [fx.order(status: 'READY', number: 'SV1042')];
      await h.pumpSignedIn(tester);
      await openOrders(tester, wide: wide);
      expect(tester.takeException(), isNull);
      expect(find.text('My Orders'), findsOneWidget);
      expect(find.text('SV1042'), findsOneWidget);
      expect(find.text('Explore Categories'), findsNothing);

      await openProfile(tester, wide: wide);
      expect(tester.takeException(), isNull);
      expect(find.text('Asha Rao'), findsOneWidget);
      expect(find.text('Favourites'), findsOneWidget);
      if (wide) {
        expect(find.byType(NavigationBar), findsNothing);
      } else {
        expect(find.byType(NavigationBar), findsOneWidget);
      }
    });
  }
}
