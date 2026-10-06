import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/format.dart';
import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../services/auth/auth_controller.dart';
import '../../services/realtime/realtime_service.dart';
import '../../state/canteen_selection.dart';
import '../../state/cart_controller.dart';
import '../../theme/serve_theme.dart';
import '../cart_actions.dart';
import '../live_reload.dart';
import '../navigation.dart';
import '../widgets/food_image.dart';
import '../widgets/order_status.dart';
import '../widgets/quantity_control.dart';
import '../widgets/serve_header.dart';
import '../widgets/states.dart';

class _HomeData {
  const _HomeData(this.menu, this.recommendations, this.activeOrder);
  final Menu menu;
  final Recommendations recommendations;
  final StudentOrder? activeOrder;
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver, LiveReload {
  _HomeData? _data;
  Object? _error;
  bool _loading = true;
  String? _canteenId;
  int _generation = 0;
  late final CanteenSelection _selection;

  @override
  void initState() {
    super.initState();
    startLive();
    _selection = context.read<CanteenSelection>()..addListener(_onCanteenChanged);
    _onCanteenChanged();
  }

  @override
  void dispose() {
    _selection.removeListener(_onCanteenChanged);
    super.dispose();
  }

  void _onCanteenChanged() {
    final id = _selection.id;
    if (id == null || id == _canteenId) return;
    _canteenId = id;
    _data = null;
    _load();
    context.read<RealtimeService>().subscribeMenu(id);
  }

  Future<void> _load() async {
    final id = _canteenId;
    if (id == null) return;
    final generation = ++_generation;
    final api = context.read<ServeApi>();
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([api.menu(id), api.recommendations(id), api.orders(status: 'active', limit: 1)]);
      if (!mounted || generation != _generation) return;
      final active = results[2] as PageResult<StudentOrder>;
      setState(() => _data = _HomeData(results[0] as Menu, results[1] as Recommendations, active.items.firstOrNull));
    } catch (e) {
      if (mounted && generation == _generation) setState(() => _error = e);
    } finally {
      if (mounted && generation == _generation) setState(() => _loading = false);
    }
  }

  @override
  void onReconnect() => _load();

  @override
  void onConnected() {
    if (_canteenId != null) context.read<RealtimeService>().subscribeMenu(_canteenId!);
  }

  @override
  void onLiveEvent(RealtimeEvent event) {
    if (event.type.startsWith('order.')) {
      _load();
    } else if (event.type.startsWith('menu.') || event.type == 'canteen.status_changed') {
      final canteenId =
          event.data['canteenId'] ?? (event.data['item'] as Map?)?['canteenId'] ?? (event.data['category'] as Map?)?['canteenId'];
      if (canteenId == null || canteenId == _canteenId) _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final student = context.select<AuthController, StudentMe?>((a) => a.student);
    final data = _data;
    return Scaffold(
      appBar: const ServeHeader(),
      body: RefreshIndicator(
        color: ServeColors.olive,
        onRefresh: _load,
        child: data == null
            ? (_error != null
                  ? ListView(
                      children: [
                        SizedBox(
                          height: 420,
                          child: ErrorView(error: _error!, onRetry: _load),
                        ),
                      ],
                    )
                  : const LoadingView(label: 'Loading home'))
            : ListView(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 32),
                children: [
                  Text('Hi, ${student?.firstName ?? 'there'}', style: Theme.of(context).textTheme.headlineMedium),
                  const SizedBox(height: 4),
                  const Text('What are you craving tonight?', style: TextStyle(color: ServeColors.muted, fontSize: 16)),
                  const SizedBox(height: 18),
                  _CanteenCard(canteen: data.menu.canteen),
                  if (data.activeOrder != null) ...[const SizedBox(height: 16), _ActiveOrderCard(order: data.activeOrder!)],
                  const SizedBox(height: 28),
                  _Recommendations(data: data),
                  if (_loading)
                    const Padding(
                      padding: EdgeInsets.only(top: 12),
                      child: LinearProgressIndicator(color: ServeColors.olive, minHeight: 2),
                    ),
                ],
              ),
      ),
    );
  }
}

class _CanteenCard extends StatelessWidget {
  const _CanteenCard({required this.canteen});
  final Canteen canteen;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => openCanteenSelection(context),
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
                    const Text('Picking up from', style: TextStyle(color: ServeColors.muted, fontSize: 13)),
                    Text(canteen.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                    const SizedBox(height: 4),
                    CanteenStatusLabel(canteen: canteen),
                  ],
                ),
              ),
              const Text(
                'Change',
                style: TextStyle(color: ServeColors.oliveDark, fontWeight: FontWeight.w700),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class CanteenStatusLabel extends StatelessWidget {
  const CanteenStatusLabel({super.key, required this.canteen});
  final Canteen canteen;

  @override
  Widget build(BuildContext context) {
    final accepting = canteen.acceptingOrders;
    final color = accepting ? ServeColors.oliveDark : const Color(0xFFA9461A);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(accepting ? Icons.circle : Icons.pause_circle_filled_rounded, size: accepting ? 9 : 14, color: color),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            accepting
                ? 'Accepting orders${canteen.openingHours != null ? ' · ${canteen.openingHours}' : ''}'
                : 'Not accepting orders right now',
            style: TextStyle(color: color, fontSize: 13, fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
  }
}

class _ActiveOrderCard extends StatelessWidget {
  const _ActiveOrderCard({required this.order});
  final StudentOrder order;

  @override
  Widget build(BuildContext context) {
    final ready = order.status == OrderStatus.ready;
    final unpaid = order.status == OrderStatus.placed;
    return Material(
      color: ready ? ServeColors.olive : ServeColors.ink,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => unpaid ? openOrderDetails(context, order.id) : openTracking(context, order.id),
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      ready ? 'READY FOR PICKUP' : 'ACTIVE ORDER',
                      style: TextStyle(
                        color: ServeColors.white.withValues(alpha: 0.8),
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      order.orderNumber,
                      style: const TextStyle(color: ServeColors.white, fontSize: 28, fontWeight: FontWeight.w900, letterSpacing: 0.5),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      ready ? 'Show this number at the counter' : orderStatusHeadline(order.status),
                      style: const TextStyle(color: ServeColors.white, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(color: ServeColors.white.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(24)),
                child: Text(
                  unpaid ? 'Pay now' : 'Track',
                  style: const TextStyle(color: ServeColors.white, fontWeight: FontWeight.w800),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Recommendations extends StatelessWidget {
  const _Recommendations({required this.data});
  final _HomeData data;

  @override
  Widget build(BuildContext context) {
    final rec = data.recommendations;
    final title = switch (rec.basis) {
      RecommendationBasis.mostOrdered => 'Your Most Ordered',
      RecommendationBasis.popular => 'Popular with Students',
      // No order history anywhere yet: say so honestly instead of claiming popularity.
      RecommendationBasis.menu => 'From the Menu',
    };
    final items = rec.items.where((i) => i.availability != Availability.inactive).take(4).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        if (items.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(20),
              child: Text('No items available at this canteen right now.', style: TextStyle(color: ServeColors.muted)),
            ),
          )
        else
          Card(
            child: Column(
              children: [
                for (var i = 0; i < items.length; i++) ...[
                  if (i > 0) const Divider(indent: 16, endIndent: 16),
                  MenuItemRow(item: items[i], canteen: data.menu.canteen, categoryName: data.menu.categoryName(items[i].categoryId)),
                ],
              ],
            ),
          ),
        const SizedBox(height: 16),
        OutlinedButton.icon(
          onPressed: () => context.read<HomeTabs>().go(HomeTabs.menu),
          icon: const Icon(Icons.restaurant_menu_rounded),
          label: const Text('View Full Menu'),
        ),
      ],
    );
  }
}

/// One menu item with its add / quantity control. Used on Home and Menu.
class MenuItemRow extends StatelessWidget {
  const MenuItemRow({super.key, required this.item, required this.canteen, required this.categoryName});
  final MenuItem item;
  final Canteen canteen;
  final String? categoryName;

  @override
  Widget build(BuildContext context) {
    final quantity = context.select<CartController, int>((c) => c.quantityOf(item.id));
    final unavailable = item.availability == Availability.unavailable;
    return Semantics(button: true, hint: 'Shows details', child: _rowBody(context, quantity, unavailable));
  }

  Widget _rowBody(BuildContext context, int quantity, bool unavailable) {
    return InkWell(
      onTap: () => openFoodDetails(context, item, categoryName: categoryName),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Opacity(
              opacity: item.isOrderable ? 1 : 0.5,
              child: FoodImage(imageUrl: item.imageUrl, category: categoryName, size: 64),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.name,
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                      color: item.isOrderable ? ServeColors.ink : ServeColors.muted,
                    ),
                  ),
                  if (item.description != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      item.description!,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: ServeColors.muted, fontSize: 13),
                    ),
                  ],
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(formatRupees(item.pricePaise), style: const TextStyle(fontWeight: FontWeight.w800)),
                      if (unavailable) const _Tag('Unavailable'),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            QuantityControl(
              quantity: quantity,
              itemName: item.name,
              enabled: item.isOrderable,
              onAdd: () => addToCart(context, item, canteenName: canteen.name),
              onRemove: () => context.read<CartController>().decrement(item.id),
            ),
          ],
        ),
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    decoration: BoxDecoration(color: ServeColors.orangeTint, borderRadius: BorderRadius.circular(6)),
    child: Text(
      text,
      style: const TextStyle(color: Color(0xFFA9461A), fontSize: 12, fontWeight: FontWeight.w700),
    ),
  );
}
