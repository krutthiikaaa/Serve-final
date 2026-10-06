import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../state/cart_controller.dart';
import '../../theme/serve_theme.dart';
import '../navigation.dart';
import '../widgets/quantity_control.dart';
import '../widgets/states.dart';
import 'checkout_screen.dart';

/// The cart is re-quoted by the backend on every change; prices and the total
/// shown here come from `POST /api/cart/quote`, never from the device.
class CartScreen extends StatefulWidget {
  const CartScreen({super.key});

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  Quote? _quote;
  Object? _error;
  Map<String, String> _issues = {};
  bool _quoting = false;
  Timer? _debounce;
  int _generation = 0;
  late final CartController _cart;

  @override
  void initState() {
    super.initState();
    _cart = context.read<CartController>()..addListener(_onCartChanged);
    _requote();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _cart.removeListener(_onCartChanged);
    super.dispose();
  }

  void _onCartChanged() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), _requote);
    setState(() {});
  }

  Future<void> _requote() async {
    final canteenId = _cart.canteenId;
    if (canteenId == null) {
      setState(() => _quote = null);
      return;
    }
    final generation = ++_generation;
    setState(() => _quoting = true);
    try {
      final quote = await context.read<ServeApi>().quote(canteenId, _cart.toInputs());
      if (!mounted || generation != _generation) return;
      setState(() {
        _quote = quote;
        _issues = {};
        _error = null;
      });
    } on CartIssuesException catch (e) {
      if (!mounted || generation != _generation) return;
      final removed = <String>[];
      final soldOut = <String, String>{};
      for (final issue in e.issues) {
        if (issue.reason == 'UNAVAILABLE') {
          soldOut[issue.menuItemId] = 'Sold out right now';
        } else {
          removed.add(issue.menuItemId);
        }
      }
      setState(() {
        _issues = soldOut;
        _quote = null;
        _error = null;
      });
      if (removed.isNotEmpty) {
        for (final id in removed) {
          _cart.remove(id);
        }
        showSnack(context, 'Some items are no longer on the menu and were removed.');
      }
    } catch (e) {
      if (mounted && generation == _generation) setState(() => _error = e);
    } finally {
      if (mounted && generation == _generation) setState(() => _quoting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartController>();
    if (cart.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('Your cart')),
        body: EmptyView(
          icon: Icons.shopping_bag_outlined,
          title: 'Your cart is empty',
          body: 'Add something tasty from the menu.',
          action: FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(200, 52)),
            onPressed: () => backToTab(context, HomeTabs.menu),
            child: const Text('Browse menu'),
          ),
        ),
      );
    }
    final quote = _quote;
    final lineFor = {for (final l in quote?.items ?? const <QuoteLine>[]) l.menuItemId: l};
    final paused = _error is ApiException && (_error! as ApiException).code == 'CANTEEN_NOT_ACCEPTING_ORDERS';
    final canCheckout = quote != null && !_quoting && _issues.isEmpty && _error == null;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Your cart'),
        actions: [TextButton(onPressed: cart.clear, child: const Text('Clear'))],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
        children: [
          Row(
            children: [
              const Icon(Icons.storefront_rounded, size: 20, color: ServeColors.oliveDark),
              const SizedBox(width: 8),
              Expanded(
                child: Text(cart.canteenName ?? '', style: const TextStyle(fontWeight: FontWeight.w700)),
              ),
            ],
          ),
          const SizedBox(height: 14),
          if (paused) ...[
            const NoticeBanner(message: 'This canteen is currently not accepting orders.', icon: Icons.pause_circle_outline_rounded),
            const SizedBox(height: 14),
          ] else if (_error != null) ...[
            NoticeBanner(message: errorMessage(_error!), danger: true, icon: Icons.error_outline_rounded),
            const SizedBox(height: 14),
          ],
          Card(
            child: Column(
              children: [
                for (var i = 0; i < cart.lines.length; i++) ...[
                  if (i > 0) const Divider(indent: 16, endIndent: 16),
                  _CartLineRow(line: cart.lines[i], quoted: lineFor[cart.lines[i].item.id], issue: _issues[cart.lines[i].item.id]),
                ],
              ],
            ),
          ),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  const Expanded(
                    child: Text('Total', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                  ),
                  if (_quoting)
                    const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: ServeColors.olive))
                  else
                    Text(
                      quote == null ? '—' : formatRupees(quote.totalPaise),
                      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Prices are confirmed by the canteen when you place the order.',
            style: TextStyle(color: ServeColors.muted, fontSize: 13),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
          child: FilledButton(
            onPressed: canCheckout ? () => Navigator.of(context).push(serveRoute(CheckoutScreen(quote: quote))) : null,
            child: Text(_issues.isNotEmpty ? 'Remove sold-out items to continue' : 'Checkout'),
          ),
        ),
      ),
    );
  }
}

class _CartLineRow extends StatelessWidget {
  const _CartLineRow({required this.line, required this.quoted, required this.issue});
  final CartLine line;
  final QuoteLine? quoted;
  final String? issue;

  @override
  Widget build(BuildContext context) {
    final cart = context.read<CartController>();
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(quoted?.itemName ?? line.item.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                const SizedBox(height: 4),
                if (issue != null)
                  Text(
                    issue!,
                    style: const TextStyle(color: ServeColors.danger, fontWeight: FontWeight.w600),
                  )
                else if (quoted != null)
                  Text(
                    '${formatRupees(quoted!.unitPricePaise)} × ${quoted!.quantity}  =  ${formatRupees(quoted!.lineTotalPaise)}',
                    style: const TextStyle(color: ServeColors.muted),
                  ),
              ],
            ),
          ),
          if (issue != null)
            TextButton(onPressed: () => cart.remove(line.item.id), child: const Text('Remove'))
          else
            QuantityControl(
              quantity: line.quantity,
              itemName: line.item.name,
              enabled: line.quantity < CartController.maxQuantity,
              onAdd: () => cart.add(line.item, canteenName: cart.canteenName ?? ''),
              onRemove: () => cart.decrement(line.item.id),
            ),
        ],
      ),
    );
  }
}
