import 'package:flutter/material.dart';

/// SERVE palette (see brand/README.md) plus a few shades derived from it.
///
/// Contrast: white text needs [oliveStrong] (4.7:1), not the lighter brand
/// olive (3:1); olive text on light surfaces uses [oliveInk] (6.4:1).
abstract final class ServeColors {
  // Brand.
  static const olive = Color(0xFF879F2D);
  static const oliveDark = Color(0xFF6F8425);
  static const orange = Color(0xFFE86A2E);
  static const ink = Color(0xFF111111);
  static const paper = Color(0xFFF8F7F2);
  static const white = Color(0xFFFFFFFF);

  // Derived.
  static const oliveStrong = Color(0xFF687C24);
  static const oliveInk = Color(0xFF55661C);
  static const oliveTint = Color(0xFFEEF2DC);
  static const orangeStrong = Color(0xFFC4521C);
  static const orangeInk = Color(0xFF9A3F14);
  static const orangeTint = Color(0xFFFCEBE1);
  static const muted = Color(0xFF5F6258);
  static const line = Color(0xFFE7E4DA);
  static const surfaceMuted = Color(0xFFF1EFE7);
  static const danger = Color(0xFFB3261E);
  static const dangerTint = Color(0xFFFBE9E7);
}

/// Spacing and radii shared by every screen.
abstract final class ServeSpace {
  static const page = 20.0;
  static const section = 28.0;
  static const radiusCard = 16.0;
  static const radiusControl = 12.0;
}

ThemeData buildServeTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: ServeColors.olive,
    primary: ServeColors.oliveStrong,
    onPrimary: ServeColors.white,
    primaryContainer: ServeColors.oliveTint,
    onPrimaryContainer: ServeColors.oliveInk,
    secondary: ServeColors.orangeStrong,
    onSecondary: ServeColors.white,
    surface: ServeColors.white,
    onSurface: ServeColors.ink,
    onSurfaceVariant: ServeColors.muted,
    outline: ServeColors.line,
    outlineVariant: ServeColors.line,
    error: ServeColors.danger,
  );
  final base = ThemeData(useMaterial3: true, colorScheme: scheme);
  final t = base.textTheme.apply(bodyColor: ServeColors.ink, displayColor: ServeColors.ink);
  const control = BorderRadius.all(Radius.circular(ServeSpace.radiusControl));
  const card = BorderRadius.all(Radius.circular(ServeSpace.radiusCard));
  return base.copyWith(
    scaffoldBackgroundColor: ServeColors.paper,
    textTheme: t.copyWith(
      displaySmall: t.displaySmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: 1.5),
      headlineMedium: t.headlineMedium?.copyWith(fontSize: 28, fontWeight: FontWeight.w700, letterSpacing: -0.4, height: 1.2),
      headlineSmall: t.headlineSmall?.copyWith(fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: -0.3, height: 1.25),
      titleLarge: t.titleLarge?.copyWith(fontSize: 19, fontWeight: FontWeight.w700, letterSpacing: -0.1),
      titleMedium: t.titleMedium?.copyWith(fontSize: 16, fontWeight: FontWeight.w600),
      titleSmall: t.titleSmall?.copyWith(fontWeight: FontWeight.w600),
      bodyLarge: t.bodyLarge?.copyWith(height: 1.45),
      bodyMedium: t.bodyMedium?.copyWith(height: 1.4),
      bodySmall: t.bodySmall?.copyWith(color: ServeColors.muted, height: 1.35),
      labelLarge: t.labelLarge?.copyWith(fontWeight: FontWeight.w600),
      labelSmall: t.labelSmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.8),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: ServeColors.paper,
      foregroundColor: ServeColors.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(color: ServeColors.ink, fontSize: 18, fontWeight: FontWeight.w700),
    ),
    cardTheme: const CardThemeData(
      color: ServeColors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: card,
        side: BorderSide(color: ServeColors.line),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: ServeColors.oliveStrong,
        foregroundColor: ServeColors.white,
        disabledBackgroundColor: ServeColors.surfaceMuted,
        disabledForegroundColor: ServeColors.muted,
        minimumSize: const Size.fromHeight(52),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        shape: const RoundedRectangleBorder(borderRadius: control),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: ServeColors.ink,
        backgroundColor: ServeColors.white,
        minimumSize: const Size.fromHeight(52),
        side: const BorderSide(color: ServeColors.line),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        shape: const RoundedRectangleBorder(borderRadius: control),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: ServeColors.oliveInk,
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
        shape: const RoundedRectangleBorder(borderRadius: control),
      ),
    ),
    inputDecorationTheme: const InputDecorationTheme(
      filled: true,
      fillColor: ServeColors.white,
      floatingLabelStyle: TextStyle(color: ServeColors.oliveInk, fontWeight: FontWeight.w600),
      helperStyle: TextStyle(color: ServeColors.muted),
      border: OutlineInputBorder(
        borderRadius: control,
        borderSide: BorderSide(color: ServeColors.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: control,
        borderSide: BorderSide(color: ServeColors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: control,
        borderSide: BorderSide(color: ServeColors.oliveStrong, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: control,
        borderSide: BorderSide(color: ServeColors.danger),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: control,
        borderSide: BorderSide(color: ServeColors.danger, width: 2),
      ),
      contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: ServeColors.white,
      indicatorColor: ServeColors.oliveTint,
      surfaceTintColor: Colors.transparent,
      height: 68,
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(color: states.contains(WidgetState.selected) ? ServeColors.oliveInk : ServeColors.muted),
      ),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontSize: 12,
          fontWeight: states.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w500,
          color: states.contains(WidgetState.selected) ? ServeColors.ink : ServeColors.muted,
        ),
      ),
    ),
    chipTheme: base.chipTheme.copyWith(
      backgroundColor: ServeColors.white,
      selectedColor: ServeColors.oliveStrong,
      side: const BorderSide(color: ServeColors.line),
      shape: const StadiumBorder(),
      labelStyle: const TextStyle(fontWeight: FontWeight.w600, color: ServeColors.ink),
      secondaryLabelStyle: const TextStyle(color: ServeColors.white, fontWeight: FontWeight.w700),
    ),
    tabBarTheme: const TabBarThemeData(
      labelColor: ServeColors.ink,
      unselectedLabelColor: ServeColors.muted,
      labelStyle: TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
      unselectedLabelStyle: TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
      indicatorSize: TabBarIndicatorSize.tab,
      dividerColor: Colors.transparent,
      indicator: BoxDecoration(
        color: ServeColors.white,
        borderRadius: BorderRadius.all(Radius.circular(10)),
        boxShadow: [BoxShadow(color: Color(0x14000000), blurRadius: 4, offset: Offset(0, 1))],
      ),
    ),
    dialogTheme: const DialogThemeData(
      backgroundColor: ServeColors.white,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(20))),
    ),
    snackBarTheme: const SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: ServeColors.ink,
      shape: RoundedRectangleBorder(borderRadius: control),
      contentTextStyle: TextStyle(color: ServeColors.white, fontWeight: FontWeight.w600),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: ServeColors.olive, linearTrackColor: ServeColors.oliveTint),
    dividerTheme: const DividerThemeData(color: ServeColors.line, space: 1),
    listTileTheme: const ListTileThemeData(iconColor: ServeColors.oliveInk, contentPadding: EdgeInsets.symmetric(horizontal: 16)),
  );
}
