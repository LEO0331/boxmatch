import 'package:boxmatch/app/app_router.dart';
import 'package:boxmatch/app/app_scope.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../test_helpers.dart';

Future<void> _pumpRouterApp(WidgetTester tester, GoRouter router) async {
  final dependencies = await buildTestDependencies();
  await tester.pumpWidget(
    AppScope(
      dependencies: dependencies,
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('parseEnterpriseEditTokenFromFragment', () {
    test('returns token when fragment contains query token', () {
      final token = parseEnterpriseEditTokenFromFragment(
        '/enterprise/edit/demo-id?token=abc123',
      );
      expect(token, 'abc123');
    });

    test('supports fragment without leading slash', () {
      final token = parseEnterpriseEditTokenFromFragment(
        'enterprise/edit/demo-id?token=fragment-token',
      );
      expect(token, 'fragment-token');
    });

    test('returns null for empty fragment', () {
      final token = parseEnterpriseEditTokenFromFragment('');
      expect(token, isNull);
    });

    test('returns null when token missing or empty', () {
      expect(
        parseEnterpriseEditTokenFromFragment('/enterprise/edit/demo-id'),
        isNull,
      );
      expect(
        parseEnterpriseEditTokenFromFragment(
          '/enterprise/edit/demo-id?token=',
        ),
        isNull,
      );
    });

    test('returns null for malformed fragment URI input', () {
      final token = parseEnterpriseEditTokenFromFragment(
        '/enterprise/edit/demo-id?token=%E0%A4%A',
      );
      expect(token, isNull);
    });
  });

  group('buildRouter', () {
    testWidgets('can navigate to shell routes and detail routes', (
      tester,
    ) async {
      final router = buildRouter();
      await _pumpRouterApp(tester, router);

      expect(find.text('Exhibition Surplus Food'), findsOneWidget);

      router.go('/enterprise/new');
      await tester.pumpAndSettle();
      expect(find.text('Post listing'), findsWidgets);

      router.go('/listing/missing-listing');
      await tester.pumpAndSettle();
      expect(find.text('Listing not found.'), findsOneWidget);

      router.go('/listing/missing-listing/reservation/missing-reservation');
      await tester.pumpAndSettle();
      expect(find.text('Reservation not found.'), findsOneWidget);
    });

    testWidgets('enterprise edit route reads query token', (tester) async {
      final router = buildRouter();
      await _pumpRouterApp(tester, router);

      router.go('/enterprise/edit/demo-id?token=query-token');
      await tester.pumpAndSettle();

      expect(find.textContaining('Missing edit token'), findsNothing);
      expect(find.textContaining('Invalid token'), findsOneWidget);
    });
  });
}
