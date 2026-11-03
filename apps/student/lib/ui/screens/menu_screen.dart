import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../services/api/models.dart';
import '../../services/api/serve_api.dart';
import '../../services/realtime/realtime_service.dart';
import '../../state/canteen_selection.dart';
import '../../state/cart_controller.dart';
import '../cart_actions.dart';
import '../../state/recently_viewed_controller.dart';
import '../../theme/serve_layout.dart';
import '../../theme/serve_theme.dart';
import '../live_reload.dart';
import '../menu/menu_catalog.dart';
import '../navigation.dart';
import '../widgets/food_product_card.dart';
import '../widgets/menu_filter_panel.dart';
import '../widgets/menu_pagination.dart';
import '../widgets/menu_search_field.dart';
import '../widgets/serve_header.dart';
import '../widgets/states.dart';
import '../widgets/surface.dart';

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
  ServicePeriod? _period;
  MenuFilters _filters = MenuFilters.none;
  MenuFilters _draft = MenuFilters.none;
  MenuSort _sort = MenuSort.featured;
  int _page = 1;
  int _generation = 0;
  late final CanteenSelection _selection;
  late final HomeTabs _tabs;
  late final TextEditingController _search;
  late final FocusNode _searchFocus;

  @override
  void initState() {
    super.initState();
    _search = TextEditingController();
    _searchFocus = FocusNode();
    startLive();
    _selection = context.read<CanteenSelection>()..addListener(_onCanteenChanged);
    _tabs = context.read<HomeTabs>()..addListener(_onTabs);
    _onCanteenChanged();
  }

  @override
  void dispose() {
    _selection.removeListener(_onCanteenChanged);
    _tabs.removeListener(_onTabs);
    _search.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  void _onTabs() {
    final handed = _tabs.takeMenuSearch();
    if (handed == null) return;
    _search.value = TextEditingValue(text: handed.query, selection: TextSelection.collapsed(offset: handed.query.length));
    _setSearch(handed.query);
    if (handed.focus) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _searchFocus.requestFocus();
      });
    }
  }

  void _onCanteenChanged() {
    final id = _selection.id;
    final period = _selection.period;
    if (id == null) return;
    if (id == _canteenId && period == _period) return;
    _canteenId = id;
    _period = period;
    _menu = null;
    _filters = MenuFilters.none;
    _draft = MenuFilters.none;
    _sort = MenuSort.featured;
    _page = 1;
    _search.clear();
    _load();
    context.read<RealtimeService>().subscribeMenu(id);
  }

  Future<void> _load() async {
    final id = _canteenId;
    final period = _period ?? ServicePeriod.night;
    if (id == null) return;
    final generation = ++_generation;
    setState(() => _error = null);
    try {
      final menu = await context.read<ServeApi>().menu(id, period: period);
      if (!mounted || generation != _generation) return;
      context.read<CanteenSelection>().applyCanteen(menu.canteen);
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

  void _setSearch(String value) => setState(() {
    _filters = _filters.copyWith(search: value);
    _draft = _draft.copyWith(search: value);
    _page = 1;
  });

  void _applyFilters(MenuFilters next) => setState(() {
    _filters = next.copyWith(search: _search.text);
    _draft = _filters;
    _page = 1;
  });

  void _clearFilters() {
    _search.clear();
    _applyFilters(MenuFilters.none);
  }

  Future<void> _openFilterSheet() async {
    _draft = _filters;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: ServeColors.white,
      builder: (context) {
        return Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
          child: StatefulBuilder(
            builder: (context, setSheet) {
              return SafeArea(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
                  child: MenuFilterPanel(
                    menu: _menu!,
                    draft: _draft,
                    embedded: true,
                    onDraftChanged: (value) => setSheet(() => _draft = value),
                    onApply: () {
                      _applyFilters(_draft);
                      Navigator.of(context).pop();
                    },
                    onClear: () {
                      _clearFilters();
                      Navigator.of(context).pop();
                    },
                  ),
                ),
              );
            },
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final menu = _menu;
    return Scaffold(
      appBar: ServeHeader(onSearch: () => _searchFocus.requestFocus()),
      body: menu == null
          ? (_error != null ? ErrorView(error: _error!, onRetry: _load) : const SkeletonList(label: 'Loading menu'))
          : _MenuBody(
              menu: menu,
              filters: _filters,
              draft: _draft,
              sort: _sort,
              page: _page,
              search: _search,
              searchFocus: _searchFocus,
              onSearch: _setSearch,
              onDraft: (value) => setState(() => _draft = value),
              onApply: () => _applyFilters(_draft),
              onClear: _clearFilters,
              onOpenFilters: _openFilterSheet,
              onCategory: (id) => _applyFilters(_filters.copyWith(categoryId: id, clearCategory: id == null)),
              onSort: (value) => setState(() {
                _sort = value;
                _page = 1;
              }),
              onPage: (value) => setState(() => _page = value),
              onRefresh: _load,
            ),
      bottomNavigationBar: _CartBar(canteenId: _canteenId),
    );
  }
}

class _MenuBody extends StatelessWidget {
  const _MenuBody({
    required this.menu,
    required this.filters,
    required this.draft,
    required this.sort,
    required this.page,
    required this.search,
    required this.searchFocus,
    required this.onSearch,
    required this.onDraft,
    required this.onApply,
    required this.onClear,
    required this.onOpenFilters,
    required this.onCategory,
    required this.onSort,
    required this.onPage,
    required this.onRefresh,
  });

  final Menu menu;
  final MenuFilters filters;
  final MenuFilters draft;
  final MenuSort sort;
  final int page;
  final TextEditingController search;
  final FocusNode searchFocus;
  final ValueChanged<String> onSearch;
  final ValueChanged<MenuFilters> onDraft;
  final VoidCallback onApply;
  final VoidCallback onClear;
  final VoidCallback onOpenFilters;
  final ValueChanged<String?> onCategory;
  final ValueChanged<MenuSort> onSort;
  final ValueChanged<int> onPage;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final padding = ServeLayout.pagePadding(width);
    final sidebar = ServeLayout.showSidebar(width);
    final compact = width < 600;
    final slice = MenuCatalog.page(menu: menu, filters: filters, sortBy: sort, page: page);
    final recent = context.watch<RecentlyViewedController>().visibleOn(menu);
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: ServeLayout.contentMax),
          child: CustomScrollView(
            slivers: [
              SliverToBoxAdapter(child: _MenuIntro(menu: menu, compact: compact, padding: padding)),
              SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.fromLTRB(padding, 0, padding, 12),
                  child: _Toolbar(
                    menu: menu,
                    filters: filters,
                    search: search,
                    searchFocus: searchFocus,
                    sort: sort,
                    compact: compact,
                    showFilterButton: !sidebar,
                    showCategoryChips: !sidebar,
                    onSearch: onSearch,
                    onOpenFilters: onOpenFilters,
                    onSort: onSort,
                    onCategory: onCategory,
                  ),
                ),
              ),
              if (filters.hasActiveFilters)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(padding, 0, padding, 8),
                    child: _ActiveFilterRow(menu: menu, filters: filters, onClear: onClear),
                  ),
                ),
              if (menu.visibleCategories.isEmpty)
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: EmptyView(
                    icon: Icons.no_meals_rounded,
                    title: 'No items on the ${menu.servicePeriod.label.toLowerCase()} menu right now.',
                  ),
                )
              else
                SliverPadding(
                  padding: EdgeInsets.fromLTRB(padding, 4, padding, 8),
                  sliver: SliverToBoxAdapter(
                    child: sidebar
                        ? Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              SizedBox(
                                width: ServeLayout.sidebarWidth,
                                child: MenuFilterPanel(
                                  menu: menu,
                                  draft: draft,
                                  onDraftChanged: onDraft,
                                  onApply: onApply,
                                  onClear: onClear,
                                ),
                              ),
                              const SizedBox(width: 24),
                              Expanded(child: _MenuResults(menu: menu, slice: slice, compact: compact, onPage: onPage)),
                            ],
                          )
                        : _MenuResults(menu: menu, slice: slice, compact: compact, onPage: onPage),
                  ),
                ),
              if (recent.isNotEmpty)
                SliverToBoxAdapter(
                  child: _RecentlyViewed(canteen: menu.canteen, items: recent, padding: padding, compact: compact),
                ),
              if (sidebar) SliverToBoxAdapter(child: _MenuFooter(padding: padding)),
              const SliverToBoxAdapter(child: SizedBox(height: 24)),
            ],
          ),
        ),
      ),
    );
  }
}

class _MenuIntro extends StatelessWidget {
  const _MenuIntro({required this.menu, required this.compact, required this.padding});
  final Menu menu;
  final bool compact;
  final double padding;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(padding, 4, padding, 16),
      child: DecoratedBox(
        decoration: const BoxDecoration(
          border: Border(left: BorderSide(color: ServeColors.olive, width: 4)),
        ),
        child: Padding(
          padding: const EdgeInsets.only(left: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (!compact)
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    TextButton(onPressed: () => context.read<HomeTabs>().go(HomeTabs.home), child: const Text('Home')),
                    const Text(' / ', style: TextStyle(color: ServeColors.muted)),
                    Text('Menu', style: theme.textTheme.titleSmall?.copyWith(color: ServeColors.oliveInk)),
                  ],
                ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Semantics(header: true, child: Text('Menu', style: theme.textTheme.headlineMedium)),
                        const SizedBox(height: 4),
                        Text(menu.canteen.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: theme.textTheme.titleMedium),
                        if (menu.canteen.location != null) ...[
                          const SizedBox(height: 2),
                          Text(menu.canteen.location!, style: theme.textTheme.bodyMedium?.copyWith(color: ServeColors.muted)),
                        ],
                      ],
                    ),
                  ),
                  TextButton(
                    style: TextButton.styleFrom(minimumSize: const Size(0, 36), tapTargetSize: MaterialTapTargetSize.shrinkWrap),
                    onPressed: () => openCanteenSelection(context),
                    child: const Text('Change'),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              CanteenStatusLabel(canteen: menu.canteen),
              const SizedBox(height: 10),
              ServiceAvailabilityPills(canteen: menu.canteen),
              const SizedBox(height: 12),
              ServicePeriodToggle(
                value: menu.servicePeriod,
                enabledPeriods: menu.canteen.supportedPeriods.isEmpty ? null : menu.canteen.supportedPeriods.toSet(),
                onChanged: (next) async {
                  if (!await confirmCartContextChange(context, canteenId: menu.canteen.id, period: next)) return;
                  if (!context.mounted) return;
                  context.read<CanteenSelection>().selectPeriod(next);
                },
              ),
              if (menu.canteen.orderingBlockReason(menu.servicePeriod) != null) ...[
                const SizedBox(height: 12),
                NoticeBanner(
                  message: menu.canteen.orderingBlockReason(menu.servicePeriod)!,
                  icon: Icons.schedule_rounded,
                ),
              ] else if (!menu.canteen.acceptingOrders) ...[
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
    );
  }
}

class _Toolbar extends StatelessWidget {
  const _Toolbar({
    required this.menu,
    required this.filters,
    required this.search,
    required this.searchFocus,
    required this.sort,
    required this.compact,
    required this.showFilterButton,
    required this.showCategoryChips,
    required this.onSearch,
    required this.onOpenFilters,
    required this.onSort,
    required this.onCategory,
  });

  final Menu menu;
  final MenuFilters filters;
  final TextEditingController search;
  final FocusNode searchFocus;
  final MenuSort sort;
  final bool compact;
  final bool showFilterButton;
  final bool showCategoryChips;
  final ValueChanged<String> onSearch;
  final VoidCallback onOpenFilters;
  final ValueChanged<MenuSort> onSort;
  final ValueChanged<String?> onCategory;

  @override
  Widget build(BuildContext context) {
    final field = MenuSearchField(controller: search, focusNode: searchFocus, onChanged: onSearch);
    final sortControl = _SortControl(sort: sort, onSort: onSort);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (compact) ...[
          field,
          const SizedBox(height: 10),
          Row(
            children: [
              if (showFilterButton) ...[
                IconButton.outlined(
                  tooltip: 'Filters',
                  onPressed: onOpenFilters,
                  icon: const Icon(Icons.tune_rounded),
                ),
                const SizedBox(width: 8),
              ],
              Expanded(child: sortControl),
            ],
          ),
        ] else
          Row(
            children: [
              Expanded(child: field),
              const SizedBox(width: 12),
              if (showFilterButton) ...[
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44)),
                  onPressed: onOpenFilters,
                  icon: const Icon(Icons.tune_rounded, size: 18),
                  label: const Text('Filters'),
                ),
                const SizedBox(width: 8),
              ],
              SizedBox(width: 220, child: sortControl),
            ],
          ),
        if (showCategoryChips && menu.visibleCategories.isNotEmpty) ...[
          const SizedBox(height: 12),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _CategoryChip(label: 'All', selected: filters.categoryId == null, onTap: () => onCategory(null)),
                for (final category in menu.visibleCategories)
                  _CategoryChip(label: category.name, selected: filters.categoryId == category.id, onTap: () => onCategory(category.id)),
              ],
            ),
          ),
        ],
      ],
    );
  }
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

class _SortControl extends StatelessWidget {
  const _SortControl({required this.sort, required this.onSort});
  final MenuSort sort;
  final ValueChanged<MenuSort> onSort;

  @override
  Widget build(BuildContext context) {
    return InputDecorator(
      decoration: const InputDecoration(
        isDense: true,
        contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 2),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<MenuSort>(
          value: sort,
          isDense: true,
          isExpanded: true,
          borderRadius: BorderRadius.circular(ServeSpace.radiusControl),
          items: const [
            DropdownMenuItem(value: MenuSort.featured, child: Text('Featured', overflow: TextOverflow.ellipsis)),
            DropdownMenuItem(value: MenuSort.nameAz, child: Text('Name A–Z', overflow: TextOverflow.ellipsis)),
            DropdownMenuItem(value: MenuSort.priceLow, child: Text('Price: low to high', overflow: TextOverflow.ellipsis)),
            DropdownMenuItem(value: MenuSort.priceHigh, child: Text('Price: high to low', overflow: TextOverflow.ellipsis)),
          ],
          onChanged: (value) {
            if (value != null) onSort(value);
          },
        ),
      ),
    );
  }
}

class _ActiveFilterRow extends StatelessWidget {
  const _ActiveFilterRow({required this.menu, required this.filters, required this.onClear});
  final Menu menu;
  final MenuFilters filters;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final labels = <String>[
      if (filters.search.trim().isNotEmpty) 'Search “${filters.search.trim()}”',
      if (filters.categoryId != null) menu.categoryName(filters.categoryId!) ?? 'Category',
      if (!filters.includeAvailable || !filters.includeUnavailable)
        filters.includeAvailable
            ? 'Available'
            : filters.includeUnavailable
            ? 'Unavailable'
            : 'Hidden',
    ];
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        for (final label in labels)
          Chip(label: Text(label), visualDensity: VisualDensity.compact, side: const BorderSide(color: ServeColors.line)),
        TextButton(onPressed: onClear, child: const Text('Clear filters')),
      ],
    );
  }
}

class _MenuResults extends StatelessWidget {
  const _MenuResults({required this.menu, required this.slice, required this.compact, required this.onPage});
  final Menu menu;
  final MenuPageSlice slice;
  final bool compact;
  final ValueChanged<int> onPage;

  @override
  Widget build(BuildContext context) {
    if (slice.total == 0) {
      return const EmptyView(icon: Icons.search_off_rounded, title: 'No items match these filters.');
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = ServeLayout.gridColumns(constraints.maxWidth);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${slice.from}–${slice.to} of ${slice.total} items',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: slice.items.length,
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: columns,
                mainAxisSpacing: 10,
                crossAxisSpacing: 10,
                mainAxisExtent: ServeLayout.cardExtent(constraints.maxWidth, columns, compact),
              ),
              itemBuilder: (context, i) {
                final entry = slice.items[i];
                return FoodProductCard(
                  item: entry.item,
                  canteen: menu.canteen,
                  categoryName: entry.category.name,
                  compact: compact || columns >= 3,
                );
              },
            ),
            const SizedBox(height: 20),
            MenuPagination(page: slice.page, pageCount: slice.pageCount, onPage: onPage, compact: compact),
          ],
        );
      },
    );
  }
}

class _RecentlyViewed extends StatelessWidget {
  const _RecentlyViewed({required this.canteen, required this.items, required this.padding, required this.compact});
  final Canteen canteen;
  final List<({MenuItem item, String? categoryName})> items;
  final double padding;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: ServeColors.oliveTint.withValues(alpha: 0.35),
      child: Padding(
        padding: EdgeInsets.fromLTRB(padding, 20, padding, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SectionHeader(title: 'Recently viewed', subtitle: 'Items you opened in this session'),
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, constraints) {
                final columns = ServeLayout.gridColumns(constraints.maxWidth).clamp(1, 4);
                return GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: items.length,
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: columns,
                    mainAxisSpacing: 10,
                    crossAxisSpacing: 10,
                    mainAxisExtent: ServeLayout.cardExtent(constraints.maxWidth, columns, compact),
                  ),
                  itemBuilder: (context, i) => FoodProductCard(
                    item: items[i].item,
                    canteen: canteen,
                    categoryName: items[i].categoryName,
                    compact: compact || columns >= 3,
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _MenuFooter extends StatelessWidget {
  const _MenuFooter({required this.padding});
  final double padding;

  @override
  Widget build(BuildContext context) {
    final tabs = context.read<HomeTabs>();
    return Padding(
      padding: EdgeInsets.fromLTRB(padding, 28, padding, 8),
      child: DecoratedBox(
        decoration: const BoxDecoration(border: Border(top: BorderSide(color: ServeColors.line))),
        child: Padding(
          padding: const EdgeInsets.only(top: 18),
          child: Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 12,
            runSpacing: 8,
            children: [
              Text('SERVE', style: Theme.of(context).textTheme.titleSmall),
              Wrap(
                spacing: 8,
                children: [
                  TextButton(onPressed: () => tabs.go(HomeTabs.home), child: const Text('Home')),
                  TextButton(onPressed: () => tabs.go(HomeTabs.menu), child: const Text('Menu')),
                  TextButton(onPressed: () => tabs.go(HomeTabs.orders), child: const Text('Orders')),
                  TextButton(onPressed: () => tabs.go(HomeTabs.profile), child: const Text('Profile')),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
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
