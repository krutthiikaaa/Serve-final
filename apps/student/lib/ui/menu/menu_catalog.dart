import '../../services/api/models.dart';
import '../../theme/serve_layout.dart';

enum MenuSort { featured, nameAz, priceLow, priceHigh }

class MenuFilters {
  const MenuFilters({
    this.search = '',
    this.categoryId,
    this.minPricePaise,
    this.maxPricePaise,
    this.includeAvailable = true,
    this.includeUnavailable = true,
  });

  final String search;
  final String? categoryId;
  final int? minPricePaise;
  final int? maxPricePaise;
  final bool includeAvailable;
  final bool includeUnavailable;

  bool get hasActiveFilters =>
      search.trim().isNotEmpty ||
      categoryId != null ||
      minPricePaise != null ||
      maxPricePaise != null ||
      !includeAvailable ||
      !includeUnavailable;

  MenuFilters copyWith({
    String? search,
    String? categoryId,
    int? minPricePaise,
    int? maxPricePaise,
    bool? includeAvailable,
    bool? includeUnavailable,
    bool clearCategory = false,
    bool clearPrice = false,
  }) => MenuFilters(
    search: search ?? this.search,
    categoryId: clearCategory ? null : (categoryId ?? this.categoryId),
    minPricePaise: clearPrice ? null : (minPricePaise ?? this.minPricePaise),
    maxPricePaise: clearPrice ? null : (maxPricePaise ?? this.maxPricePaise),
    includeAvailable: includeAvailable ?? this.includeAvailable,
    includeUnavailable: includeUnavailable ?? this.includeUnavailable,
  );

  static const none = MenuFilters();
}

class MenuEntry {
  const MenuEntry({required this.item, required this.category});
  final MenuItem item;
  final MenuCategory category;
}

class MenuPageSlice {
  const MenuPageSlice({required this.items, required this.total, required this.page, required this.pageCount, required this.pageSize});
  final List<MenuEntry> items;
  final int total;
  final int page;
  final int pageCount;
  final int pageSize;

  int get from => total == 0 ? 0 : (page - 1) * pageSize + 1;
  int get to => (page - 1) * pageSize + items.length;
}

abstract final class MenuCatalog {
  static List<MenuEntry> flatten(Menu menu) => [
    for (final category in menu.visibleCategories)
      for (final item in category.items) MenuEntry(item: item, category: category),
  ];

  static ({int min, int max}) priceBounds(Iterable<MenuEntry> entries) {
    var min = 0;
    var max = 0;
    var first = true;
    for (final entry in entries) {
      if (first) {
        min = entry.item.pricePaise;
        max = entry.item.pricePaise;
        first = false;
      } else {
        if (entry.item.pricePaise < min) min = entry.item.pricePaise;
        if (entry.item.pricePaise > max) max = entry.item.pricePaise;
      }
    }
    return (min: min, max: max);
  }

  static List<MenuEntry> filter(List<MenuEntry> entries, MenuFilters filters) {
    final query = filters.search.trim().toLowerCase();
    return [
      for (final entry in entries)
        if (_matches(entry, filters, query)) entry,
    ];
  }

  static bool _matches(MenuEntry entry, MenuFilters filters, String query) {
    final item = entry.item;
    if (filters.categoryId != null && entry.category.id != filters.categoryId) return false;
    if (filters.minPricePaise != null && item.pricePaise < filters.minPricePaise!) return false;
    if (filters.maxPricePaise != null && item.pricePaise > filters.maxPricePaise!) return false;
    final available = item.availability == Availability.available;
    if (available && !filters.includeAvailable) return false;
    if (!available && !filters.includeUnavailable) return false;
    if (query.isEmpty) return true;
    final name = item.name.toLowerCase();
    final description = (item.description ?? '').toLowerCase();
    return name.contains(query) || description.contains(query);
  }

  static List<MenuEntry> sort(List<MenuEntry> entries, MenuSort sort) {
    final copy = [...entries];
    switch (sort) {
      case MenuSort.featured:
        return copy;
      case MenuSort.nameAz:
        copy.sort((a, b) => a.item.name.toLowerCase().compareTo(b.item.name.toLowerCase()));
      case MenuSort.priceLow:
        copy.sort((a, b) => a.item.pricePaise.compareTo(b.item.pricePaise));
      case MenuSort.priceHigh:
        copy.sort((a, b) => b.item.pricePaise.compareTo(a.item.pricePaise));
    }
    return copy;
  }

  static MenuPageSlice page({
    required Menu menu,
    MenuFilters filters = MenuFilters.none,
    MenuSort sortBy = MenuSort.featured,
    int page = 1,
    int pageSize = ServeLayout.pageSize,
  }) {
    final filtered = sort(filter(flatten(menu), filters), sortBy);
    final pageCount = filtered.isEmpty ? 1 : ((filtered.length + pageSize - 1) ~/ pageSize);
    final safePage = page.clamp(1, pageCount);
    final start = (safePage - 1) * pageSize;
    final end = (start + pageSize).clamp(0, filtered.length);
    return MenuPageSlice(
      items: filtered.sublist(start, end),
      total: filtered.length,
      page: safePage,
      pageCount: pageCount,
      pageSize: pageSize,
    );
  }
}
