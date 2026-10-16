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
import '../widgets/surface.dart';

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
                  : const SkeletonList(label: 'Loading home', count: 4))
            : ListView(
                padding: const EdgeInsets.fromLTRB(ServeSpace.page, 8, ServeSpace.page, 32),
                children: [
                  Text('Hi, ${student?.firstName ?? 'there'}', style: Theme.of(context).textTheme.headlineMedium),
                  const SizedBox(height: 4),
                  Text('What are you craving tonight?', style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: ServeColors.muted)),
                  const SizedBox(height: 20),
                  _CanteenCard(canteen: data.menu.canteen),
                  if (data.activeOrder != null) ...[const SizedBox(height: 14), _ActiveOrderCard(order: data.activeOrder!)],
                  const SizedBox(height: ServeSpace.section),
                  _Recommendations(data: data),
                  if (_loading) const Padding(padding: EdgeInsets.only(top: 12), child: LinearProgressIndicator(minHeight: 2)),
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
        onTap: () => openCanteenSelection(context),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const IconTile(icon: Icons.storefront_rounded),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(child: Text('Picking up from', style: Theme.of(context).textTheme.bodySmall)),
                        const Text(
                          'Change',
                          style: TextStyle(color: ServeColors.oliveInk, fontWeight: FontWeight.w700),
                        ),
                      ],
                    ),
                    const SizedBox(height: 1),
                    Text(canteen.name, style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    CanteenStatusLabel(canteen: canteen),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
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
    final fg = ready ? ServeColors.white : ServeColors.ink;
    final soft = ready ? ServeColors.white.withValues(alpha: 0.85) : ServeColors.muted;
    return Material(
      color: ready ? ServeColors.oliveStrong : ServeColors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(ServeSpace.radiusCard),
        side: ready ? BorderSide.none : const BorderSide(color: ServeColors.line),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => unpaid ? openOrderDetails(context, order.id) : openTracking(context, order.id),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(ready ? Icons.shopping_bag_rounded : orderStatusStyle(order.status).icon, size: 18, color: soft),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      ready ? 'READY FOR PICKUP' : 'ACTIVE ORDER',
                      style: TextStyle(color: soft, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 1),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    decoration: BoxDecoration(
                      color: ready ? ServeColors.white : ServeColors.oliveTint,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      unpaid ? 'Pay now' : 'Track',
                      style: const TextStyle(color: ServeColors.oliveInk, fontWeight: FontWeight.w700, fontSize: 13),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                order.orderNumber,
                style: TextStyle(color: fg, fontSize: 30, fontWeight: FontWeight.w800, letterSpacing: 1),
              ),
              Text(
                ready ? 'Show this number at the counter' : orderStatusHeadline(order.status),
                style: TextStyle(color: fg, fontWeight: FontWeight.w600),
              ),
              if (!unpaid) ...[const SizedBox(height: 14), OrderProgressBar(status: order.status, onDark: ready)],
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
    final subtitle = switch (rec.basis) {
      RecommendationBasis.mostOrdered => 'Quick to reorder',
      RecommendationBasis.popular => 'Ordered most at this canteen',
      RecommendationBasis.menu => 'A few picks to get you started',
    };
    final items = rec.items.where((i) => i.availability != Availability.inactive).take(4).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHeader(title: title, subtitle: subtitle),
        const SizedBox(height: 12),
        if (items.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(20),
              child: Text('No items available at this canteen right now.', style: TextStyle(color: ServeColors.muted)),
            ),
          )
        else
          for (final item in items)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: MenuItemRow(item: item, canteen: data.menu.canteen, categoryName: data.menu.categoryName(item.categoryId)),
            ),
        const SizedBox(height: 6),
        OutlinedButton.icon(
          onPressed: () => context.read<HomeTabs>().go(HomeTabs.menu),
          icon: const Icon(Icons.restaurant_menu_rounded, size: 20),
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
    return Card(
      child: InkWell(
        onTap: () => openFoodDetails(context, item, categoryName: categoryName),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Opacity(
                opacity: item.isOrderable ? 1 : 0.5,
                child: FoodImage(imageUrl: item.imageUrl, category: categoryName, size: 68),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.name,
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 15,
                        height: 1.25,
                        color: item.isOrderable ? ServeColors.ink : ServeColors.muted,
                      ),
                    ),
                    if (item.description != null) ...[
                      const SizedBox(height: 3),
                      Text(
                        item.description!,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: ServeColors.muted, fontSize: 13, height: 1.3),
                      ),
                    ],
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(formatRupees(item.pricePaise), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
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
      style: const TextStyle(color: ServeColors.orangeInk, fontSize: 12, fontWeight: FontWeight.w700),
    ),
  );
}
