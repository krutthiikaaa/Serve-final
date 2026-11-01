import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/services/favourites/favourites_store.dart';
import 'package:serve_student/state/favourites_controller.dart';

import '../support/fixtures.dart' as fx;

void main() {
  test('toggle adds and removes an item id', () async {
    final store = MemoryFavouritesStore();
    final favourites = FavouritesController(store);
    await favourites.load();
    await favourites.toggle('a1000000-0000-4000-8000-000000000001');
    expect(favourites.contains('a1000000-0000-4000-8000-000000000001'), isTrue);
    expect(store.value, {'a1000000-0000-4000-8000-000000000001'});
    await favourites.toggle('a1000000-0000-4000-8000-000000000001');
    expect(favourites.contains('a1000000-0000-4000-8000-000000000001'), isFalse);
    expect(store.value, isEmpty);
  });

  test('load restores ids from the store', () async {
    final store = MemoryFavouritesStore({'kept'});
    final favourites = FavouritesController(store);
    await favourites.load();
    expect(favourites.ids, {'kept'});
  });

  test('visibleOn only returns items still on the current menu', () async {
    final store = MemoryFavouritesStore({
      'a1000000-0000-4000-8000-000000000001',
      'dead0000-0000-4000-8000-000000000099',
      'a1000000-0000-4000-8000-000000000003',
    });
    final favourites = FavouritesController(store);
    await favourites.load();
    final visible = favourites.visibleOn(fx.menu());
    expect(visible.map((e) => e.item.name), ['Veg Grilled Sandwich']);
    expect(visible.single.categoryName, 'Sandwiches');
  });
}
