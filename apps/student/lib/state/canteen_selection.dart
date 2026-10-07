import 'package:flutter/foundation.dart';

import '../services/api/models.dart';

/// The canteen the student is browsing. Defaults to the hostel's canteen
/// (`defaultCanteen` from /me); the student may pick another one.
class CanteenSelection extends ChangeNotifier {
  String? _id;
  String? _name;

  String? get id => _id;
  String? get name => _name;

  void initialize(StudentMe me) {
    if (_id != null) return;
    _id = me.defaultCanteen.id;
    _name = me.defaultCanteen.name;
    notifyListeners();
  }

  void select(String id, String name) {
    if (_id == id) return;
    _id = id;
    _name = name;
    notifyListeners();
  }

  void reset() {
    _id = null;
    _name = null;
  }
}
