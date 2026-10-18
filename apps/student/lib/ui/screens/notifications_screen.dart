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
          ? const SkeletonList(label: 'Loading notifications', count: 5, header: false)
          : _error != null && _items.isEmpty
          ? ErrorView(error: _error!, onRetry: _load)
          : _items.isEmpty
          ? const EmptyView(icon: Icons.notifications_none_rounded, title: "You're all caught up", body: 'Order updates will appear here.')
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView.separated(
                padding: const EdgeInsets.fromLTRB(ServeSpace.page, 4, ServeSpace.page, 24),
                itemCount: _items.length + (_cursor != null ? 1 : 0),
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, i) {
                  if (i == _items.length) {
                    return Center(
                      child: TextButton(onPressed: _more, child: const Text('Load more')),
                    );
                  }
                  return _NotificationTile(notification: _items[i], onTap: () => _open(_items[i]));
                },
              ),
            ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({required this.notification, required this.onTap});
  final AppNotification notification;
  final VoidCallback onTap;

  static (IconData, Color, Color) _look(String type) => switch (type) {
    'ORDER_READY' => (Icons.shopping_bag_rounded, ServeColors.white, ServeColors.oliveStrong),
    'ORDER_PREPARING' => (Icons.local_fire_department_rounded, const Color(0xFF6E5100), const Color(0xFFFFF4D6)),
    'PAYMENT_CONFIRMED' || 'ORDER_PLACED' => (Icons.receipt_long_rounded, ServeColors.orangeInk, ServeColors.orangeTint),
    'ORDER_COLLECTED' => (Icons.check_circle_rounded, ServeColors.muted, ServeColors.surfaceMuted),
    'ORDER_CANCELLED' => (Icons.cancel_rounded, ServeColors.danger, ServeColors.dangerTint),
    _ => (Icons.notifications_rounded, ServeColors.oliveInk, ServeColors.oliveTint),
  };

  @override
  Widget build(BuildContext context) {
    final n = notification;
    final (icon, fg, bg) = _look(n.type);
    return Semantics(
      label: n.isRead ? null : 'Unread',
      child: Material(
        color: n.isRead ? ServeColors.paper : ServeColors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(ServeSpace.radiusCard),
          side: BorderSide(color: n.isRead ? ServeColors.line : ServeColors.oliveTint, width: n.isRead ? 1 : 1.5),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
                  child: Icon(icon, color: fg, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(n.title, style: TextStyle(fontWeight: n.isRead ? FontWeight.w600 : FontWeight.w700, height: 1.3)),
                          ),
                          const SizedBox(width: 8),
                          Text(timeAgo(n.createdAt), style: Theme.of(context).textTheme.bodySmall),
                          if (!n.isRead) ...[
                            const SizedBox(width: 6),
                            Padding(
                              padding: const EdgeInsets.only(top: 5),
                              child: Container(
                                width: 8,
                                height: 8,
                                decoration: const BoxDecoration(color: ServeColors.orangeStrong, shape: BoxShape.circle),
                              ),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(n.message, style: const TextStyle(color: ServeColors.muted, height: 1.35)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
