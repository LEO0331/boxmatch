import 'package:boxmatch/app/app.dart';
import 'package:boxmatch/features/surplus/data/in_memory_surplus_repository.dart';
import 'package:boxmatch/features/surplus/domain/listing_input.dart';
import 'package:boxmatch/features/surplus/domain/listing_visibility.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../test_helpers.dart';

ListingInput _input(DateTime now) {
  return ListingInput(
    venueId: 'taipei-nangang-exhibition-center-hall-1',
    pickupPointText: 'Hall 1 Gate A',
    itemType: 'Lunchbox',
    description: 'Shell nav test',
    quantityTotal: 2,
    price: 0,
    currency: 'TWD',
    pickupStartAt: now.add(const Duration(minutes: 20)),
    pickupEndAt: now.add(const Duration(hours: 1)),
    expiresAt: now.add(const Duration(hours: 2)),
    visibility: ListingVisibility.minimal,
    disclaimerAccepted: true,
  );
}

void main() {
  testWidgets('shows bottom navigation on narrow width', (tester) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final repo = InMemorySurplusRepository();
    await repo.createListing(_input(DateTime.now()));
    final deps = await buildTestDependencies(repository: repo);

    await tester.pumpWidget(BoxmatchApp(dependencies: deps));
    await tester.pumpAndSettle();

    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.byType(NavigationRail), findsNothing);
  });

  testWidgets('shows navigation rail on wide width', (tester) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(1280, 900);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final repo = InMemorySurplusRepository();
    await repo.createListing(_input(DateTime.now()));
    final deps = await buildTestDependencies(repository: repo);

    await tester.pumpWidget(BoxmatchApp(dependencies: deps));
    await tester.pumpAndSettle();

    expect(find.byType(NavigationRail), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
  });
}
