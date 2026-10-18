import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../services/realtime/realtime_service.dart';
import '../../state/canteen_selection.dart';
import '../../state/cart_controller.dart';
import '../../theme/serve_theme.dart';
import '../live_reload.dart';
import '../navigation.dart';
import '../widgets/serve_header.dart';
import '../widgets/states.dart';
import '../widgets/surface.dart';
import 'home_screen.dart';

/// Full menu of the selected canteen. INACTIVE items are hidden, UNAVAILABLE
/// items stay visible but cannot be added. Updates live via `menu:subscribe`.
class MenuScreen extends StatefulWidget {
  const MenuScreen({super.key});

  @override
  State<MenuScreen> createState() => _MenuScreenState();
}

class _MenuScreenState extends State<MenuScreen> with WidgetsBindingObserver, LiveReload {
  Menu? _menu;
  Object? _error;
  String? _canteenId;
  String? _category;
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
    _menu = null;
    _category = null;
    _load();
    context.read<RealtimeService>().subscribeMenu(id);
  }

  Future<void> _load() async {
    final id = _canteenId;
    if (id == null) return;
    final generation = ++_generation;
    setState(() => _error = null);
    try {
      final menu = await context.read<ServeApi>().menu(id);
      if (!mounted || generation != _generation) return;
      // Keep cart snapshots (names/prices shown in the cart) current.
      final cart = context.read<CartController>();
      for (final c in menu.categories) {
        for (final item in c.items) {
          cart.updateItem(item);
        }
      }
      setState(() => _menu = menu);
    } catch (e) {
      if (mounted && generation == _generation) setState(() => _error = e);
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
    if (!event.type.startsWith('menu.') && event.type != 'canteen.status_changed') return;
    final canteenId =
        event.data['canteenId'] ?? (event.data['item'] as Map?)?['canteenId'] ?? (event.data['category'] as Map?)?['canteenId'];
    if (canteenId == null || canteenId == _canteenId) _load();
  }

  @override
  Widget build(BuildContext context) {
    final menu = _menu;
    return Scaffold(
      appBar: const ServeHeader(),
      body: menu == null
          ? (_error != null ? ErrorView(error: _error!, onRetry: _load) : const SkeletonList(label: 'Loading menu'))
          : _MenuBody(menu: menu, selectedCategory: _category, onCategory: (id) => setState(() => _category = id), onRefresh: _load),
      bottomNavigationBar: _CartBar(canteenId: _canteenId),
    );
  }
}

class _MenuBody extends StatelessWidget {
  const _MenuBody({required this.menu, required this.selectedCategory, required this.onCategory, required this.onRefresh});
  final Menu menu;
  final String? selectedCategory;
  final ValueChanged<String?> onCategory;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final categories = menu.visibleCategories;
    final shown = selectedCategory == null ? categories : categories.where((c) => c.id == selectedCategory).toList();
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: CustomScrollView(
        slivers: [
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(ServeSpace.page, 4, ServeSpace.page, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Semantics(
                              header: true,
                              child: Text(menu.canteen.name, style: theme.textTheme.titleLarge?.copyWith(fontSize: 21)),
                            ),
                            if (menu.canteen.location != null) ...[
                              const SizedBox(height: 2),
                              Text(menu.canteen.location!, style: theme.textTheme.bodyMedium?.copyWith(color: ServeColors.muted)),
                            ],
                          ],
                        ),
                      ),
                      TextButton(onPressed: () => openCanteenSelection(context), child: const Text('Change')),
                    ],
                  ),
                  const SizedBox(height: 10),
                  CanteenStatusLabel(canteen: menu.canteen),
                  if (!menu.canteen.acceptingOrders) ...[
                    const SizedBox(height: 12),
                    const NoticeBanner(
                      message: 'This canteen is currently not accepting orders. You can still browse the menu.',
                      icon: Icons.pause_circle_outline_rounded,
                    ),
                  ],
                ],
              ),
            ),
          ),
          if (categories.isNotEmpty)
            SliverPersistentHeader(
              pinned: true,
              delegate: _CategoryBar(
                children: [
                  _CategoryChip(label: 'All', selected: selectedCategory == null, onTap: () => onCategory(null)),
                  for (final c in categories)
                    _CategoryChip(label: c.name, selected: selectedCategory == c.id, onTap: () => onCategory(c.id)),
                ],
              ),
            ),
          if (categories.isEmpty)
            const SliverFillRemaining(
              hasScrollBody: false,
              child: EmptyView(icon: Icons.no_meals_rounded, title: 'No items available at this canteen right now.'),
            )
          else
            for (final category in shown) ...[
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(ServeSpace.page, 20, ServeSpace.page, 10),
                  child: SectionHeader(title: category.name),
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.symmetric(horizontal: ServeSpace.page),
                sliver: SliverList.separated(
                  itemCount: category.items.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (context, i) => MenuItemRow(item: category.items[i], canteen: menu.canteen, categoryName: category.name),
                ),
              ),
            ],
          const SliverToBoxAdapter(child: SizedBox(height: 24)),
        ],
      ),
    );
  }
}

/// Category chips that stay at the top while the menu scrolls.
class _CategoryBar extends SliverPersistentHeaderDelegate {
  const _CategoryBar({required this.children});
  final List<Widget> children;

  static const _height = 56.0;

  @override
  double get minExtent => _height;
  @override
  double get maxExtent => _height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: ServeColors.paper,
        border: Border(bottom: BorderSide(color: overlapsContent || shrinkOffset > 0 ? ServeColors.line : Colors.transparent)),
      ),
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: ServeSpace.page, vertical: 8),
        children: children,
      ),
    );
  }

  @override
  bool shouldRebuild(_CategoryBar oldDelegate) => true;
}

class _CategoryChip extends StatelessWidget {
  const _CategoryChip({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(right: 8),
    child: ChoiceChip(
      label: Text(label),
      selected: selected,
      showCheckmark: false,
      onSelected: (_) => onTap(),
      side: BorderSide(color: selected ? ServeColors.oliveStrong : ServeColors.line),
      labelStyle: TextStyle(color: selected ? ServeColors.white : ServeColors.ink, fontWeight: FontWeight.w600),
    ),
  );
}

/// "View cart" bar while the cart holds items from this canteen.
class _CartBar extends StatelessWidget {
  const _CartBar({required this.canteenId});
  final String? canteenId;

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartController>();
    final visible = !cart.isEmpty && cart.canteenId == canteenId;
    return AnimatedSize(
      duration: const Duration(milliseconds: 200),
      child: !visible
          ? const SizedBox.shrink()
          : SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: FilledButton(
                  style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 18)),
                  onPressed: () => openCart(context),
                  child: Row(
                    children: [
                      const Icon(Icons.shopping_bag_outlined, size: 20),
                      const SizedBox(width: 10),
                      Text('${cart.itemCount} ${cart.itemCount == 1 ? 'item' : 'items'}'),
                      const Spacer(),
                      const Text('View cart'),
                      const SizedBox(width: 2),
                      const Icon(Icons.chevron_right_rounded),
                    ],
                  ),
                ),
              ),
            ),
    );
  }
}
