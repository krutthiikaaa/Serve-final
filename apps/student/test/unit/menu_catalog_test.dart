import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/ui/menu/menu_catalog.dart';

import '../support/fixtures.dart' as fx;

void main() {
  test('hides inactive items and keeps unavailable ones', () {
    final entries = MenuCatalog.flatten(fx.menu());
    expect(entries.map((e) => e.item.name), ['Veg Grilled Sandwich', 'Paneer Grilled Sandwich']);
  });

  test('search matches name or description from existing menu data', () {
    final menu = fx.menu();
    expect(MenuCatalog.page(menu: menu, filters: const MenuFilters(search: 'paneer')).items.single.item.name, 'Paneer Grilled Sandwich');
    expect(MenuCatalog.page(menu: menu, filters: const MenuFilters(search: 'veg grilled sandwich description')).total, 1);
    expect(MenuCatalog.page(menu: menu, filters: const MenuFilters(search: 'dosa')).total, 0);
  });

  test('category, price, and availability filters use real item fields', () {
    final menu = fx.menu();
    expect(MenuCatalog.page(menu: menu, filters: MenuFilters(categoryId: fx.sandwichesId)).total, 2);
    expect(MenuCatalog.page(menu: menu, filters: const MenuFilters(maxPricePaise: 6000)).items.single.item.name, 'Veg Grilled Sandwich');
    expect(MenuCatalog.page(menu: menu, filters: const MenuFilters(includeUnavailable: false)).items.single.item.name, 'Veg Grilled Sandwich');
    expect(MenuCatalog.page(menu: menu, filters: const MenuFilters(includeAvailable: false)).items.single.item.name, 'Paneer Grilled Sandwich');
  });

  test('sort and pagination work on the filtered list', () {
    final menu = fx.menu(
      sandwiches: [
        for (var i = 0; i < 13; i++) fx.itemJson('a1000000-0000-4000-8000-0000000000${i.toString().padLeft(2, '0')}', 'Item $i', price: 1000 * (13 - i)),
      ],
    );
    final high = MenuCatalog.page(menu: menu, sortBy: MenuSort.priceHigh, pageSize: 12);
    expect(high.total, 13);
    expect(high.pageCount, 2);
    expect(high.items.first.item.pricePaise, 13000);
    expect(MenuCatalog.page(menu: menu, sortBy: MenuSort.priceHigh, page: 2, pageSize: 12).items.single.item.pricePaise, 1000);
  });
}
