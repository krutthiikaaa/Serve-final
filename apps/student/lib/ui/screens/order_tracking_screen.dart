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
import '../widgets/states.dart';

/// Live order tracking. Order events replace the order directly; after a
/// reconnect or when the app returns to the foreground the order is refetched.
class OrderTrackingScreen extends StatefulWidget {
  const OrderTrackingScreen({super.key, required this.orderId});
  final String orderId;

  @override
  State<OrderTrackingScreen> createState() => _OrderTrackingScreenState();
}

class _OrderTrackingScreenState extends State<OrderTrackingScreen> with WidgetsBindingObserver, LiveReload {
  StudentOrder? _order;
  Object? _error;

  @override
  void initState() {
    super.initState();
    startLive();
    _load();
  }

  Future<void> _load() async {
    try {
      final order = await context.read<ServeApi>().order(widget.orderId);
      if (mounted) setState(() => _apply(order));
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _apply(StudentOrder order) {
    final current = _order;
    if (current != null && current.updatedAt.isAfter(order.updatedAt)) return;
    _order = order;
    _error = null;
  }

  @override
  void onReconnect() => _load();

  @override
  void onLiveEvent(RealtimeEvent event) {
    if (!event.type.startsWith('order.') || event.orderId != widget.orderId) return;
    final raw = event.data['order'];
    if (raw is Map) setState(() => _apply(StudentOrder.fromJson(raw.cast<String, dynamic>())));
  }

  @override
  Widget build(BuildContext context) {
    final order = _order;
    final live = context.select<RealtimeService, LiveState>((r) => r.state);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Track order'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Row(
              children: [
                Icon(Icons.circle, size: 9, color: live == LiveState.connected ? ServeColors.olive : ServeColors.orange),
                const SizedBox(width: 6),
                Text(
                  live == LiveState.connected ? 'Live' : 'Reconnecting…',
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ),
        ],
      ),
      body: order == null
          ? (_error != null ? ErrorView(error: _error!, onRetry: _load) : const LoadingView(label: 'Loading order'))
          : RefreshIndicator(
              color: ServeColors.olive,
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
                children: [
                  _StatusHero(order: order),
                  const SizedBox(height: 20),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
                      child: OrderTimeline(order: order),
                    ),
                  ),
                  if (order.status == OrderStatus.cancelled) ...[
                    const SizedBox(height: 16),
                    NoticeBanner(danger: true, icon: Icons.info_outline_rounded, message: cancellationMessage(order)),
                  ],
                  const SizedBox(height: 16),
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.storefront_rounded, color: ServeColors.oliveDark),
                      title: Text(order.canteen.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text('${order.itemCount} ${order.itemCount == 1 ? 'item' : 'items'} · ${formatRupees(order.totalPaise)}'),
                      trailing: const Icon(Icons.chevron_right_rounded),
                      onTap: () => openOrderDetails(context, order.id),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

String cancellationMessage(StudentOrder order) {
  final parts = [
    if (order.cancelReason != null) 'Reason: ${order.cancelReason}.',
    if (order.payment?.status == 'REFUNDED') 'Your payment has been refunded.',
    if (order.payment?.status == 'SUCCESS' && order.payment?.failureReason != null) 'Your refund is being processed.',
  ];
  return parts.isEmpty ? 'This order was cancelled.' : parts.join(' ');
}

class _StatusHero extends StatelessWidget {
  const _StatusHero({required this.order});
  final StudentOrder order;

  @override
  Widget build(BuildContext context) {
    final ready = order.status == OrderStatus.ready;
    final style = orderStatusStyle(order.status);
    return AnimatedContainer(
      duration: const Duration(milliseconds: 350),
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: ready ? ServeColors.olive : ServeColors.white,
        borderRadius: BorderRadius.circular(20),
        border: ready ? null : Border.all(color: ServeColors.line),
      ),
      child: Column(
        children: [
          Icon(style.icon, size: 36, color: ready ? ServeColors.white : style.fg),
          const SizedBox(height: 10),
          Semantics(
            liveRegion: true,
            child: Text(
              orderStatusHeadline(order.status),
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: ready ? ServeColors.white : ServeColors.ink),
            ),
          ),
          const SizedBox(height: 14),
          Text(
            'ORDER NUMBER',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.2,
              color: ready ? ServeColors.white.withValues(alpha: 0.85) : ServeColors.muted,
            ),
          ),
          Text(
            order.orderNumber,
            style: TextStyle(
              fontSize: ready ? 56 : 40,
              fontWeight: FontWeight.w900,
              letterSpacing: 2,
              color: ready ? ServeColors.white : ServeColors.ink,
            ),
          ),
          if (ready) ...[
            const SizedBox(height: 6),
            Text(
              'Show this number at the ${order.canteen.name} counter.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: ServeColors.white, fontWeight: FontWeight.w600),
            ),
          ],
        ],
      ),
    );
  }
}
