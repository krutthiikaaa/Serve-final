import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/format.dart';
import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../services/realtime/realtime_service.dart';
import '../../state/cart_controller.dart';
import '../../theme/serve_theme.dart';
import '../cart_actions.dart';
import '../live_reload.dart';
import '../navigation.dart';
import '../widgets/food_image.dart';
import '../widgets/quantity_control.dart';
import '../widgets/states.dart';

class FoodDetailsScreen extends StatefulWidget {
  const FoodDetailsScreen({super.key, required this.item, this.categoryName});
  final MenuItem item;
  final String? categoryName;

  @override
  State<FoodDetailsScreen> createState() => _FoodDetailsScreenState();
}

class _FoodDetailsScreenState extends State<FoodDetailsScreen> with WidgetsBindingObserver, LiveReload {
  late MenuItem _item = widget.item;
  Canteen? _canteen;
  String? _category;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _category = widget.categoryName;
    startLive();
    _load();
  }

  Future<void> _load() async {
    try {
      final detail = await context.read<ServeApi>().menuItem(widget.item.id);
      if (!mounted) return;
      context.read<CartController>().updateItem(detail.item);
      setState(() {
        _item = detail.item;
        _canteen = detail.canteen;
        _category = detail.category.name;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  void onReconnect() => _load();

  @override
  void onLiveEvent(RealtimeEvent event) {
    final id = event.data['itemId'] ?? (event.data['item'] as Map?)?['id'];
    if (id == _item.id || event.type == 'canteen.status_changed' || event.type == 'menu.category_updated') _load();
  }

  @override
  Widget build(BuildContext context) {
    final quantity = context.select<CartController, int>((c) => c.quantityOf(_item.id));
    final canteen = _canteen;
    final theme = Theme.of(context);
    final notFound = _error != null && _canteen == null;
    return Scaffold(
      appBar: AppBar(title: Text(_category ?? 'Item')),
      body: notFound
          ? ErrorView(error: _error!, onRetry: _load)
          : ListView(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
              children: [
                Hero(
                  tag: 'food-${_item.id}',
                  child: AspectRatio(
                    aspectRatio: 16 / 10,
                    child: LayoutBuilder(
                      builder: (context, c) => FoodImage(imageUrl: _item.imageUrl, category: _category, size: c.maxWidth, radius: 20),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                Text(_item.name, style: theme.textTheme.headlineSmall),
                const SizedBox(height: 6),
                Text('${formatRupees(_item.pricePaise)} each', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                if (_item.description != null) ...[
                  const SizedBox(height: 12),
                  Text(_item.description!, style: theme.textTheme.bodyLarge?.copyWith(color: ServeColors.muted)),
                ],
                const SizedBox(height: 20),
                if (_item.availability == Availability.unavailable)
                  const NoticeBanner(message: 'Unavailable right now. Check back soon.', icon: Icons.do_not_disturb_on_outlined)
                else if (_item.availability == Availability.inactive)
                  const NoticeBanner(message: 'This item is no longer on the menu.', icon: Icons.do_not_disturb_on_outlined)
                else if (!_item.isOrderable)
                  const NoticeBanner(message: 'This canteen is currently not accepting orders.', icon: Icons.pause_circle_outline_rounded),
                if (canteen != null) ...[
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      const Icon(Icons.storefront_rounded, size: 18, color: ServeColors.muted),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text('Pickup at ${canteen.name}', style: const TextStyle(color: ServeColors.muted)),
                      ),
                    ],
                  ),
                ],
              ],
            ),
      bottomNavigationBar: notFound
          ? null
          : SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                child: Row(
                  children: [
                    if (quantity > 0) ...[
                      QuantityControl(
                        quantity: quantity,
                        itemName: _item.name,
                        enabled: _item.isOrderable,
                        onAdd: () => addToCart(context, _item, canteenName: canteen?.name ?? ''),
                        onRemove: () => context.read<CartController>().decrement(_item.id),
                      ),
                      const SizedBox(width: 12),
                    ],
                    Expanded(
                      child: quantity == 0
                          ? FilledButton(
                              onPressed: _item.isOrderable && canteen != null
                                  ? () => addToCart(context, _item, canteenName: canteen.name)
                                  : null,
                              child: Text(_item.isOrderable ? 'Add to cart' : 'Unavailable'),
                            )
                          : FilledButton(onPressed: () => openCart(context), child: const Text('View cart')),
                    ),
                  ],
                ),
              ),
            ),
    );
  }
}
