import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/format.dart';
import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../services/auth/auth_controller.dart';
import '../../services/realtime/realtime_service.dart';
import '../../state/canteen_selection.dart';
import '../../state/cart_controller.dart';
import '../../state/favourites_controller.dart';
import '../../theme/serve_layout.dart';
import '../../theme/serve_theme.dart';
import '../cart_actions.dart';
import '../live_reload.dart';
import '../navigation.dart';
import '../widgets/favourite_button.dart';
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
  ServicePeriod? _period;
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
    final period = _selection.period;
    if (id == null) return;
    if (id == _canteenId && period == _period) return;
    _canteenId = id;
    _period = period;
    _data = null;
    _load();
    context.read<RealtimeService>().subscribeMenu(id);
  }

  Future<void> _load() async {
    final id = _canteenId;
    final period = _period ?? ServicePeriod.night;
    if (id == null) return;
    final generation = ++_generation;
    final api = context.read<ServeApi>();
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        api.menu(id, period: period),
        api.recommendations(id),
        api.orders(status: 'active', limit: 1),
      ]);
      if (!mounted || generation != _generation) return;
      final menu = results[0] as Menu;
      context.read<CanteenSelection>().applyCanteen(menu.canteen);
      final active = results[2] as PageResult<StudentOrder>;
      setState(() => _data = _HomeData(menu, results[1] as Recommendations, active.items.firstOrNull));
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
    final width = MediaQuery.sizeOf(context).width;
    final padding = ServeLayout.pagePadding(width);
    return Scaffold(
      appBar: ServeHeader(onSearch: () => context.read<HomeTabs>().openMenuSearch()),
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
            : SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: EdgeInsets.fromLTRB(padding, 8, padding, 36),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: ServeLayout.contentMax),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _Welcome(name: student?.firstName ?? 'there'),
                        const SizedBox(height: 16),
                        const _HomeSearchBar(),
                        const SizedBox(height: 18),
                        _CanteenCard(canteen: data.menu.canteen, hostelName: student?.hostel.name, period: data.menu.servicePeriod),
                        if (data.activeOrder != null) ...[const SizedBox(height: 14), _ActiveOrderCard(order: data.activeOrder!)],
                        const SizedBox(height: ServeSpace.section),
                        _MostOrdered(data: data),
                        const SizedBox(height: ServeSpace.section),
                        _FavouritesPanel(menu: data.menu),
                        const SizedBox(height: ServeSpace.section),
                        const _FullMenuBanner(),
                        if (_loading) const Padding(padding: EdgeInsets.only(top: 12), child: LinearProgressIndicator(minHeight: 2)),
                      ],
                    ),
                  ),
                ),
              ),
      ),
    );
  }
}

class _Welcome extends StatelessWidget {
  const _Welcome({required this.name});
  final String name;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Hi, $name', style: theme.textTheme.headlineMedium),
        const SizedBox(height: 4),
        Text('What are you craving tonight?', style: theme.textTheme.bodyLarge?.copyWith(color: ServeColors.muted)),
      ],
    );
  }
}

class _HomeSearchBar extends StatelessWidget {
  const _HomeSearchBar();

  @override
  Widget build(BuildContext context) {
    return Material(
      color: ServeColors.white,
      elevation: 0,
      shadowColor: ServeColors.ink.withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(28),
      child: InkWell(
        borderRadius: BorderRadius.circular(28),
        onTap: () => context.read<HomeTabs>().openMenuSearch(),
        child: Container(
          constraints: const BoxConstraints(minHeight: 52),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: ServeColors.line),
            boxShadow: [BoxShadow(color: ServeColors.ink.withValues(alpha: 0.04), blurRadius: 10, offset: const Offset(0, 3))],
          ),
          child: const Row(
            children: [
              Icon(Icons.search_rounded, color: ServeColors.oliveInk),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Search for dishes, categories...',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: ServeColors.muted, fontSize: 15),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CanteenCard extends StatelessWidget {
  const _CanteenCard({required this.canteen, required this.period, this.hostelName});
  final Canteen canteen;
  final ServicePeriod period;
  final String? hostelName;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final place = (canteen.location != null && canteen.location!.trim().isNotEmpty) ? canteen.location! : hostelName;
    return Material(
      color: ServeColors.oliveTint,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(ServeSpace.radiusCard)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => openCanteenSelection(context),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const IconTile(icon: Icons.storefront_rounded, size: 48),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          'PICKING UP FROM',
                          style: theme.textTheme.labelSmall?.copyWith(color: ServeColors.oliveInk, letterSpacing: 1),
                        ),
                        const Text(
                          'Change Canteen',
                          style: TextStyle(color: ServeColors.oliveInk, fontWeight: FontWeight.w800, fontSize: 13),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(canteen.name, style: theme.textTheme.titleMedium),
                    if (place != null && place.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(place, style: theme.textTheme.bodySmall),
                    ],
                    const SizedBox(height: 10),
                    CanteenStatusLabel(canteen: canteen),
                    const SizedBox(height: 10),
                    ServiceAvailabilityPills(canteen: canteen),
                    const SizedBox(height: 12),
                    ServicePeriodToggle(
                      value: period,
                      enabledPeriods: {
                        for (final p in ServicePeriod.values)
                          if (canteen.supports(p) || canteen.supportedPeriods.isEmpty) p,
                      },
                      onChanged: (next) async {
                        if (!context.mounted) return;
                        if (!await confirmCartContextChange(context, canteenId: canteen.id, period: next)) return;
                        if (!context.mounted) return;
                        context.read<CanteenSelection>().selectPeriod(next);
                      },
                    ),
                    if (canteen.orderingBlockReason(period) != null) ...[
                      const SizedBox(height: 10),
                      Text(
                        canteen.orderingBlockReason(period)!,
                        style: const TextStyle(color: ServeColors.orangeInk, fontWeight: FontWeight.w600, height: 1.35),
                      ),
                    ],
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

class _MostOrdered extends StatelessWidget {
  const _MostOrdered({required this.data});
  final _HomeData data;

  @override
  Widget build(BuildContext context) {
    final rec = data.recommendations;
    final title = switch (rec.basis) {
      RecommendationBasis.mostOrdered => 'Your Most Ordered',
      RecommendationBasis.popular => 'Popular with Students',
      RecommendationBasis.menu => 'From the Menu',
    };
    final subtitle = switch (rec.basis) {
      RecommendationBasis.mostOrdered => 'Your go-to favourites, just a tap away.',
      RecommendationBasis.popular => 'Ordered most at this canteen',
      RecommendationBasis.menu => 'A few picks to get you started',
    };
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = ServeLayout.homeColumns(constraints.maxWidth);
        final items = rec.items.where((i) => i.availability != Availability.inactive).take(columns * 2).toList();
        final gap = 12.0;
        final cardWidth = (constraints.maxWidth - gap * (columns - 1)) / columns;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SectionHeader(
              title: title,
              subtitle: subtitle,
              trailing: TextButton(onPressed: () => context.read<HomeTabs>().go(HomeTabs.menu), child: const Text('View All')),
            ),
            const SizedBox(height: 12),
            if (items.isEmpty)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(20),
                  child: Text('No items available at this canteen right now.', style: TextStyle(color: ServeColors.muted)),
                ),
              )
            else
              Wrap(
                spacing: gap,
                runSpacing: gap,
                children: [
                  for (final item in items)
                    SizedBox(
                      width: cardWidth,
                      child: _HomeFoodCard(
                        item: item,
                        canteen: data.menu.canteen,
                        categoryName: data.menu.categoryName(item.categoryId),
                        compact: columns >= 2,
                      ),
                    ),
                ],
              ),
          ],
        );
      },
    );
  }
}

/// Medium home card: existing FoodImage, independent heart and add-to-cart.
class _HomeFoodCard extends StatelessWidget {
  const _HomeFoodCard({required this.item, required this.canteen, required this.categoryName, required this.compact});

  final MenuItem item;
  final Canteen canteen;
  final String? categoryName;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final quantity = context.select<CartController, int>((c) => c.quantityOf(item.id));
    final unavailable = item.availability == Availability.unavailable;
    return Semantics(
      button: true,
      hint: 'Shows details',
      child: Card(
        child: InkWell(
          onTap: () => openFoodDetails(context, item, categoryName: categoryName),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AspectRatio(
                aspectRatio: 16 / 9,
                child: Stack(
                  children: [
                    Positioned.fill(
                      child: Opacity(
                        opacity: item.isOrderable ? 1 : 0.5,
                        child: FoodImage(
                          imageUrl: item.imageUrl,
                          category: categoryName,
                          width: double.infinity,
                          height: double.infinity,
                          radius: 0,
                        ),
                      ),
                    ),
                    Positioned(top: 6, right: 6, child: FavouriteButton(itemId: item.id, itemName: item.name)),
                    Positioned(
                      right: 6,
                      bottom: 6,
                      child: FittedBox(
                        child: QuantityControl(
                          quantity: quantity,
                          itemName: item.name,
                          enabled: item.isOrderable,
                          onAdd: () => addToCart(context, item, canteenName: canteen.name),
                          onRemove: () => context.read<CartController>().decrement(item.id),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: EdgeInsets.fromLTRB(compact ? 8 : 10, 8, compact ? 8 : 10, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: compact ? 13 : 14,
                        height: 1.2,
                        color: item.isOrderable ? ServeColors.ink : ServeColors.muted,
                      ),
                    ),
                    if (item.description != null) ...[
                      const SizedBox(height: 3),
                      Text(
                        item.description!,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: ServeColors.muted, fontSize: compact ? 11 : 12, height: 1.3),
                      ),
                    ],
                    const SizedBox(height: 8),
                    Text(
                      formatRupees(item.pricePaise),
                      style: TextStyle(fontWeight: FontWeight.w800, fontSize: compact ? 13 : 14, color: ServeColors.oliveInk),
                    ),
                    if (unavailable)
                      const Padding(
                        padding: EdgeInsets.only(top: 2),
                        child: Text('Unavailable', style: TextStyle(color: ServeColors.orangeInk, fontSize: 11, fontWeight: FontWeight.w700)),
                      ),
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

class _FavouritesPanel extends StatelessWidget {
  const _FavouritesPanel({required this.menu});
  final Menu menu;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final favourites = context.watch<FavouritesController>();
    final available = favourites.visibleOn(menu);
    final empty = favourites.count == 0;
    final countLine = empty
        ? 'Tap the heart on a dish to save it here.'
        : available.isEmpty
        ? 'None of your ${favourites.count} saved dishes are on this menu.'
        : available.length == 1
        ? '1 saved dish is available on this menu.'
        : '${available.length} saved dishes are available on this menu.';
    final copy = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Your Favourites', style: theme.textTheme.titleLarge),
        const SizedBox(height: 2),
        Text('Your saved food items, when available.', style: theme.textTheme.bodySmall),
        const SizedBox(height: 4),
        Text(countLine, style: const TextStyle(color: ServeColors.muted, fontSize: 12)),
      ],
    );
    final action = TextButton(onPressed: () => openFavourites(context), child: const Text('View Favourites'));
    final narrow = MediaQuery.sizeOf(context).width < 400;
    return Material(
      color: ServeColors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(ServeSpace.radiusCard),
        side: const BorderSide(color: ServeColors.line),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => openFavourites(context),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 12, 16),
          child: narrow
              ? Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const IconTile(icon: Icons.favorite_rounded, size: 52, background: ServeColors.orangeTint, color: ServeColors.orange),
                    const SizedBox(height: 12),
                    copy,
                    const SizedBox(height: 4),
                    action,
                  ],
                )
              : Row(
                  children: [
                    const IconTile(icon: Icons.favorite_rounded, size: 52, background: ServeColors.orangeTint, color: ServeColors.orange),
                    const SizedBox(width: 14),
                    Expanded(child: copy),
                    const SizedBox(width: 8),
                    action,
                  ],
                ),
        ),
      ),
    );
  }
}

class _FullMenuBanner extends StatelessWidget {
  const _FullMenuBanner();

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(20),
      child: DecoratedBox(
        decoration: const BoxDecoration(color: ServeColors.oliveDark),
        child: Stack(
          children: [
            Positioned(right: -28, top: -36, child: _BannerBlob(size: 140, opacity: 0.16)),
            Positioned(left: -20, bottom: -40, child: _BannerBlob(size: 110, opacity: 0.12)),
            Positioned(right: 48, bottom: -18, child: _BannerBlob(size: 70, opacity: 0.10)),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 22, 20, 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const IconTile(icon: Icons.restaurant_menu_rounded, size: 48, background: Color(0x33FFFFFF), color: ServeColors.white),
                  const SizedBox(height: 14),
                  Text(
                    'Explore the Full Menu',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: ServeColors.white),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Browse all items, filter, and find something delicious.',
                    style: TextStyle(color: Color(0xFFE8EDD4), fontSize: 14, height: 1.4),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: ServeColors.white,
                      foregroundColor: ServeColors.oliveInk,
                      minimumSize: const Size(0, 48),
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                    ),
                    onPressed: () => context.read<HomeTabs>().go(HomeTabs.menu),
                    child: const Text('View Full Menu'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BannerBlob extends StatelessWidget {
  const _BannerBlob({required this.size, required this.opacity});
  final double size;
  final double opacity;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(shape: BoxShape.circle, color: ServeColors.white.withValues(alpha: opacity)),
  );
}
