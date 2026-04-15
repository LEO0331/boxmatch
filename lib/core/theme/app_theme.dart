import 'package:flutter/material.dart';

class BoxmatchColors {
  static const seed = Color(0xFF2D6A4F);
  static const warmSurface = Color(0xFFF6FAF5);
  static const warmSurfaceAlt = Color(0xFFEDF5E9);
  static const warmAccent = Color(0xFFE9F6E6);
  static const warmBorder = Color(0xFFBCD8BF);
  static const warmWarningBg = Color(0xFFFFF4E0);
  static const warmWarningText = Color(0xFF7A4A00);
  static const warmDangerBg = Color(0xFFFFEBE9);
  static const warmDangerText = Color(0xFF8F2D2D);
  static const warmSuccessBg = Color(0xFFEAF8ED);
}

ThemeData buildAppTheme() {
  final base = ThemeData(
    colorScheme: ColorScheme.fromSeed(
      seedColor: BoxmatchColors.seed,
      brightness: Brightness.light,
    ),
    useMaterial3: true,
  );

  return base.copyWith(
    scaffoldBackgroundColor: BoxmatchColors.warmSurface,
    textTheme: base.textTheme.copyWith(
      titleLarge: base.textTheme.titleLarge?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -0.2,
      ),
      titleMedium: base.textTheme.titleMedium?.copyWith(
        fontWeight: FontWeight.w600,
      ),
      titleSmall: base.textTheme.titleSmall?.copyWith(
        fontWeight: FontWeight.w600,
      ),
      bodyMedium: base.textTheme.bodyMedium?.copyWith(height: 1.35),
      bodySmall: base.textTheme.bodySmall?.copyWith(height: 1.35),
    ),
    appBarTheme: base.appBarTheme.copyWith(
      centerTitle: false,
      backgroundColor: BoxmatchColors.warmSurfaceAlt,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      titleTextStyle: base.textTheme.titleLarge?.copyWith(
        color: const Color(0xFF22352A),
        fontWeight: FontWeight.w700,
        letterSpacing: -0.2,
      ),
    ),
    cardTheme: base.cardTheme.copyWith(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      clipBehavior: Clip.antiAlias,
      color: Colors.white,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: BoxmatchColors.warmBorder),
      ),
    ),
    inputDecorationTheme: const InputDecorationTheme(
      border: OutlineInputBorder(),
      isDense: true,
    ),
    chipTheme: base.chipTheme.copyWith(
      side: const BorderSide(color: BoxmatchColors.warmBorder),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
    ),
  );
}
