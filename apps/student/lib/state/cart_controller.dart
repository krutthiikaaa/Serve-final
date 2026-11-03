import 'package:flutter/foundation.dart';

import '../services/api/models.dart';
import '../services/api/serve_api.dart';

class CartLine {
  CartLine(this.item, this.quantity);
  MenuItem item;
  int quantity;
}

enum AddResult { added, differentCanteen, differentPeriod, limitReached, notOrderable }

/// The local convenience cart. It belongs to exactly one canteen and service
/// period; prices shown here are snapshots for display — the backend quote is
/// authoritative.
class CartController extends ChangeNotifier {
  static const maxQuantity = 20;

  String? _canteenId;
  String? _canteenName;
  ServicePeriod? _period;
  final _lines = <String, CartLine>{};

  String? get canteenId => _canteenId;
  String? get canteenName => _canteenName;
  ServicePeriod? get period => _period;
  bool get isEmpty => _lines.isEmpty;
  List<CartLine> get lines => _lines.values.toList(growable: false);
  int get itemCount => _lines.values.fold(0, (n, l) => n + l.quantity);
  int quantityOf(String menuItemId) => _lines[menuItemId]?.quantity ?? 0;

  /// True when adding from [canteenId]/[period] would require clearing first.
  bool conflictsWith({required String canteenId, required ServicePeriod period}) {
    if (_lines.isEmpty) return false;
    return _canteenId != canteenId || _period != period;
  }

  AddResult add(MenuItem item, {required String canteenName, required ServicePeriod period}) {
    if (!item.isOrderable) return AddResult.notOrderable;
    if (_lines.isNotEmpty && _canteenId != item.canteenId) return AddResult.differentCanteen;
    if (_lines.isNotEmpty && _period != period) return AddResult.differentPeriod;
    final line = _lines[item.id];
    if (line != null && line.quantity >= maxQuantity) return AddResult.limitReached;
    _canteenId = item.canteenId;
    _canteenName = canteenName;
    _period = period;
    if (line == null) {
      _lines[item.id] = CartLine(item, 1);
    } else {
      line
        ..quantity += 1
        ..item = item;
    }
    notifyListeners();
    return AddResult.added;
  }

  void decrement(String menuItemId) {
    final line = _lines[menuItemId];
    if (line == null) return;
    if (line.quantity <= 1) {
      _lines.remove(menuItemId);
    } else {
      line.quantity -= 1;
    }
    _resetIfEmpty();
    notifyListeners();
  }

  void remove(String menuItemId) {
    if (_lines.remove(menuItemId) == null) return;
    _resetIfEmpty();
    notifyListeners();
  }

  /// Keeps the cart's item snapshots in sync with live menu changes.
  void updateItem(MenuItem item) {
    final line = _lines[item.id];
    if (line == null) return;
    line.item = item;
    notifyListeners();
  }

  void clear() {
    _lines.clear();
    _resetIfEmpty();
    notifyListeners();
  }

  List<CartLineInput> toInputs() => [for (final l in _lines.values) CartLineInput(l.item.id, l.quantity)];

  void _resetIfEmpty() {
    if (_lines.isEmpty) {
      _canteenId = null;
      _canteenName = null;
      _period = null;
    }
  }
}
