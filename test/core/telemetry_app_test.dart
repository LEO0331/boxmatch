import 'package:boxmatch/app/app.dart';
import 'package:boxmatch/app/app_dependencies.dart';
import 'package:boxmatch/core/telemetry/visit_environment.dart';
import 'package:boxmatch/core/telemetry/visit_tracker.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../test_helpers.dart';

void main() {
  testWidgets(
    'widget rebuilds and repeated app initialization share one initial visit',
    (tester) async {
      int requests = 0;
      final base = await buildTestDependencies(usingFirebase: true);
      final tracker = VisitTracker(
        apiBaseUrl: 'https://api.example.com',
        readEnvironment: () =>
            VisitEnvironment(uri: Uri.parse('https://example.com')),
        client: MockClient((_) async {
          requests++;
          return http.Response('', 204);
        }),
      );
      final dependencies = AppDependencies(
        repository: base.repository,
        identityService: base.identityService,
        usingFirebase: true,
        localeController: base.localeController,
        favoritesStore: base.favoritesStore,
        visitTracker: tracker,
      );
      await tester.pumpWidget(BoxmatchApp(dependencies: dependencies));
      await tester.pumpAndSettle();
      await tester.pumpWidget(BoxmatchApp(dependencies: dependencies));
      await tester.pumpAndSettle();
      expect(requests, 1);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(BoxmatchApp(dependencies: dependencies));
      await tester.pumpAndSettle();
      expect(requests, 1);
    },
  );
}
