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
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(color: ServeColors.oliveTint, borderRadius: BorderRadius.circular(12)),
                    child: const Icon(Icons.storefront_rounded, color: ServeColors.oliveDark),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'PICKUP',
                          style: TextStyle(color: ServeColors.muted, fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 1),
                        ),
                        Text(quote.canteen.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                        const SizedBox(height: 2),
                        const Text('Collect in person at the counter. SERVE does not deliver.', style: TextStyle(color: ServeColors.muted)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          Text('Order summary', style: theme.textTheme.titleMedium),
          const SizedBox(height: 10),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  for (final line in quote.items)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Row(
                        children: [
                          Text('${line.quantity}×', style: const TextStyle(fontWeight: FontWeight.w800)),
                          const SizedBox(width: 10),
                          Expanded(child: Text(line.itemName)),
                          Text(formatRupees(line.lineTotalPaise), style: const TextStyle(fontWeight: FontWeight.w600)),
                        ],
                      ),
                    ),
                  const Divider(),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      const Expanded(
                        child: Text('Total', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
                      ),
                      Text(formatRupees(quote.totalPaise), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 20)),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          Text('Payment', style: theme.textTheme.titleMedium),
          const SizedBox(height: 10),
          const Card(
            child: ListTile(
              leading: Icon(Icons.lock_outline_rounded, color: ServeColors.oliveDark),
              title: Text('Pay online', style: TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text('Paid before the canteen starts preparing. No cash on delivery.'),
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
