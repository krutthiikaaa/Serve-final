import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../core/ids.dart';
import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../state/cart_controller.dart';
import '../../theme/serve_theme.dart';
import '../navigation.dart';
import '../widgets/states.dart';
import '../widgets/surface.dart';
import 'payment_screen.dart';

/// Pickup-only checkout. The order is created by the backend from the cart's
/// item ids and quantities; the total shown on the next screen is the order's.
class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key, required this.quote});
  final Quote quote;

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  /// One key per checkout attempt, reused on retries so a timeout can never
  /// create a second order.
  final String _idempotencyKey = uuidV4();
  bool _busy = false;
  String? _error;

  Future<void> _placeOrder() async {
    final cart = context.read<CartController>();
    final api = context.read<ServeApi>();
    final canteenId = cart.canteenId;
    if (canteenId == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final order = await api.placeOrder(canteenId, cart.toInputs(), idempotencyKey: _idempotencyKey);
      cart.clear();
      if (!mounted) return;
      // The cart flow is finished: Back from payment/tracking returns to the tabs.
      await Navigator.of(context)
          .pushAndRemoveUntil(serveRoute(PaymentScreen(order: order, quotedTotalPaise: widget.quote.totalPaise)), (route) => route.isFirst);
    } on CartIssuesException catch (e) {
      if (!mounted) return;
      showSnack(context, e.message);
      Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.userMessage);
    } catch (e) {
      if (mounted) setState(() => _error = errorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final quote = widget.quote;
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(ServeSpace.page, 4, ServeSpace.page, 24),
        children: [
          const _StepLabel('Pickup'),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const IconTile(icon: Icons.storefront_rounded),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(quote.canteen.name, style: theme.textTheme.titleMedium),
                        const SizedBox(height: 4),
                        Text('Collect in person at the counter. SERVE does not deliver.', style: theme.textTheme.bodySmall),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 22),
          const _StepLabel('Your order'),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  for (final line in quote.items)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            constraints: const BoxConstraints(minWidth: 30),
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(color: ServeColors.surfaceMuted, borderRadius: BorderRadius.circular(6)),
                            child: Text(
                              '${line.quantity}×',
                              textAlign: TextAlign.center,
                              style: const TextStyle(fontWeight: FontWeight.w700),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(child: Text(line.itemName, style: const TextStyle(height: 1.4))),
                          const SizedBox(width: 12),
                          Text(formatRupees(line.lineTotalPaise), style: const TextStyle(fontWeight: FontWeight.w600, height: 1.4)),
                        ],
                      ),
                    ),
                  const Divider(),
                  const SizedBox(height: 14),
                  SummaryRow(label: 'Total', value: formatRupees(quote.totalPaise), emphasis: true),
                ],
              ),
            ),
          ),
          const SizedBox(height: 22),
          const _StepLabel('Payment'),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const IconTile(icon: Icons.lock_outline_rounded),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Pay online', style: theme.textTheme.titleMedium),
                        const SizedBox(height: 4),
                        Text('Paid before the canteen starts preparing. No cash on delivery.', style: theme.textTheme.bodySmall),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 16),
            NoticeBanner(message: _error!, danger: true, icon: Icons.error_outline_rounded),
          ],
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
          child: FilledButton(
            onPressed: _busy ? null : _placeOrder,
            child: _busy
                ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: ServeColors.white))
                : const Text('Place order'),
          ),
        ),
      ),
    );
  }
}

class _StepLabel extends StatelessWidget {
  const _StepLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(left: 2, bottom: 8),
    child: Semantics(
      header: true,
      child: Text(text.toUpperCase(), style: Theme.of(context).textTheme.labelSmall?.copyWith(color: ServeColors.muted)),
    ),
  );
}
