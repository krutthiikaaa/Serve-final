import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../services/realtime/realtime_service.dart';
import '../../theme/serve_theme.dart';
import '../live_reload.dart';
import '../navigation.dart';
import '../widgets/order_status.dart';
import '../widgets/states.dart';
import '../widgets/surface.dart';
import 'order_tracking_screen.dart';
import 'payment_screen.dart';

class OrderDetailsScreen extends StatefulWidget {
  const OrderDetailsScreen({super.key, required this.orderId});
  final String orderId;

  @override
  State<OrderDetailsScreen> createState() => _OrderDetailsScreenState();
}

class _OrderDetailsScreenState extends State<OrderDetailsScreen> with WidgetsBindingObserver, LiveReload {
  StudentOrder? _order;
  Object? _error;
  bool _cancelling = false;

  @override
  Duration? get livePollInterval => const Duration(seconds: 15);

  @override
  void initState() {
    super.initState();
    startLive();
    _load();
  }

  Future<void> _load() async {
    try {
      final order = await context.read<ServeApi>().order(widget.orderId);
      if (mounted) {
        setState(() {
          _order = order;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  void onReconnect() => _load();

  @override
  void onLiveEvent(RealtimeEvent event) {
    if (!event.type.startsWith('order.') || event.orderId != widget.orderId) return;
    final raw = event.data['order'];
    if (raw is Map) setState(() => _order = StudentOrder.fromJson(raw.cast<String, dynamic>()));
  }

  Future<void> _cancel() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cancel this order?'),
        content: const Text('It has not been paid yet, so nothing will be charged.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Keep order')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: ServeColors.danger, minimumSize: const Size(0, 44)),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Cancel order'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _cancelling = true);
    try {
      final order = await context.read<ServeApi>().cancelOrder(widget.orderId);
      if (mounted) setState(() => _order = order);
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e));
      await _load();
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final order = _order;
    return Scaffold(
      appBar: AppBar(title: Text(order == null ? 'Order' : 'Order ${order.orderNumber}')),
      body: order == null
          ? (_error != null ? ErrorView(error: _error!, onRetry: _load) : const LoadingView(label: 'Loading order'))
          : ListView(
              padding: const EdgeInsets.fromLTRB(ServeSpace.page, 4, ServeSpace.page, 24),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(order.orderNumber, style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800, letterSpacing: 1)),
                    ),
                    OrderStatusChip(status: order.status),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  [
                    order.canteen.name,
                    formatServicePeriod(order.servicePeriod),
                    formatDateTime(order.createdAt),
                  ].join(' · '),
                  style: const TextStyle(color: ServeColors.muted),
                ),
                const SizedBox(height: 4),
                Text('Pickup token ${order.pickupToken}', style: const TextStyle(fontWeight: FontWeight.w700)),
                if (order.status == OrderStatus.cancelled) ...[
                  const SizedBox(height: 14),
                  NoticeBanner(danger: true, icon: Icons.info_outline_rounded, message: cancellationMessage(order)),
                ],
                const SizedBox(height: 18),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        for (final line in order.items)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('${line.quantity}×', style: const TextStyle(fontWeight: FontWeight.w700, height: 1.4)),
                                const SizedBox(width: 10),
                                Expanded(child: Text(line.itemName, style: const TextStyle(height: 1.4))),
                                const SizedBox(width: 12),
                                Text(formatRupees(line.lineTotalPaise), style: const TextStyle(height: 1.4)),
                              ],
                            ),
                          ),
                        const Divider(),
                        const SizedBox(height: 14),
                        SummaryRow(label: 'Total', value: formatRupees(order.totalPaise), emphasis: true),
                        if (order.payment != null) ...[
                          const SizedBox(height: 8),
                          SummaryRow(label: 'Payment', value: _paymentLabel(order.payment!)),
                          if (order.payment!.provider.isNotEmpty) ...[
                            const SizedBox(height: 8),
                            SummaryRow(label: 'Method', value: order.payment!.provider),
                          ],
                        ],
                      ],
                    ),
                  ),
                ),
                if (order.hasReceipt) ...[
                  const SizedBox(height: 16),
                  _ReceiptCard(order: order),
                ],
                const SizedBox(height: 16),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(18, 20, 18, 0),
                    child: OrderTimeline(order: order),
                  ),
                ),
                const SizedBox(height: 20),
                if (order.status == OrderStatus.placed) ...[
                  FilledButton(
                    onPressed: () => Navigator.of(context).push(serveRoute(PaymentScreen(order: order))).then((_) => _load()),
                    child: Text('Complete payment · ${formatRupees(order.totalPaise)}'),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton(onPressed: _cancelling ? null : _cancel, child: const Text('Cancel order')),
                ] else if (order.status.isActive)
                  FilledButton(onPressed: () => openTracking(context, order.id), child: const Text('Track order')),
              ],
            ),
    );
  }

  static String _paymentLabel(Payment p) {
    if (p.isSimulated && p.isSuccess) return 'DEMO · simulated';
    return switch (p.status) {
      'SUCCESS' => p.failureReason != null ? 'Paid · refund pending' : 'Paid',
      'REFUNDED' => 'Refunded',
      'FAILED' => 'Failed · payment not received',
      _ => 'PAYMENT PENDING',
    };
  }
}

class _ReceiptCard extends StatelessWidget {
  const _ReceiptCard({required this.order});
  final StudentOrder order;

  @override
  Widget build(BuildContext context) {
    final demo = order.payment?.isSimulated == true;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Receipt ${order.receiptNumber}', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text('Pickup token ${order.pickupToken}', style: const TextStyle(fontWeight: FontWeight.w700)),
            if (demo) ...[
              const SizedBox(height: 10),
              const NoticeBanner(
                message: 'DEMO TRANSACTION — NO REAL PAYMENT',
                icon: Icons.science_outlined,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
