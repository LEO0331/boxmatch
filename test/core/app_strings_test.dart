import 'package:boxmatch/app/app_scope.dart';
import 'package:boxmatch/core/i18n/app_strings.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../test_helpers.dart';

void main() {
  testWidgets('app strings returns english labels', (tester) async {
    final dependencies = await buildTestDependencies(language: 'en');

    late AppStrings strings;
    await tester.pumpWidget(
      AppScope(
        dependencies: dependencies,
        child: MaterialApp(
          home: Builder(
            builder: (context) {
              strings = AppStrings.of(context);
              return Text(strings.navListings);
            },
          ),
        ),
      ),
    );

    expect(find.text('Listings'), findsOneWidget);
    expect(strings.statusLabel(AppStatusLabel.completed), 'Completed');
    expect(strings.mapSource('OSM'), contains('OSM'));
  });

  testWidgets('app strings returns zh-TW labels', (tester) async {
    final dependencies = await buildTestDependencies(language: 'zh-TW');

    await tester.pumpWidget(
      AppScope(
        dependencies: dependencies,
        child: MaterialApp(
          home: Builder(
            builder: (context) {
              final strings = AppStrings.of(context);
              return Text(strings.navMap);
            },
          ),
        ),
      ),
    );

    expect(find.text('地圖'), findsOneWidget);
  });
}
