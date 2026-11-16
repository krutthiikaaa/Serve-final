import 'package:flutter/foundation.dart';

import '../services/api/models.dart';

/// The canteen the student is browsing. Defaults to the canteen serving their
/// hostel's service area (`defaultCanteen` from /me, or `current` from
/// /students/me/service). Day and Night canteens are separate canteens, so the
/// service period is simply the selected canteen's type — never the phone clock.
class CanteenSelection extends ChangeNotifier {
  String? _id;
  String? _name;
  ServicePeriod _type = ServicePeriod.night;
  Canteen? _details;

  String? get id => _id;
  String? get name => _name;

  /// DAY or NIGHT: the selected canteen's own (and only) service period.
  ServicePeriod get period => _type;
  Canteen? get details => _details;

  void initialize(StudentMe me) {
    if (_id != null) return;
    final canteen = me.defaultCanteen;
    if (canteen == null) return;
    _id = canteen.id;
    _name = canteen.name;
    _type = canteen.type;
    notifyListeners();
  }

  void select(String id, String name, {Canteen? details, ServicePeriod? type}) {
    _id = id;
    _name = name;
    if (details != null) _details = details;
    _type = details?.type ?? type ?? (_details?.id == id ? _details!.type : _type);
    notifyListeners();
  }

  /// Keeps name/type/availability in sync with the latest backend data.
  void applyCanteen(Canteen canteen) {
    if (_id != null && canteen.id != _id) return;
    _id ??= canteen.id;
    _details = canteen;
    _name = canteen.name;
    _type = canteen.type;
    notifyListeners();
  }

  /// Follows the area's serving canteen unless the student picked one.
  void applyService(StudentService service) {
    final current = service.current;
    if (current == null) return;
    final chosenStillExists = _id != null && service.canteens.any((c) => c.id == _id);
    if (chosenStillExists) {
      final fresh = service.canteens.firstWhere((c) => c.id == _id);
      if (_details?.availability?.state != fresh.availability?.state || _details?.id != fresh.id) {
        _details = fresh;
        _name = fresh.name;
        _type = fresh.type;
        notifyListeners();
      }
      return;
    }
    select(current.id, current.name, details: current);
  }

  void reset() {
    _id = null;
    _name = null;
    _type = ServicePeriod.night;
    _details = null;
  }
}
