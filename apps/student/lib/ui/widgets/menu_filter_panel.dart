import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../services/api/models.dart';
import '../../theme/serve_theme.dart';
import '../menu/menu_catalog.dart';

class MenuFilterPanel extends StatelessWidget {
  const MenuFilterPanel({
    super.key,
    required this.menu,
    required this.draft,
    required this.onDraftChanged,
    required this.onApply,
    required this.onClear,
    this.embedded = false,
  });

  final Menu menu;
  final MenuFilters draft;
  final ValueChanged<MenuFilters> onDraftChanged;
  final VoidCallback onApply;
  final VoidCallback onClear;
  final bool embedded;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final categories = menu.visibleCategories;
    final bounds = MenuCatalog.priceBounds(MenuCatalog.flatten(menu));
    final hasPriceRange = bounds.max > bounds.min;
    final min = (draft.minPricePaise ?? bounds.min).toDouble();
    final max = (draft.maxPricePaise ?? bounds.max).toDouble();
    final child = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Filters', style: theme.textTheme.titleMedium?.copyWith(color: ServeColors.oliveInk)),
        const SizedBox(height: 14),
        _FilterSection(
          title: 'Category',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _FilterChoice(label: 'All', selected: draft.categoryId == null, onTap: () => onDraftChanged(draft.copyWith(clearCategory: true))),
              for (final category in categories)
                _FilterChoice(
                  label: category.name,
                  selected: draft.categoryId == category.id,
                  onTap: () => onDraftChanged(draft.copyWith(categoryId: category.id)),
                ),
            ],
          ),
        ),
        if (hasPriceRange) ...[
          const SizedBox(height: 12),
          _FilterSection(
            title: 'Price range',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${formatRupees(min.round())} – ${formatRupees(max.round())}', style: theme.textTheme.bodySmall),
                RangeSlider(
                  values: RangeValues(min.clamp(bounds.min.toDouble(), bounds.max.toDouble()), max.clamp(bounds.min.toDouble(), bounds.max.toDouble())),
                  min: bounds.min.toDouble(),
                  max: bounds.max.toDouble(),
                  divisions: ((bounds.max - bounds.min) / 100).clamp(1, 40).round(),
                  labels: RangeLabels(formatRupees(min.round()), formatRupees(max.round())),
                  onChanged: (value) => onDraftChanged(draft.copyWith(minPricePaise: value.start.round(), maxPricePaise: value.end.round())),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 12),
        _FilterSection(
          title: 'Availability',
          child: Column(
            children: [
              CheckboxListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                tileColor: Colors.transparent,
                value: draft.includeAvailable,
                onChanged: (value) => onDraftChanged(draft.copyWith(includeAvailable: value ?? true)),
                title: const Text('Available'),
                controlAffinity: ListTileControlAffinity.leading,
              ),
              CheckboxListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                tileColor: Colors.transparent,
                value: draft.includeUnavailable,
                onChanged: (value) => onDraftChanged(draft.copyWith(includeUnavailable: value ?? true)),
                title: const Text('Unavailable'),
                controlAffinity: ListTileControlAffinity.leading,
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        FilledButton(onPressed: onApply, child: const Text('Apply filters')),
        const SizedBox(height: 8),
        OutlinedButton(onPressed: onClear, child: const Text('Clear filters')),
      ],
    );
    if (embedded) return child;
    return Material(
      color: ServeColors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(ServeSpace.radiusCard),
        side: const BorderSide(color: ServeColors.line),
      ),
      clipBehavior: Clip.antiAlias,
      child: Padding(padding: const EdgeInsets.fromLTRB(18, 18, 18, 16), child: child),
    );
  }
}

class _FilterSection extends StatelessWidget {
  const _FilterSection({required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: ServeColors.surfaceMuted,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            child,
          ],
        ),
      ),
    );
  }
}

class _FilterChoice extends StatelessWidget {
  const _FilterChoice({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: selected ? ServeColors.oliveTint : ServeColors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
          side: BorderSide(color: selected ? ServeColors.oliveStrong : ServeColors.line),
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontWeight: FontWeight.w600, color: selected ? ServeColors.oliveInk : ServeColors.ink),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
