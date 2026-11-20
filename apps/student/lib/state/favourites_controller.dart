import 'dart:async';

import 'package:flutter/foundation.dart';

import '../services/api/models.dart';
import '../services/favourites/favourites_store.dart';

/// The signed-in student's favourite IDs (stored on the device per account).
/// Resolved against the current menu when shown. Empty while signed out.
class FavouritesController extends ChangeNotifier {
  FavouritesController(this._store);

  final FavouritesStore _store;
  final Set<String> _ids = {};
  String? _account;
  var _ready = false;

  bool get ready => _ready;
  int get count => _ids.length;
  Set<String> get ids => Set.unmodifiable(_ids);
  bool contains(String id) => _ids.contains(id);

  /// Switches to [account]'s favourites (a student id), or to none (null) on
  /// sign-out. The previous account's list never stays visible.
  Future<void> useAccount(String? account) async {
    if (account == _account && (_ready || account == null)) return;
    _account = account;
    _ids.clear();
    _ready = false;
    notifyListeners();
    await load();
  }

  Future<void> load() async {
    final account = _account;
    if (account == null) return;
    final stored = await _store.read(account);
    if (account != _account) return; // switched meanwhile
    _ids
      ..clear()
      ..addAll(stored);
    _ready = true;
    notifyListeners();
  }

  Future<void> toggle(String id) async {
    final account = _account;
    if (id.isEmpty || account == null) return;
    if (!_ids.remove(id)) _ids.add(id);
    notifyListeners();
    await _store.write(account, _ids);
  }

  /// Latest copies of favourited items that still exist on this menu.
  List<({MenuItem item, String? categoryName})> visibleOn(Menu menu) {
    final byId = <String, ({MenuItem item, String? categoryName})>{};
    for (final category in menu.visibleCategories) {
      for (final item in category.items) {
        byId[item.id] = (item: item, categoryName: category.name);
      }
    }
    return [
      for (final id in _ids)
        if (byId[id] != null) byId[id]!,
    ];
  }
}
