import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/format.dart';
import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../state/notifications_controller.dart';
import '../../theme/serve_theme.dart';
import '../live_reload.dart';
import '../navigation.dart';
import '../widgets/states.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> with WidgetsBindingObserver, LiveReload {
  final _items = <AppNotification>[];
  String? _cursor;
  bool _loading = true;
  Object? _error;
  late final NotificationsController _controller;

  @override
  void initState() {
    super.initState();
    _controller = context.read<NotificationsController>()..addListener(_onLatest);
    startLive();
    _load();
  }

  @override
  void dispose() {
    _controller.removeListener(_onLatest);
    super.dispose();
  }

  void _onLatest() {
    final latest = _controller.latest;
    if (latest != null && _items.every((n) => n.id != latest.id)) setState(() => _items.insert(0, latest));
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await context.read<ServeApi>().notifications();
      if (!mounted) return;
      setState(() {
        _items
          ..clear()
          ..addAll(page.items);
        _cursor = page.nextCursor;
      });
      _controller.setUnread(page.unreadCount ?? 0);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _more() async {
    if (_cursor == null) return;
    final page = await context.read<ServeApi>().notifications(cursor: _cursor);
    if (mounted) {
      setState(() {
        _items.addAll(page.items);
        _cursor = page.nextCursor;
      });
    }
  }

  @override
  void onReconnect() => _load();

  Future<void> _open(AppNotification n) async {
    if (!n.isRead) {
      try {
        await context.read<ServeApi>().markNotificationRead(n.id);
        if (!mounted) return;
        setState(() {
          final i = _items.indexWhere((e) => e.id == n.id);
          if (i >= 0) _items[i] = n.markedRead(DateTime.now());
        });
        _controller.setUnread(_controller.unreadCount - 1);
      } catch (_) {
        // Opening still works; the badge catches up on the next refresh.
      }
    }
    if (n.orderId != null && mounted) openOrderDetails(context, n.orderId!);
  }

  Future<void> _markAll() async {
    try {
      await context.read<ServeApi>().markAllNotificationsRead();
      if (!mounted) return;
      final now = DateTime.now();
      setState(() {
        for (var i = 0; i < _items.length; i++) {
          _items[i] = _items[i].markedRead(now);
        }
      });
      _controller.setUnread(0);
      showSnack(context, 'All notifications marked as read');
    } catch (e) {
      if (mounted) showSnack(context, 'Could not mark notifications as read.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasUnread = _items.any((n) => !n.isRead);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [TextButton(onPressed: hasUnread ? _markAll : null, child: const Text('Mark all read'))],
      ),
      body: _loading && _items.isEmpty
          ? const LoadingView(label: 'Loading notifications')
          : _error != null && _items.isEmpty
          ? ErrorView(error: _error!, onRetry: _load)
          : _items.isEmpty
          ? const EmptyView(icon: Icons.notifications_none_rounded, title: "You're all caught up", body: 'Order updates will appear here.')
          : RefreshIndicator(
              color: ServeColors.olive,
              onRefresh: _load,
              child: ListView.separated(
                itemCount: _items.length + (_cursor != null ? 1 : 0),
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (context, i) {
                  if (i == _items.length) {
                    return Padding(
                      padding: const EdgeInsets.all(12),
                      child: Center(
                        child: TextButton(onPressed: _more, child: const Text('Load more')),
                      ),
                    );
                  }
                  final n = _items[i];
                  return Semantics(
                    label: n.isRead ? null : 'Unread',
                    child: ListTile(
                      onTap: () => _open(n),
                      tileColor: n.isRead ? null : ServeColors.white,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
                      leading: Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: n.type == 'ORDER_READY' ? ServeColors.olive : ServeColors.oliveTint,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          n.type == 'ORDER_READY' ? Icons.shopping_bag_rounded : Icons.notifications_rounded,
                          color: n.type == 'ORDER_READY' ? ServeColors.white : ServeColors.oliveDark,
                          size: 20,
                        ),
                      ),
                      title: Text(n.title, style: TextStyle(fontWeight: n.isRead ? FontWeight.w600 : FontWeight.w800)),
                      subtitle: Text(n.message),
                      trailing: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(timeAgo(n.createdAt), style: const TextStyle(color: ServeColors.muted, fontSize: 12)),
                          if (!n.isRead) ...[
                            const SizedBox(height: 6),
                            Container(
                              width: 8,
                              height: 8,
                              decoration: const BoxDecoration(color: ServeColors.orange, shape: BoxShape.circle),
                            ),
                          ],
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
    );
  }
}
