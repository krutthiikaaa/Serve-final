import 'package:flutter/material.dart';

/// SERVE palette (see brand/README.md).
abstract final class ServeColors {
  static const olive = Color(0xFF879F2D);
  static const oliveDark = Color(0xFF6F8425);
  static const oliveTint = Color(0xFFEEF2DC);
  static const orange = Color(0xFFE86A2E);
  static const orangeTint = Color(0xFFFDEEE6);
  static const ink = Color(0xFF111111);
  static const paper = Color(0xFFF8F7F2);
  static const white = Color(0xFFFFFFFF);
  static const muted = Color(0xFF5F6258);
  static const line = Color(0xFFE5E3DA);
  static const danger = Color(0xFFB3261E);
  static const dangerTint = Color(0xFFFBE9E7);
}

ThemeData buildServeTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: ServeColors.olive,
    primary: ServeColors.olive,
    onPrimary: ServeColors.white,
    secondary: ServeColors.orange,
    onSecondary: ServeColors.white,
    surface: ServeColors.white,
    onSurface: ServeColors.ink,
    error: ServeColors.danger,
  );
  final base = ThemeData(useMaterial3: true, colorScheme: scheme);
  final text = base.textTheme.apply(bodyColor: ServeColors.ink, displayColor: ServeColors.ink);
  const radius = BorderRadius.all(Radius.circular(12));
  return base.copyWith(
    scaffoldBackgroundColor: ServeColors.paper,
    textTheme: text.copyWith(
      headlineMedium: text.headlineMedium?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.2),
      headlineSmall: text.headlineSmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.1),
      titleLarge: text.titleLarge?.copyWith(fontWeight: FontWeight.w700),
      titleMedium: text.titleMedium?.copyWith(fontWeight: FontWeight.w700),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: ServeColors.paper,
      foregroundColor: ServeColors.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(color: ServeColors.ink, fontSize: 20, fontWeight: FontWeight.w700),
    ),
    cardTheme: const CardThemeData(
      color: ServeColors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: radius,
        side: BorderSide(color: ServeColors.line),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: ServeColors.olive,
        foregroundColor: ServeColors.white,
        disabledBackgroundColor: ServeColors.line,
        minimumSize: const Size.fromHeight(52),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        shape: const RoundedRectangleBorder(borderRadius: radius),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: ServeColors.ink,
        minimumSize: const Size.fromHeight(52),
        side: const BorderSide(color: ServeColors.line),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        shape: const RoundedRectangleBorder(borderRadius: radius),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: ServeColors.oliveDark,
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
      ),
    ),
    inputDecorationTheme: const InputDecorationTheme(
      filled: true,
      fillColor: ServeColors.white,
      border: OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: ServeColors.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: ServeColors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: ServeColors.olive, width: 2),
      ),
      contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: ServeColors.white,
      indicatorColor: ServeColors.oliveTint,
      surfaceTintColor: Colors.transparent,
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
      selectedColor: ServeColors.ink,
      side: const BorderSide(color: ServeColors.line),
      labelStyle: const TextStyle(fontWeight: FontWeight.w600),
      secondaryLabelStyle: const TextStyle(color: ServeColors.white, fontWeight: FontWeight.w700),
    ),
    snackBarTheme: const SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: ServeColors.ink,
      contentTextStyle: TextStyle(color: ServeColors.white, fontWeight: FontWeight.w600),
    ),
    dividerTheme: const DividerThemeData(color: ServeColors.line, space: 1),
  );
}
