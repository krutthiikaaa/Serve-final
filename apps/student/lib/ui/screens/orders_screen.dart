import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/format.dart';
import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../services/realtime/realtime_service.dart';
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
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: const ServeHeader(title: 'Orders'),
        body: Column(
          children: [
            const TabBar(
              labelColor: ServeColors.ink,
              unselectedLabelColor: ServeColors.muted,
              indicatorColor: ServeColors.olive,
              labelStyle: TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
              tabs: [
                Tab(text: 'Active'),
                Tab(text: 'Past'),
              ],
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
    if (_loading && _orders.isEmpty) return const LoadingView(label: 'Loading orders');
    if (_error != null && _orders.isEmpty) return ErrorView(error: _error!, onRetry: _load);
    if (_orders.isEmpty) {
      return RefreshIndicator(
        color: ServeColors.olive,
        onRefresh: _load,
        child: ListView(
          children: [
            SizedBox(
              height: 420,
              child: EmptyView(
                icon: Icons.receipt_long_outlined,
                title: widget.status == 'active' ? 'No active orders' : 'No past orders yet',
                body: widget.status == 'active' ? 'Orders you place appear here until you collect them.' : null,
                action: widget.status == 'active'
                    ? FilledButton(
                        style: FilledButton.styleFrom(minimumSize: const Size(200, 52)),
                        onPressed: () => context.read<HomeTabs>().go(HomeTabs.menu),
                        child: const Text('Browse menu'),
                      )
                    : null,
              ),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      color: ServeColors.olive,
      onRefresh: _load,
      child: NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n.metrics.pixels > n.metrics.maxScrollExtent - 200) _more();
          return false;
        },
        child: ListView.separated(
          padding: const EdgeInsets.all(20),
          itemCount: _orders.length + (_cursor != null ? 1 : 0),
          separatorBuilder: (_, _) => const SizedBox(height: 12),
          itemBuilder: (context, i) {
            if (i == _orders.length) {
              return const Padding(
                padding: EdgeInsets.all(12),
                child: Center(child: CircularProgressIndicator(color: ServeColors.olive)),
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
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => openOrderDetails(context, order.id),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(order.orderNumber, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, letterSpacing: 0.5)),
                  const Spacer(),
                  OrderStatusChip(status: order.status),
                ],
              ),
              const SizedBox(height: 6),
              Text(order.canteen.name, style: const TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 2),
              Text(
                '${order.itemCount} ${order.itemCount == 1 ? 'item' : 'items'} · ${formatRupees(order.totalPaise)} · ${formatDateTime(order.createdAt)}',
                style: const TextStyle(color: ServeColors.muted),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
