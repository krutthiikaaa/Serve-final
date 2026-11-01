import 'serve_theme.dart';

/// Responsive breakpoints for the student app. Mobile stays phone-first;
/// the sidebar / header-nav layout starts at tablet-landscape / desktop.
abstract final class ServeLayout {
  static const compactMax = 599.0;
  static const sidebarMin = 1024.0;
  static const wideMin = 1280.0;
  static const contentMax = 1280.0;
  static const sidebarWidth = 280.0;
  static const pageSize = 12;

  static bool showSidebar(double width) => width >= sidebarMin;
  static bool showHeaderNav(double width) => width >= sidebarMin;
  static bool hideBottomNav(double width) => width >= sidebarMin;

  static double pagePadding(double width) => width < 360 ? 12 : ServeSpace.page;

  static int gridColumns(double contentWidth) {
    if (contentWidth < 300) return 1;
    if (contentWidth < 640) return 2;
    if (contentWidth < 900) return 3;
    return 4;
  }

  /// Home Most Ordered: two columns on phones, three on desktop widths.
  static int homeColumns(double contentWidth) {
    if (contentWidth < 340) return 1;
    if (contentWidth < 900) return 2;
    return 3;
  }

  /// Medium card: 16:9 image plus a short name/price block.
  static double cardExtent(double maxWidth, int columns, bool compact) {
    final cardWidth = (maxWidth - 10 * (columns - 1)) / columns;
    return cardWidth * 9 / 16 + (compact ? 70 : 78);
  }

  /// Home cards include a two-line description under the name.
  static double homeCardExtent(double maxWidth, int columns) {
    final cardWidth = (maxWidth - 12 * (columns - 1)) / columns;
    return cardWidth * 9 / 16 + (columns >= 3 ? 124 : 118);
  }
}
