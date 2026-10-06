import 'dart:async';

import 'package:flutter/foundation.dart';

import '../services/api/models.dart';
import '../services/api/serve_api.dart';
import '../services/realtime/realtime_service.dart';

/// Unread badge: REST on start and after every reconnect, realtime in between.
class NotificationsController extends ChangeNotifier {
  NotificationsController(this._api, this._realtime);

  final ServeApi _api;
  final RealtimeService _realtime;
  StreamSubscription<RealtimeEvent>? _sub;
  int _epoch = -1;

  int unreadCount = 0;

  /// The latest notification delivered live (screens prepend it).
  AppNotification? latest;

  void start() {
    _sub ??= _realtime.events.listen((event) {
      if (event.type != 'notification.created') return;
      final raw = event.data['notification'];
      if (raw is! Map) return;
      latest = AppNotification.fromJson(raw.cast<String, dynamic>());
      unreadCount += 1;
      notifyListeners();
    });
    _realtime.addListener(_onRealtime);
    unawaited(refresh());
  }

  void stop() {
    _sub?.cancel();
    _sub = null;
    _realtime.removeListener(_onRealtime);
    unreadCount = 0;
    latest = null;
    _epoch = -1;
  }

  void _onRealtime() {
    if (_realtime.epoch != _epoch) {
      _epoch = _realtime.epoch;
      unawaited(refresh());
    }
  }

  Future<void> refresh() async {
    try {
      final page = await _api.notifications(unreadOnly: true);
      setUnread(page.unreadCount ?? page.items.length);
    } catch (_) {
      // The badge is non-critical; the notifications screen shows errors.
    }
  }

  void setUnread(int count) {
    unreadCount = count < 0 ? 0 : count;
    notifyListeners();
  }

  @override
  void dispose() {
    stop();
    super.dispose();
  }
}
