import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:serve_student/services/favourites/favourites_store.dart';
import 'package:serve_student/state/favourites_controller.dart';

import '../support/fixtures.dart' as fx;

void main() {
  test('toggle adds and removes an item id', () async {
    final store = MemoryFavouritesStore();
    final favourites = FavouritesController(store);
    await favourites.useAccount('student');
    await favourites.toggle('a1000000-0000-4000-8000-000000000001');
    expect(favourites.contains('a1000000-0000-4000-8000-000000000001'), isTrue);
    expect(store.values['student'], {'a1000000-0000-4000-8000-000000000001'});
    await favourites.toggle('a1000000-0000-4000-8000-000000000001');
    expect(favourites.contains('a1000000-0000-4000-8000-000000000001'), isFalse);
    expect(store.values['student'], isEmpty);
  });

  test('load restores ids from the store', () async {
    final store = MemoryFavouritesStore({'kept'});
    final favourites = FavouritesController(store);
    await favourites.useAccount('student');
    expect(favourites.ids, {'kept'});
  });

  test('each account has its own favourites; signed out shows none', () async {
    final store = MemoryFavouritesStore({'asha-dish'}, 'asha');
    final favourites = FavouritesController(store);
    await favourites.useAccount('asha');
    expect(favourites.ids, {'asha-dish'});
    await favourites.useAccount(null);
    expect(favourites.ids, isEmpty);
    await favourites.toggle('ignored-while-signed-out');
    expect(store.values.keys, ['asha']);
    await favourites.useAccount('ravi');
    expect(favourites.ids, isEmpty, reason: "another student never sees Asha's favourites");
    await favourites.toggle('ravi-dish');
    await favourites.useAccount('asha');
    expect(favourites.ids, {'asha-dish'});
  });

  test('visibleOn only returns items still on the current menu', () async {
    final store = MemoryFavouritesStore({
      'a1000000-0000-4000-8000-000000000001',
      'dead0000-0000-4000-8000-000000000099',
      'a1000000-0000-4000-8000-000000000003',
    });
    final favourites = FavouritesController(store);
    await favourites.useAccount('student');
    final visible = favourites.visibleOn(fx.menu());
    expect(visible.map((e) => e.item.name), ['Veg Grilled Sandwich']);
    expect(visible.single.categoryName, 'Sandwiches');
  });

  group('SecureFavouritesStore (device storage)', () {
    setUp(() => FlutterSecureStorage.setMockInitialValues({'serve.favourites': '["shared-before-accounts"]'}));

    test('keeps one list per account and drops the old shared, unattributable list', () async {
      final storage = const FlutterSecureStorage();
      final store = SecureFavouritesStore(storage);
      expect(await store.read('asha'), isEmpty, reason: 'the old shared list is never handed to anyone');
      expect(await storage.read(key: 'serve.favourites'), isNull);
      await store.write('asha', {'a1'});
      await store.write('ravi', {'r1'});
      expect(await store.read('asha'), {'a1'});
      expect(await store.read('ravi'), {'r1'});
    });
  });
}
