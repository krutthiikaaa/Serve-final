import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/core/api_exception.dart';
import 'package:serve_student/services/api/models.dart';
import 'package:serve_student/services/api/serve_api.dart';
import 'package:serve_student/ui/cart_actions.dart';

import '../support/fakes.dart';
import '../support/fixtures.dart' as fx;

Finder navTab(String label) => find.descendant(of: find.byType(NavigationBar), matching: find.text(label));

void main() {
  testWidgets('bottom navigation is exactly Home, Menu, Orders, Profile with no drawer', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await h.pumpSignedIn(tester);
    final destinations = tester.widget<NavigationBar>(find.byType(NavigationBar)).destinations.cast<NavigationDestination>();
    expect(destinations.map((d) => d.label), ['Home', 'Menu', 'Orders', 'Profile']);
    expect(find.byType(Drawer), findsNothing);
    expect(find.byIcon(Icons.menu), findsNothing);
    expect(find.bySemanticsLabel('Cart'), findsWidgets);
    expect(find.bySemanticsLabel('Notifications'), findsWidgets);
  });

  testWidgets('home shows the recommendation basis and View Full Menu opens the menu tab', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness()
      ..api.recommendationsValue = Recommendations(RecommendationBasis.mostOrdered, [
        fx.item('a1000000-0000-4000-8000-000000000001', 'Veg Grilled Sandwich'),
      ]);
    await h.pumpSignedIn(tester);
    expect(find.text('Your Most Ordered'), findsOneWidget);
    expect(find.text("Tonight's Menu"), findsNothing);
    await tester.tap(find.text('View Full Menu'));
    await tester.pumpAndSettle();
    expect(find.text('Sandwiches'), findsWidgets);
  });

  testWidgets('home shows the active order card with its number', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness()..api.activeOrders = [fx.order(status: 'READY', number: 'SV1042')];
    await h.pumpSignedIn(tester);
    expect(find.text('SV1042'), findsOneWidget);
    expect(find.text('READY FOR PICKUP'), findsOneWidget);
  });

  testWidgets('menu: + becomes [-] qty [+], unavailable items are disabled, inactive items hidden', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await h.pumpSignedIn(tester);
    await tester.tap(navTab('Menu'));
    await tester.pumpAndSettle();

    expect(find.text('Retired Sandwich'), findsNothing);
    expect(find.text('Unavailable'), findsOneWidget);
    final unavailableAdd = tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.add_rounded).at(1));
    expect(unavailableAdd.onPressed, isNull);

    await tester.tap(find.byTooltip('Add Veg Grilled Sandwich'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Remove one Veg Grilled Sandwich'), findsOneWidget);
    expect(find.text('1'), findsWidgets);
    await tester.tap(find.byTooltip('Add one more Veg Grilled Sandwich'));
    await tester.pumpAndSettle();
    expect(h.services.cart.quantityOf('a1000000-0000-4000-8000-000000000001'), 2);
    expect(find.bySemanticsLabel('Cart, 2'), findsOneWidget);
    expect(find.text('2 items'), findsOneWidget);
  });

  testWidgets('switching canteens with a cart asks first; Cancel keeps it, Switch Canteen clears it', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await h.pumpSignedIn(tester);
    h.services.cart.add(fx.item('a1000000-0000-4000-8000-000000000001', 'Veg Grilled Sandwich'), canteenName: 'K&G');
    await tester.pump();
    await tester.tap(find.text('Change'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Vedavathi Night Canteen'));
    await tester.pumpAndSettle();

    expect(find.text(switchCanteenMessage), findsOneWidget);
    expect(switchCanteenMessage, 'Your cart contains items from another canteen. Switching canteens will clear your current cart.');
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(h.services.cart.itemCount, 1);
    expect(h.services.selection.id, fx.kgId);

    await tester.tap(find.text('Vedavathi Night Canteen'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Switch Canteen'));
    await tester.pumpAndSettle();
    expect(h.services.cart.isEmpty, isTrue);
    expect(h.services.selection.id, fx.vedId);
  });

  testWidgets('cart shows the backend quote total, not a device-computed one', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await h.pumpSignedIn(tester);
    h.services.cart.add(fx.item('a1000000-0000-4000-8000-000000000001', 'Veg Grilled Sandwich', price: 5000), canteenName: 'K&G');
    await tester.pump();
    await tester.tap(find.bySemanticsLabel('Cart, 1'));
    await tester.pumpAndSettle();
    // The fake quote deliberately returns ₹999 for a ₹50 item.
    expect(find.text('₹999'), findsOneWidget);
    expect(h.api.calls.where((c) => c.startsWith('quote:')), isNotEmpty);
  });

  testWidgets('sold-out lines block checkout until removed', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    h.api.onQuote = (_, _) async =>
        throw const CartIssuesException([CartIssue('a1000000-0000-4000-8000-000000000001', 'UNAVAILABLE')], 'unavailable');
    await h.pumpSignedIn(tester);
    h.services.cart.add(fx.item('a1000000-0000-4000-8000-000000000001', 'Veg Grilled Sandwich'), canteenName: 'K&G');
    await tester.pump();
    await tester.tap(find.bySemanticsLabel('Cart, 1'));
    await tester.pumpAndSettle();
    expect(find.text('Sold out right now'), findsOneWidget);
    final checkout = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Remove sold-out items to continue'));
    expect(checkout.onPressed, isNull);
  });

  testWidgets('checkout reuses one Idempotency-Key across retries, then pays and confirms', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    var attempts = 0;
    h.api.onPlaceOrder = (canteenId, items, key) async {
      attempts++;
      if (attempts == 1) throw const ApiException(0, 'NETWORK_ERROR', ApiException.networkMessage);
      return fx.order(status: 'PLACED', number: 'SV2001', total: 99900);
    };
    await h.pumpSignedIn(tester);
    h.services.cart.add(fx.item('a1000000-0000-4000-8000-000000000001', 'Veg Grilled Sandwich'), canteenName: 'K&G');
    await tester.pump();
    await tester.tap(find.bySemanticsLabel('Cart, 1'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Checkout'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Collect in person'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'Place order'));
    await tester.pumpAndSettle();
    expect(find.text(ApiException.networkMessage), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Place order'));
    await tester.pumpAndSettle();
    expect(h.api.idempotencyKeys, hasLength(2));
    expect(h.api.idempotencyKeys.toSet(), hasLength(1));
    expect(h.services.cart.isEmpty, isTrue);

    expect(find.text('₹999'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Pay ₹999'));
    await tester.pumpAndSettle();
    expect(h.api.calls, containsAllInOrder(['initiate:d8c5c17f-0000-4000-8000-000000000001', 'mockComplete:true']));
    expect(find.text('Payment confirmed'), findsOneWidget);
    expect(find.text('SV1002'), findsOneWidget);
  });

  testWidgets('a failed mock payment explains and allows a retry', (tester) async {
    usePhoneSize(tester);
    final h = TestHarness();
    await h.pumpSignedIn(tester);
    h.services.cart.add(fx.item('a1000000-0000-4000-8000-000000000001', 'Veg Grilled Sandwich'), canteenName: 'K&G');
    await tester.pump();
    await tester.tap(find.bySemanticsLabel('Cart, 1'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Checkout'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Place order'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Simulate a failed payment'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Payment failed'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Pay ₹999'), findsOneWidget);
  });
}
