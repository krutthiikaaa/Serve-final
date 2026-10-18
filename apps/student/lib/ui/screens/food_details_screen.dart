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
import '../widgets/surface.dart';

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
              padding: const EdgeInsets.fromLTRB(ServeSpace.page, 0, ServeSpace.page, 24),
              children: [
                Hero(
                  tag: 'food-${_item.id}',
                  child: AspectRatio(
                    aspectRatio: 4 / 3,
                    child: LayoutBuilder(
                      builder: (context, c) => FoodImage(imageUrl: _item.imageUrl, category: _category, size: c.maxWidth, radius: 20),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: Text(_item.name, style: theme.textTheme.headlineSmall)),
                    const SizedBox(width: 12),
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(formatRupees(_item.pricePaise), style: theme.textTheme.headlineSmall),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                _AvailabilityPill(item: _item),
                if (_item.description != null) ...[
                  const SizedBox(height: 16),
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
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Row(
                        children: [
                          const IconTile(icon: Icons.storefront_rounded, size: 40),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Pickup at ${canteen.name}', style: theme.textTheme.titleSmall),
                                const SizedBox(height: 2),
                                Text('Collect at the counter when it is ready.', style: theme.textTheme.bodySmall),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
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

class _AvailabilityPill extends StatelessWidget {
  const _AvailabilityPill({required this.item});
  final MenuItem item;

  @override
  Widget build(BuildContext context) {
    if (item.isOrderable) {
      return const Align(
        alignment: Alignment.centerLeft,
        child: StatusPill(
          label: 'Available',
          icon: Icons.check_circle_rounded,
          foreground: ServeColors.oliveInk,
          background: ServeColors.oliveTint,
        ),
      );
    }
    return const Align(
      alignment: Alignment.centerLeft,
      child: StatusPill(
        label: 'Not available',
        icon: Icons.do_not_disturb_on_rounded,
        foreground: ServeColors.orangeInk,
        background: ServeColors.orangeTint,
      ),
    );
  }
}
