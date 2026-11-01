import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/services/api/models.dart';
import 'package:serve_student/theme/serve_layout.dart';

import '../support/fakes.dart';
import '../support/fixtures.dart' as fx;

Finder navTab(String label) => find.descendant(of: find.byType(NavigationBar), matching: find.text(label));

void useLogicalSize(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets('home has the approved sections and no Explore Categories', (tester) async {
    useLogicalSize(tester, const Size(390, 844));
    final h = TestHarness()
      ..api.recommendationsValue = Recommendations(RecommendationBasis.mostOrdered, [
        fx.item('a1000000-0000-4000-8000-000000000001', 'Veg Grilled Sandwich'),
      ]);
    await h.pumpSignedIn(tester);

    expect(find.text('Hi, Asha'), findsOneWidget);
    expect(find.text('What are you craving tonight?'), findsOneWidget);
    expect(find.text('Search for dishes, categories...'), findsOneWidget);
    expect(find.text('PICKING UP FROM'), findsOneWidget);
    expect(find.text('Krishna & Godavari Night Canteen'), findsOneWidget);
    expect(find.text('Between Krishna and Godavari hostels'), findsOneWidget);
    expect(find.text('Accepting orders'), findsOneWidget);
    expect(find.text('9:00 PM – 3:00 AM'), findsOneWidget);
    expect(find.text('Change Canteen'), findsOneWidget);
    expect(find.text('Your Most Ordered'), findsOneWidget);
    expect(find.text('Your go-to favourites, just a tap away.'), findsOneWidget);
    expect(find.text('View All'), findsOneWidget);
    expect(find.text('Your Favourites'), findsOneWidget);
    expect(find.text('Your saved food items, when available.'), findsOneWidget);
    expect(find.text('View Favourites'), findsOneWidget);
    expect(find.text('Explore the Full Menu'), findsOneWidget);
    expect(find.text('Browse all items, filter, and find something delicious.'), findsOneWidget);
    expect(find.text('View Full Menu'), findsOneWidget);
    expect(find.text('Explore Categories'), findsNothing);
    expect(find.text('Veg Grilled Sandwich'), findsOneWidget);
    expect(find.text('Veg Grilled Sandwich description'), findsOneWidget);
  });

  testWidgets('home search opens the existing menu search', (tester) async {
    useLogicalSize(tester, const Size(390, 844));
    await TestHarness().pumpSignedIn(tester);
    await tester.tap(find.text('Search for dishes, categories...'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(TextField, 'Search this menu'), findsOneWidget);
    expect(find.text('Sandwiches'), findsWidgets);
  });

  testWidgets('View All and View Favourites use existing destinations', (tester) async {
    useLogicalSize(tester, const Size(390, 844));
    await TestHarness().pumpSignedIn(tester);
    await tester.ensureVisible(find.text('View All'));
    await tester.tap(find.text('View All'));
    await tester.pumpAndSettle();
    expect(find.text('Sandwiches'), findsWidgets);

    await tester.tap(navTab('Home'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('View Favourites'));
    await tester.tap(find.text('View Favourites'));
    await tester.pumpAndSettle();
    expect(find.text('No favourites yet'), findsOneWidget);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
  });

  testWidgets('home heart and add-to-cart stay independent', (tester) async {
    useLogicalSize(tester, const Size(390, 844));
    final h = TestHarness()
      ..api.recommendationsValue = Recommendations(RecommendationBasis.mostOrdered, [
        fx.item('a1000000-0000-4000-8000-000000000001', 'Veg Grilled Sandwich'),
      ]);
    await h.pumpSignedIn(tester);

    await tester.tap(find.byTooltip('Save Veg Grilled Sandwich to favourites'));
    await tester.pumpAndSettle();
    expect(h.services.favourites.contains('a1000000-0000-4000-8000-000000000001'), isTrue);
    expect(h.services.cart.isEmpty, isTrue);

    await tester.tap(find.byTooltip('Add Veg Grilled Sandwich'));
    await tester.pumpAndSettle();
    expect(h.services.cart.quantityOf('a1000000-0000-4000-8000-000000000001'), 1);
    expect(h.services.favourites.contains('a1000000-0000-4000-8000-000000000001'), isTrue);
  });

  testWidgets('first-time recommendations keep their existing heading', (tester) async {
    useLogicalSize(tester, const Size(390, 844));
    await TestHarness().pumpSignedIn(tester);
    expect(find.text('Popular with Students'), findsOneWidget);
    expect(find.text('Your Most Ordered'), findsNothing);
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
    testWidgets('home layout fits ${size.width.toInt()}x${size.height.toInt()}', (tester) async {
      useLogicalSize(tester, size);
      final h = TestHarness()
        ..api.recommendationsValue = Recommendations(RecommendationBasis.mostOrdered, [
          fx.item('a1000000-0000-4000-8000-000000000001', 'Veg Grilled Sandwich'),
          fx.item('a1000000-0000-4000-8000-000000000004', 'Masala Dosa', categoryId: fx.sandwichesId),
          fx.item('a1000000-0000-4000-8000-000000000005', 'Filter Coffee', categoryId: fx.juicesId),
        ]);
      await h.pumpSignedIn(tester);
      expect(tester.takeException(), isNull);
      expect(find.text('Hi, Asha'), findsOneWidget);
      await tester.ensureVisible(find.text('Your Most Ordered'));
      expect(find.text('Your Most Ordered'), findsOneWidget);
      await tester.ensureVisible(find.text('Your Favourites'));
      expect(find.text('Your Favourites'), findsOneWidget);
      await tester.ensureVisible(find.text('Explore the Full Menu'));
      expect(find.text('Explore the Full Menu'), findsOneWidget);
      expect(find.text('Explore Categories'), findsNothing);
      expect(find.text('Veg Grilled Sandwich'), findsOneWidget);
      final overflow = tester.takeException();
      expect(overflow, isNull);
      if (size.width >= ServeLayout.sidebarMin) {
        expect(find.byType(NavigationBar), findsNothing);
      } else {
        expect(find.byType(NavigationBar), findsOneWidget);
      }
    });
  }
}
