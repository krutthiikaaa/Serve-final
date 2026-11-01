import 'dart:async';

import 'package:flutter/foundation.dart';

import '../services/api/models.dart';
import '../services/favourites/favourites_store.dart';

/// Device-local favourite IDs. Resolved against the current menu when shown.
class FavouritesController extends ChangeNotifier {
  FavouritesController(this._store) {
    unawaited(load());
  }

  final FavouritesStore _store;
  final Set<String> _ids = {};
  var _ready = false;

  bool get ready => _ready;
  int get count => _ids.length;
  Set<String> get ids => Set.unmodifiable(_ids);
  bool contains(String id) => _ids.contains(id);

  Future<void> load() async {
    final stored = await _store.read();
    _ids
      ..clear()
      ..addAll(stored);
    _ready = true;
    notifyListeners();
  }

  Future<void> toggle(String id) async {
    if (id.isEmpty) return;
    if (!_ids.remove(id)) _ids.add(id);
    notifyListeners();
    await _store.write(_ids);
  }

  /// Latest copies of favourited items that still exist on this menu.
  List<({MenuItem item, String? categoryName})> visibleOn(Menu menu) {
    final byId = <String, ({MenuItem item, String? categoryName})>{};
    for (final category in menu.visibleCategories) {
      for (final item in category.items) {
        byId[item.id] = (item: item, categoryName: category.name);
      }
    }
    return [for (final id in _ids) if (byId[id] != null) byId[id]!];
  }
}
