import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as sio;

import '../api/api_client.dart';

/// Server event envelope: `{ type, occurredAt, data }`.
class RealtimeEvent {
  const RealtimeEvent(this.type, this.data);
  final String type;
  final Map<String, dynamic> data;

  /// The order id for `order.*` events.
  String? get orderId => ((data['order'] as Map?)?['id']) as String?;
}

enum LiveState { connecting, connected, disconnected }

/// Live updates. Screens listen to [events] and refetch REST data whenever
/// [epoch] changes (every successful (re)connection), because events are not
/// replayed. The client never names rooms: the server assigns them.
abstract class RealtimeService extends ChangeNotifier {
  LiveState get state;

  /// Increments on every successful (re)connection.
  int get epoch;
  Stream<RealtimeEvent> get events;
  void start();
  void stop();

  /// Read-only public menu updates for a canteen (`menu:subscribe`).
  Future<bool> subscribeMenu(String canteenId);
}

/// Socket.IO implementation. The token is supplied by a callback on every
/// handshake; after `auth.expired` the next handshake forces a refresh.
class SocketRealtimeService extends RealtimeService {
  SocketRealtimeService({required this.url, required this._token});

  final String url;
  final TokenProvider _token;
  final _events = StreamController<RealtimeEvent>.broadcast();
  sio.Socket? _socket;
  LiveState _state = LiveState.disconnected;
  int _epoch = 0;
  bool _forceRefresh = false;
  final _menuSubscriptions = <String>{};

  @override
  LiveState get state => _state;
  @override
  int get epoch => _epoch;
  @override
  Stream<RealtimeEvent> get events => _events.stream;

  @override
  void start() {
    if (_socket != null) return;
    final socket = sio.io(
      url,
      sio.OptionBuilder().setTransports(['websocket']).enableForceNew().disableAutoConnect().enableReconnection().setAuthFn((callback) {
        final force = _forceRefresh;
        _forceRefresh = false;
        _token(forceRefresh: force).then((t) => callback({'token': t ?? ''}), onError: (_) => callback({'token': ''}));
      }).build(),
    );
    socket.onConnect((_) {
      _epoch++;
      _state = LiveState.connected;
      notifyListeners();
      // Public menu subscriptions are per connection; restore them.
      for (final id in _menuSubscriptions) {
        socket.emitWithAck('menu:subscribe', {'canteenId': id}, ack: (_) {});
      }
    });
    socket.onDisconnect((reason) {
      _setState(LiveState.disconnected);
      // Server-initiated disconnects are not retried automatically; token expiry is.
      if (reason == 'io server disconnect' && _forceRefresh) socket.connect();
    });
    socket.onConnectError((_) => _setState(LiveState.disconnected));
    socket.on('auth.expired', (_) => _forceRefresh = true);
    socket.onAny((event, data) {
      if (data is Map && data['data'] is Map) {
        _events.add(RealtimeEvent(event, (data['data'] as Map).cast<String, dynamic>()));
      }
    });
    _socket = socket;
    _setState(LiveState.connecting);
    socket.connect();
  }

  @override
  void stop() {
    _socket?.dispose();
    _socket = null;
    _menuSubscriptions.clear();
    _setState(LiveState.disconnected);
  }

  @override
  Future<bool> subscribeMenu(String canteenId) async {
    _menuSubscriptions.add(canteenId);
    final socket = _socket;
    if (socket == null || !socket.connected) return false;
    final completer = Completer<bool>();
    socket.emitWithAck(
      'menu:subscribe',
      {'canteenId': canteenId},
      ack: (response) {
        if (!completer.isCompleted) completer.complete(response is Map && response['ok'] == true);
      },
    );
    return completer.future.timeout(const Duration(seconds: 5), onTimeout: () => false);
  }

  void _setState(LiveState next) {
    if (_state == next) return;
    _state = next;
    notifyListeners();
  }

  @override
  void dispose() {
    stop();
    _events.close();
    super.dispose();
  }
}
