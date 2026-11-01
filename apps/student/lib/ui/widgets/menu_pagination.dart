import 'package:flutter/material.dart';

import '../../theme/serve_theme.dart';

class MenuPagination extends StatelessWidget {
  const MenuPagination({super.key, required this.page, required this.pageCount, required this.onPage, this.compact = false});

  final int page;
  final int pageCount;
  final ValueChanged<int> onPage;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    if (pageCount <= 1) return const SizedBox.shrink();
    final pages = _visiblePages(page, pageCount, compact: compact);
    return Semantics(
      label: 'Menu pages',
      child: Wrap(
        alignment: WrapAlignment.center,
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 6,
        runSpacing: 6,
        children: [
          _PageButton(
            tooltip: 'Previous page',
            icon: Icons.chevron_left_rounded,
            enabled: page > 1,
            onPressed: () => onPage(page - 1),
          ),
          for (final item in pages)
            item == null
                ? const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 4),
                    child: Text('…', style: TextStyle(color: ServeColors.muted, fontWeight: FontWeight.w700)),
                  )
                : _PageButton(label: '$item', selected: item == page, onPressed: () => onPage(item)),
          _PageButton(
            tooltip: 'Next page',
            icon: Icons.chevron_right_rounded,
            enabled: page < pageCount,
            onPressed: () => onPage(page + 1),
          ),
        ],
      ),
    );
  }

  static List<int?> _visiblePages(int page, int pageCount, {required bool compact}) {
    if (pageCount <= (compact ? 5 : 7)) return [for (var i = 1; i <= pageCount; i++) i];
    final window = compact ? 1 : 2;
    final set = <int>{1, pageCount};
    for (var i = page - window; i <= page + window; i++) {
      if (i >= 1 && i <= pageCount) set.add(i);
    }
    final sorted = set.toList()..sort();
    final out = <int?>[];
    for (var i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.add(null);
      out.add(sorted[i]);
    }
    return out;
  }
}

class _PageButton extends StatelessWidget {
  const _PageButton({this.label, this.icon, this.tooltip, this.selected = false, this.enabled = true, required this.onPressed});

  final String? label;
  final IconData? icon;
  final String? tooltip;
  final bool selected;
  final bool enabled;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final child = icon != null ? Icon(icon, size: 20) : Text(label!, style: const TextStyle(fontWeight: FontWeight.w700));
    return Tooltip(
      message: tooltip ?? (label == null ? '' : 'Page $label'),
      child: SizedBox(
        width: 40,
        height: 40,
        child: Material(
          color: selected ? ServeColors.oliveStrong : ServeColors.white,
          shape: CircleBorder(side: BorderSide(color: selected ? ServeColors.oliveStrong : ServeColors.line)),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: enabled && !selected ? onPressed : null,
            child: Center(
              child: IconTheme.merge(
                data: IconThemeData(color: selected ? ServeColors.white : (enabled ? ServeColors.ink : ServeColors.muted)),
                child: DefaultTextStyle.merge(
                  style: TextStyle(color: selected ? ServeColors.white : ServeColors.ink),
                  child: child,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
