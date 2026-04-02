import 'package:boxmatch/app/app_scope.dart';
import 'package:boxmatch/core/i18n/language_menu_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../test_helpers.dart';

void main() {
  testWidgets('language menu button switches locale label', (tester) async {
    final dependencies = await buildTestDependencies(language: 'en');

    await tester.pumpWidget(
      AppScope(
        dependencies: dependencies,
        child: MaterialApp(
          home: Scaffold(
            appBar: AppBar(actions: const [LanguageMenuButton()]),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('EN'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.language_outlined));
    await tester.pumpAndSettle();
    await tester.tap(find.text('繁體中文').last);
    await tester.pumpAndSettle();

    expect(dependencies.localeController.isZhTw, isTrue);
  });
}
