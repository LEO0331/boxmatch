import 'package:flutter/material.dart';

ThemeData buildAppTheme() {
  final base = ThemeData(
    colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0B6E4F)),
    useMaterial3: true,
  );

  return base.copyWith(
    appBarTheme: base.appBarTheme.copyWith(centerTitle: false),
    cardTheme: base.cardTheme.copyWith(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      clipBehavior: Clip.antiAlias,
    ),
    inputDecorationTheme: const InputDecorationTheme(
      border: OutlineInputBorder(),
      isDense: true,
    ),
  );
}
