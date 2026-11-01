import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/services/favourites/favourites_store.dart';
import 'package:serve_student/ui/widgets/food_product_card.dart';

import '../support/fakes.dart';

Finder navTab(String label) => find.descendant(of: find.byType(NavigationBar), matching: find.text(label));

void useLogicalSize(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Future<void> openMenu(WidgetTester tester, TestHarness h) async {
  await h.pumpSignedIn(tester);
  await tester.tap(navTab('Menu'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('heart toggles a favourite without adding to the cart', (tester) async {
    useLogicalSize(tester, const Size(390, 844));
    final h = TestHarness();
    await openMenu(tester, h);

    await tester.ensureVisible(find.byTooltip('Save Veg Grilled Sandwich to favourites'));
    await tester.tap(find.byTooltip('Save Veg Grilled Sandwich to favourites'));
    await tester.pumpAndSettle();
    expect(h.services.favourites.contains('a1000000-0000-4000-8000-000000000001'), isTrue);
    expect(h.services.cart.isEmpty, isTrue);
    expect(find.byTooltip('Remove Veg Grilled Sandwich from favourites'), findsOneWidget);

    await tester.tap(find.byTooltip('Add Veg Grilled Sandwich'));
    await tester.pumpAndSettle();
    expect(h.services.cart.quantityOf('a1000000-0000-4000-8000-000000000001'), 1);

    await tester.tap(find.byTooltip('Remove Veg Grilled Sandwich from favourites'));
    await tester.pumpAndSettle();
    expect(h.services.favourites.contains('a1000000-0000-4000-8000-000000000001'), isFalse);
    expect(h.services.cart.quantityOf('a1000000-0000-4000-8000-000000000001'), 1);
  });

  testWidgets('favourites page shows saved cards and an empty state', (tester) async {
    useLogicalSize(tester, const Size(390, 844));
    final h = TestHarness();
    await h.pumpSignedIn(tester);
    await tester.tap(navTab('Profile'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Favourites'));
    await tester.pumpAndSettle();
    expect(find.text('No favourites yet'), findsOneWidget);

    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(navTab('Menu'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Save Veg Grilled Sandwich to favourites'));
    await tester.pumpAndSettle();
    await tester.tap(find.bySemanticsLabel('Favourites, 1'));
    await tester.pumpAndSettle();
    expect(find.byType(FoodProductCard), findsOneWidget);
    expect(find.text('Veg Grilled Sandwich'), findsOneWidget);
  });

  testWidgets('favourites survive sign-out and a new app instance', (tester) async {
    useLogicalSize(tester, const Size(390, 844));
    final store = MemoryFavouritesStore();
    final first = TestHarness(favouritesStore: store);
    await openMenu(tester, first);
    await first.services.favourites.toggle('a1000000-0000-4000-8000-000000000001');
    await tester.pump();
    await tester.tap(navTab('Profile'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(OutlinedButton, 'Log out'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Log out'));
    await tester.pumpAndSettle();
    expect(store.value, {'a1000000-0000-4000-8000-000000000001'});

    final second = TestHarness(favouritesStore: store);
    await tester.pumpWidget(second.app);
    await second.auth.signIn('asha@example.edu', 'password');
    await tester.pumpAndSettle();
    await second.services.favourites.load();
    expect(second.services.favourites.contains('a1000000-0000-4000-8000-000000000001'), isTrue);
    expect(find.byType(NavigationBar), findsOneWidget);
    await tester.tap(navTab('Profile'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Favourites'));
    await tester.pumpAndSettle();
    expect(find.text('Veg Grilled Sandwich'), findsOneWidget);
  });
}
