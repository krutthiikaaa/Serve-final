import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/theme/serve_layout.dart';
import 'package:serve_student/ui/widgets/food_product_card.dart';
import 'package:serve_student/ui/widgets/menu_filter_panel.dart';

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
  testWidgets('phone menu uses a grid, search, filters, and keeps existing add-to-cart', (tester) async {
    useLogicalSize(tester, const Size(390, 844));
    final h = TestHarness();
    await openMenu(tester, h);

    expect(find.text('Menu'), findsWidgets);
    expect(find.text('Sandwiches'), findsWidgets);
    expect(find.widgetWithText(TextField, 'Search this menu'), findsOneWidget);
    expect(find.byTooltip('Filters'), findsOneWidget);
    expect(find.byType(FoodProductCard), findsNWidgets(2));
    expect(find.text('Retired Sandwich'), findsNothing);
    expect(find.text('Unavailable'), findsOneWidget);

    await tester.ensureVisible(find.byTooltip('Add Veg Grilled Sandwich'));
    await tester.tap(find.byTooltip('Add Veg Grilled Sandwich'));
    await tester.pumpAndSettle();
    expect(h.services.cart.quantityOf('a1000000-0000-4000-8000-000000000001'), 1);
    expect(find.text('1 item'), findsOneWidget);
  });

  testWidgets('search and sort use the loaded menu', (tester) async {
    useLogicalSize(tester, const Size(390, 844));
    await openMenu(tester, TestHarness());

    await tester.enterText(find.byType(TextField), 'paneer');
    await tester.pumpAndSettle();
    expect(find.text('Paneer Grilled Sandwich'), findsOneWidget);
    expect(find.text('Veg Grilled Sandwich'), findsNothing);

    await tester.enterText(find.byType(TextField), '');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Featured'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Price: high to low').last);
    await tester.pumpAndSettle();
    final cards = tester.widgetList<FoodProductCard>(find.byType(FoodProductCard)).toList();
    expect(cards.first.item.name, 'Paneer Grilled Sandwich');
  });

  testWidgets('opening an item records it in recently viewed with the same image source', (tester) async {
    useLogicalSize(tester, const Size(390, 844));
    await openMenu(tester, TestHarness());
    await tester.ensureVisible(find.text('Veg Grilled Sandwich').first);
    await tester.tap(find.text('Veg Grilled Sandwich').first);
    await tester.pumpAndSettle();
    expect(find.text('Recently viewed'), findsNothing);
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('Recently viewed'), findsOneWidget);
    expect(find.text('Veg Grilled Sandwich'), findsWidgets);
  });

  testWidgets('desktop shows a filter sidebar and header destinations', (tester) async {
    useLogicalSize(tester, const Size(1280, 800));
    final h = TestHarness();
    await h.pumpSignedIn(tester);
    await tester.tap(find.widgetWithText(TextButton, 'Menu'));
    await tester.pumpAndSettle();

    expect(find.byType(NavigationBar), findsNothing);
    expect(find.byType(MenuFilterPanel), findsOneWidget);
    expect(find.text('Apply filters'), findsOneWidget);
    expect(find.text('Clear filters'), findsOneWidget);
    expect(find.byType(FoodProductCard), findsNWidgets(2));
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
    testWidgets('menu layout fits ${size.width.toInt()}x${size.height.toInt()}', (tester) async {
      useLogicalSize(tester, size);
      final wide = size.width >= ServeLayout.sidebarMin;
      final h = TestHarness();
      await h.pumpSignedIn(tester);
      if (wide) {
        await tester.tap(find.widgetWithText(TextButton, 'Menu'));
      } else {
        await tester.tap(navTab('Menu'));
      }
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('Veg Grilled Sandwich'), findsOneWidget);
      expect(find.byType(FoodProductCard), findsWidgets);
      if (wide) {
        expect(find.byType(MenuFilterPanel), findsOneWidget);
        expect(find.byType(NavigationBar), findsNothing);
      } else {
        expect(find.byType(NavigationBar), findsOneWidget);
        expect(find.byTooltip('Filters').evaluate().isNotEmpty || find.text('Filters').evaluate().isNotEmpty, isTrue);
      }
    });
  }
}
