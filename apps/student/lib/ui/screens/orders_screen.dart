import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/format.dart';
import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../services/realtime/realtime_service.dart';
import '../../theme/serve_layout.dart';
import '../../theme/serve_theme.dart';
import '../live_reload.dart';
import '../navigation.dart';
import '../widgets/order_status.dart';
import '../widgets/serve_header.dart';
import '../widgets/states.dart';

/// Order history: Active and Past, paginated.
class OrdersScreen extends StatelessWidget {
  const OrdersScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final padding = ServeLayout.pagePadding(width);
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: const ServeHeader(title: 'Orders'),
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: EdgeInsets.fromLTRB(padding, 8, padding, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('My Orders', style: Theme.of(context).textTheme.headlineMedium),
                      const SizedBox(height: 4),
                      Text(
                        'Track your orders and revisit your previous purchases.',
                        style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: ServeColors.muted),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: EdgeInsets.fromLTRB(padding, 16, padding, 8),
                  child: Container(
                    height: 48,
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(color: ServeColors.surfaceMuted, borderRadius: BorderRadius.circular(14)),
                    child: TabBar(
                      splashBorderRadius: BorderRadius.circular(10),
                      indicatorSize: TabBarIndicatorSize.tab,
                      dividerColor: Colors.transparent,
                      indicator: BoxDecoration(color: ServeColors.oliveStrong, borderRadius: BorderRadius.circular(10)),
                      labelColor: ServeColors.white,
                      unselectedLabelColor: ServeColors.muted,
                      labelStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
                      unselectedLabelStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                      tabs: const [
                        Tab(text: 'Active'),
                        Tab(text: 'Past'),
                      ],
                    ),
                  ),
                ),
                const Expanded(
                  child: TabBarView(
                    children: [
                      _OrderList(status: 'active'),
                      _OrderList(status: 'past'),
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

class _OrderList extends StatefulWidget {
  const _OrderList({required this.status});
  final String status;

  @override
  State<_OrderList> createState() => _OrderListState();
}

class _OrderListState extends State<_OrderList> with WidgetsBindingObserver, LiveReload, AutomaticKeepAliveClientMixin {
  final _orders = <StudentOrder>[];
  String? _cursor;
  bool _loading = true;
  bool _loadingMore = false;
  Object? _error;
  int _generation = 0;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    startLive();
    _load();
  }

  Future<void> _load() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await context.read<ServeApi>().orders(status: widget.status);
      if (!mounted || generation != _generation) return;
      setState(() {
        _orders
          ..clear()
          ..addAll(page.items);
        _cursor = page.nextCursor;
      });
    } catch (e) {
      if (mounted && generation == _generation) setState(() => _error = e);
    } finally {
      if (mounted && generation == _generation) setState(() => _loading = false);
    }
  }

  Future<void> _more() async {
    if (_cursor == null || _loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final page = await context.read<ServeApi>().orders(status: widget.status, cursor: _cursor);
      if (!mounted) return;
      setState(() {
        _orders.addAll(page.items.where((o) => _orders.every((e) => e.id != o.id)));
        _cursor = page.nextCursor;
      });
    } catch (e) {
      if (mounted) showSnack(context, 'Could not load more orders.');
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  @override
  void onReconnect() => _load();

  @override
  void onLiveEvent(RealtimeEvent event) {
    if (event.type.startsWith('order.')) _load();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final width = MediaQuery.sizeOf(context).width;
    final padding = ServeLayout.pagePadding(width);
    if (_loading && _orders.isEmpty) return const SkeletonList(label: 'Loading orders', count: 3, header: false);
    if (_error != null && _orders.isEmpty) return ErrorView(error: _error!, onRetry: _load);
    if (_orders.isEmpty) {
      return RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          children: [
            SizedBox(
              height: 420,
              child: EmptyView(
                icon: Icons.receipt_long_outlined,
                title: widget.status == 'active' ? 'No active orders' : 'No previous orders yet',
                body: widget.status == 'active' ? 'Your current orders will appear here.' : 'Your completed orders will appear here.',
                action: FilledButton(
                  style: FilledButton.styleFrom(minimumSize: const Size(200, 52)),
                  onPressed: () => context.read<HomeTabs>().go(HomeTabs.menu),
                  child: const Text('View Menu'),
                ),
              ),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n.metrics.pixels > n.metrics.maxScrollExtent - 200) _more();
          return false;
        },
        child: ListView.separated(
          padding: EdgeInsets.fromLTRB(padding, 8, padding, 28),
          itemCount: _orders.length + (_cursor != null ? 1 : 0),
          separatorBuilder: (_, _) => const SizedBox(height: 12),
          itemBuilder: (context, i) {
            if (i == _orders.length) {
              return const Padding(
                padding: EdgeInsets.all(12),
                child: Center(child: CircularProgressIndicator()),
              );
            }
            return OrderCard(order: _orders[i]);
          },
        ),
      ),
    );
  }
}

class OrderCard extends StatelessWidget {
  const OrderCard({super.key, required this.order});
  final StudentOrder order;

  @override
  Widget build(BuildContext context) {
    final ready = order.status == OrderStatus.ready;
    final cancelled = order.status == OrderStatus.cancelled;
    final collected = order.status == OrderStatus.collected;
    final surface = ready
        ? ServeColors.oliveTint
        : cancelled
        ? ServeColors.dangerTint
        : ServeColors.white;
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(ServeSpace.radiusCard),
        boxShadow: [BoxShadow(color: ServeColors.ink.withValues(alpha: 0.05), blurRadius: 12, offset: const Offset(0, 4))],
      ),
      child: Material(
        color: surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(ServeSpace.radiusCard),
          side: BorderSide(
            color: ready
                ? ServeColors.oliveStrong
                : cancelled
                ? ServeColors.danger.withValues(alpha: 0.35)
                : ServeColors.line,
            width: ready ? 1.5 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => openOrderDetails(context, order.id),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(order.orderNumber, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: 0.4)),
                          const SizedBox(height: 2),
                          Text(order.canteen.name, style: Theme.of(context).textTheme.titleSmall),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Flexible(
                      child: Align(
                        alignment: Alignment.centerRight,
                        child: OrderStatusChip(status: order.status),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _MetaChip(icon: Icons.restaurant_menu_rounded, label: '${order.itemCount} ${order.itemCount == 1 ? 'item' : 'items'}'),
                    _MetaChip(icon: Icons.payments_outlined, label: formatRupees(order.totalPaise)),
                    _MetaChip(icon: Icons.schedule_rounded, label: formatDateTime(order.createdAt)),
                  ],
                ),
                if (order.status.isActive) ...[const SizedBox(height: 14), OrderStageStrip(status: order.status)],
                if (collected || cancelled) ...[
                  const SizedBox(height: 10),
                  Text(
                    collected ? 'This order was collected.' : 'This order was cancelled.',
                    style: TextStyle(color: cancelled ? ServeColors.danger : ServeColors.muted, fontWeight: FontWeight.w600, fontSize: 13),
                  ),
                ],
                const SizedBox(height: 4),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(onPressed: () => openOrderDetails(context, order.id), child: const Text('View Details')),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MetaChip extends StatelessWidget {
  const _MetaChip({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: ServeColors.white.withValues(alpha: 0.72), borderRadius: BorderRadius.circular(20)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: ServeColors.oliveInk),
          const SizedBox(width: 5),
          Text(
            label,
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: ServeColors.ink),
          ),
        ],
      ),
    );
  }
}

/// Compact Placed → Preparing → Ready → Collected strip from the real status.
class OrderStageStrip extends StatelessWidget {
  const OrderStageStrip({super.key, required this.status});
  final OrderStatus status;

  static const _labels = ['Placed', 'Preparing', 'Ready', 'Collected'];

  static int _index(OrderStatus status) => switch (status) {
    OrderStatus.placed || OrderStatus.paymentConfirmed => 0,
    OrderStatus.preparing => 1,
    OrderStatus.ready => 2,
    OrderStatus.collected => 3,
    OrderStatus.cancelled => -1,
  };

  @override
  Widget build(BuildContext context) {
    final current = _index(status);
    if (current < 0) return const SizedBox.shrink();
    return Column(
      children: [
        Row(
          children: [
            for (var i = 0; i < _labels.length; i++) ...[
              if (i > 0) const SizedBox(width: 4),
              Expanded(
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 280),
                  height: 5,
                  decoration: BoxDecoration(
                    color: i <= current ? ServeColors.olive : ServeColors.line,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            for (var i = 0; i < _labels.length; i++)
              Expanded(
                child: Text(
                  _labels[i],
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: i == current ? FontWeight.w800 : FontWeight.w600,
                    color: i <= current ? ServeColors.oliveInk : ServeColors.muted,
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }
}
