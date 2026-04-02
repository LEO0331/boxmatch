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
    expect(strings.frequentEnterprise, 'Frequent enterprise');
    expect(strings.privacyFaqTitle, 'Privacy & FAQ');
    expect(strings.privacyNotice, contains('Boxmatch'));
    expect(strings.faqNotice, contains('Report safety concern'));
    expect(strings.reportRiskSelectReasonTitle, 'Select a reason');
    expect(strings.riskReasonSuspiciousBehavior, contains('Suspicious'));
    expect(strings.highImpactEnterprise, 'High-impact donor');
    expect(strings.flexiblePickupEnterprise, contains('Flexible'));
    expect(strings.stableShelfLifeEnterprise, contains('Stable'));
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
              return Column(
                children: [
                  Text(strings.navMap),
                  Text(strings.frequentEnterprise),
                  Text(strings.privacyFaqTitle),
                  Text(strings.reportRiskSelectReasonTitle),
                  Text(strings.highImpactEnterprise),
                ],
              );
            },
          ),
        ),
      ),
    );

    expect(find.text('地圖'), findsOneWidget);
    expect(find.text('常態捐贈企業'), findsOneWidget);
    expect(find.text('隱私與常見問題'), findsOneWidget);
    expect(find.text('請選擇回報原因'), findsOneWidget);
    expect(find.text('高量捐贈企業'), findsOneWidget);
  });
}
