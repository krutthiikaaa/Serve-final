import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:provider/provider.dart';

import '../services/realtime/realtime_service.dart';

/// Screens that show live data: receive realtime events and refetch REST data
/// after every reconnect (events are not replayed) and when the app resumes.
mixin LiveReload<T extends StatefulWidget> on State<T>, WidgetsBindingObserver {
  StreamSubscription<RealtimeEvent>? _liveSub;
  RealtimeService? _realtime;
  int _seenEpoch = -1;

  /// Call from initState.
  void startLive() {
    final realtime = _realtime = context.read<RealtimeService>();
    _seenEpoch = realtime.epoch;
    realtime.addListener(_onRealtime);
    _liveSub = realtime.events.listen((event) {
      if (mounted) onLiveEvent(event);
    });
    WidgetsBinding.instance.addObserver(this);
  }

  void _onRealtime() {
    final realtime = _realtime;
    if (realtime == null || !mounted) return;
    if (realtime.epoch != _seenEpoch) {
      _seenEpoch = realtime.epoch;
      // Includes the first connection: anything that changed between the
      // initial REST load and the socket coming up is picked up here.
      onReconnect();
      onConnected();
    }
  }

  /// A server event arrived.
  void onLiveEvent(RealtimeEvent event) {}

  /// The socket reconnected after a drop, or the app came back to the
  /// foreground: refetch authoritative state.
  void onReconnect();

  /// Every successful connection (e.g. to (re)subscribe to a menu).
  void onConnected() {}

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && mounted) onReconnect();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _liveSub?.cancel();
    _realtime?.removeListener(_onRealtime);
    super.dispose();
  }
}
