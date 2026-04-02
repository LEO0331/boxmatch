import 'package:boxmatch/app/app_scope.dart';
import 'package:boxmatch/features/surplus/data/in_memory_surplus_repository.dart';
import 'package:boxmatch/features/surplus/domain/listing_input.dart';
import 'package:boxmatch/features/surplus/domain/listing_visibility.dart';
import 'package:boxmatch/features/surplus/presentation/enterprise/enterprise_listing_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../test_helpers.dart';

ListingInput _input(DateTime now) {
  return ListingInput(
    venueId: 'taipei-nangang-exhibition-center-hall-1',
    pickupPointText: 'Booth E-3',
    itemType: 'Lunchbox',
    description: 'Enterprise test item',
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

Future<void> _pumpPage(
  WidgetTester tester, {
  required InMemorySurplusRepository repo,
  String? listingId,
  String? token,
}) async {
  final deps = await buildTestDependencies(repository: repo);
  tester.view.devicePixelRatio = 1.0;
  tester.view.physicalSize = const Size(1200, 2400);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    AppScope(
      dependencies: deps,
      child: MaterialApp(
        home: EnterpriseListingPage(listingId: listingId, token: token),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('create mode can submit and shows secure link + copy action', (
    tester,
  ) async {
    final repo = InMemorySurplusRepository();
    await _pumpPage(tester, repo: repo);

    await tester.tap(find.text('Lunchbox Batch'));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Pickup point (booth / gate)'),
      'Hall 1 Gate A',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Simple description'),
      'Updated by widget test',
    );

    final disclaimerFinder = find.byType(CheckboxListTile).first;
    final scrollable = find.byType(Scrollable).first;
    await tester.scrollUntilVisible(
      disclaimerFinder,
      250,
      scrollable: scrollable,
    );
    await tester.tap(disclaimerFinder);
    await tester.pumpAndSettle();

    final postButton = find.widgetWithText(FilledButton, 'Post listing');
    await tester.scrollUntilVisible(postButton, 250, scrollable: scrollable);
    await tester.tap(postButton);
    await tester.pumpAndSettle();

    expect(find.textContaining('Save this edit link securely'), findsOneWidget);
    expect(find.textContaining('Listing posted.'), findsOneWidget);

    final copyButton = find.widgetWithText(OutlinedButton, 'Copy link');
    await tester.scrollUntilVisible(copyButton, 250, scrollable: scrollable);
    await tester.tap(copyButton);
    await tester.pumpAndSettle();
    expect(find.widgetWithText(OutlinedButton, 'Copy link'), findsOneWidget);
  });

  testWidgets('edit mode shows missing token message when token absent', (
    tester,
  ) async {
    final repo = InMemorySurplusRepository();
    final created = await repo.createListing(_input(DateTime.now()));

    await _pumpPage(tester, repo: repo, listingId: created.listingId);

    expect(find.textContaining('Missing edit token'), findsOneWidget);
  });

  testWidgets('edit mode shows invalid token message when token mismatch', (
    tester,
  ) async {
    final repo = InMemorySurplusRepository();
    final created = await repo.createListing(_input(DateTime.now()));

    await _pumpPage(
      tester,
      repo: repo,
      listingId: created.listingId,
      token: 'wrong-token',
    );

    expect(
      find.textContaining('Invalid token'),
      findsOneWidget,
    );
  });

  testWidgets('revoke token flow disables token action buttons', (
    tester,
  ) async {
    final repo = InMemorySurplusRepository();
    final created = await repo.createListing(_input(DateTime.now()));

    await _pumpPage(
      tester,
      repo: repo,
      listingId: created.listingId,
      token: created.editToken,
    );

    final scrollable = find.byType(Scrollable).first;
    final revokeButton = find
        .widgetWithText(OutlinedButton, 'Revoke token')
        .first;
    await tester.scrollUntilVisible(revokeButton, 300, scrollable: scrollable);
    await tester.tap(revokeButton);
    await tester.pumpAndSettle();

    expect(find.text('Revoke edit token?'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Revoke'));
    await tester.pumpAndSettle();

    final rotateButtonWidget = tester.widget<OutlinedButton>(
      find.widgetWithText(OutlinedButton, 'Rotate token'),
    );
    final revokeButtonWidget = tester.widget<OutlinedButton>(
      find.widgetWithText(OutlinedButton, 'Revoke token'),
    );

    expect(rotateButtonWidget.onPressed, isNull);
    expect(revokeButtonWidget.onPressed, isNull);
    expect(find.textContaining('Edit token revoked.'), findsOneWidget);
  });

  testWidgets('confirm pickup with empty code shows validation snackbar', (
    tester,
  ) async {
    final repo = InMemorySurplusRepository();
    final created = await repo.createListing(_input(DateTime.now()));
    await repo.reserveListing(
      listingId: created.listingId,
      claimerUid: 'recipient-x',
      qty: 1,
      disclaimerAccepted: true,
    );

    await _pumpPage(
      tester,
      repo: repo,
      listingId: created.listingId,
      token: created.editToken,
    );

    final scrollable = find.byType(Scrollable).first;
    final confirmButton = find
        .widgetWithText(FilledButton, 'Confirm pickup')
        .first;
    await tester.scrollUntilVisible(confirmButton, 300, scrollable: scrollable);
    await tester.tap(confirmButton);
    await tester.pumpAndSettle();

    expect(find.text('Enter pickup code first.'), findsOneWidget);
  });

  testWidgets('edit mode can submit update successfully', (tester) async {
    final repo = InMemorySurplusRepository();
    final created = await repo.createListing(_input(DateTime.now()));

    await _pumpPage(
      tester,
      repo: repo,
      listingId: created.listingId,
      token: created.editToken,
    );

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Simple description'),
      'Edited description',
    );

    final updateButton = find.widgetWithText(FilledButton, 'Update listing');
    final scrollable = find.byType(Scrollable).first;
    await tester.scrollUntilVisible(updateButton, 250, scrollable: scrollable);
    await tester.tap(updateButton);
    await tester.pumpAndSettle();

    expect(find.text('Listing updated.'), findsOneWidget);
  });
}
