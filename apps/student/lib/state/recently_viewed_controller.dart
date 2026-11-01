import 'package:flutter/foundation.dart';

import '../services/api/models.dart';

/// Session-local view history. Item snapshots stay in memory so we never
/// invent food data or images; entries that leave the current menu drop out.
class RecentlyViewedController extends ChangeNotifier {
  static const maxItems = 8;

  final List<MenuItem> _items = [];

  List<MenuItem> get items => List.unmodifiable(_items);

  void record(MenuItem item) {
    if (item.availability == Availability.inactive) return;
    _items.removeWhere((i) => i.id == item.id);
    _items.insert(0, item);
    if (_items.length > maxItems) _items.removeLast();
    notifyListeners();
  }

  /// Latest copies of viewed items that still exist on this canteen's menu.
  List<({MenuItem item, String? categoryName})> visibleOn(Menu menu) {
    final byId = <String, ({MenuItem item, String? categoryName})>{};
    for (final category in menu.visibleCategories) {
      for (final item in category.items) {
        byId[item.id] = (item: item, categoryName: category.name);
      }
    }
    return [
      for (final viewed in _items)
        if (byId[viewed.id] != null) byId[viewed.id]!,
    ];
  }

  void clear() {
    if (_items.isEmpty) return;
    _items.clear();
    notifyListeners();
  }
}
