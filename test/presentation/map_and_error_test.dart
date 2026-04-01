import 'package:boxmatch/core/widgets/load_error_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('load error view renders and retry callback works', (
    tester,
  ) async {
    var tapped = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: LoadErrorView(
          title: 'Unable to load',
          message: 'Please retry',
          retryLabel: 'Retry',
          onRetry: () {
            tapped++;
          },
        ),
      ),
    );

    expect(find.text('Unable to load'), findsOneWidget);
    expect(find.text('Please retry'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'Retry'));
    await tester.pump();
    expect(tapped, 1);
  });
}
