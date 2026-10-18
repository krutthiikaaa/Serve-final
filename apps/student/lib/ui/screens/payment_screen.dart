import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../theme/serve_theme.dart';
import '../navigation.dart';
import '../widgets/states.dart';
import 'order_confirmation_screen.dart';

/// Payment for a PLACED order. In development and demo deployments this drives
/// the backend's mock gateway (initiate → mock-complete); Razorpay Checkout will
/// replace only the gateway step (initiate → Razorpay → verify).
class PaymentScreen extends StatefulWidget {
  const PaymentScreen({super.key, required this.order, this.quotedTotalPaise});
  final StudentOrder order;
  final int? quotedTotalPaise;

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> {
  bool _busy = false;
  String? _error;

  Future<void> _pay({required bool succeed}) async {
    final api = context.read<ServeApi>();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final session = await api.initiatePayment(widget.order.id);
      // The amount always comes from the server-side order.
      assert(session.amountPaise == widget.order.totalPaise);
      final paid = await api.completeMockPayment(widget.order.id, succeed: succeed);
      if (!mounted) return;
      await Navigator.of(context).pushReplacement(serveRoute(OrderConfirmationScreen(order: paid)));
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'PAYMENT_FAILED') {
        setState(() => _error = 'Payment failed. No money was taken. You can try again.');
      } else if (e.code == 'ALREADY_PAID') {
        final order = await api.order(widget.order.id);
        if (mounted) await Navigator.of(context).pushReplacement(serveRoute(OrderConfirmationScreen(order: order)));
      } else {
        setState(() => _error = e.userMessage);
      }
    } catch (e) {
      if (mounted) setState(() => _error = errorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final order = widget.order;
    final changed = widget.quotedTotalPaise != null && widget.quotedTotalPaise != order.totalPaise;
    return Scaffold(
      appBar: AppBar(title: const Text('Payment')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(ServeSpace.page, 4, ServeSpace.page, 24),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 26),
              child: Column(
                children: [
                  Text('Amount to pay', style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: ServeColors.muted)),
                  const SizedBox(height: 6),
                  Text(
                    formatRupees(order.totalPaise),
                    style: const TextStyle(fontSize: 42, fontWeight: FontWeight.w800, letterSpacing: -0.5),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Order ${order.orderNumber} · ${order.canteen.name}',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: ServeColors.muted, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ),
          ),
          if (changed) ...[
            const SizedBox(height: 14),
            const NoticeBanner(message: 'A price changed since your cart was quoted. This is the confirmed total.'),
          ],
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: ServeColors.oliveTint, borderRadius: BorderRadius.circular(ServeSpace.radiusCard)),
            child: const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.science_outlined, color: ServeColors.oliveInk),
                SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Test payment',
                        style: TextStyle(fontWeight: FontWeight.w700, color: ServeColors.oliveInk),
                      ),
                      SizedBox(height: 2),
                      Text(
                        'Demo mode: no real money is charged. Online payments will use Razorpay.',
                        style: TextStyle(color: ServeColors.oliveInk, height: 1.35),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 14),
            NoticeBanner(message: _error!, danger: true, icon: Icons.error_outline_rounded),
          ],
          const SizedBox(height: 18),
          Center(
            child: TextButton(onPressed: _busy ? null : () => _pay(succeed: false), child: const Text('Simulate a failed payment')),
          ),
          Center(
            child: TextButton(
              onPressed: _busy ? null : () => backToTab(context, HomeTabs.orders),
              child: const Text('Pay later from Orders'),
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
          child: FilledButton(
            onPressed: _busy ? null : () => _pay(succeed: true),
            child: _busy
                ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: ServeColors.white))
                : Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.lock_rounded, size: 18),
                      const SizedBox(width: 8),
                      Text('Pay ${formatRupees(order.totalPaise)}'),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}
