import 'package:flutter/foundation.dart';

import '../services/api/models.dart';

/// The canteen and DAY/NIGHT service the student is browsing.
/// Defaults to the hostel's canteen (`defaultCanteen` from /me). Period comes
/// from backend-supported services, never from the phone clock.
class CanteenSelection extends ChangeNotifier {
  String? _id;
  String? _name;
  ServicePeriod _period = ServicePeriod.night;
  bool _periodChosen = false;
  Canteen? _details;

  String? get id => _id;
  String? get name => _name;
  ServicePeriod get period => _period;
  Canteen? get details => _details;

  void initialize(StudentMe me) {
    if (_id != null) return;
    _id = me.defaultCanteen.id;
    _name = me.defaultCanteen.name;
    notifyListeners();
  }

  void select(String id, String name, {Canteen? details}) {
    final same = _id == id;
    _id = id;
    _name = name;
    if (details != null) _details = details;
    if (!same) _periodChosen = false;
    if (_details != null) _adoptPeriod(_details!);
    notifyListeners();
  }

  void selectPeriod(ServicePeriod period) {
    if (_period == period) return;
    _period = period;
    _periodChosen = true;
    notifyListeners();
  }

  /// Aligns the selected period with backend services when the student has not
  /// explicitly picked one. Does not invent hours.
  void applyCanteen(Canteen canteen) {
    if (_id != null && canteen.id != _id) return;
    _details = canteen;
    _name = canteen.name;
    _adoptPeriod(canteen);
    notifyListeners();
  }

  void _adoptPeriod(Canteen canteen) {
    if (_periodChosen && canteen.supports(_period)) return;
    final open = canteen.services.where((s) => s.isEnabled && s.isOpenNow).map((s) => s.period).toList();
    if (open.contains(_period)) return;
    if (open.isNotEmpty) {
      _period = open.first;
      return;
    }
    if (canteen.supportedPeriods.isNotEmpty && !canteen.supports(_period)) {
      _period = canteen.supportedPeriods.first;
    }
  }

  void reset() {
    _id = null;
    _name = null;
    _period = ServicePeriod.night;
    _periodChosen = false;
    _details = null;
  }
}
