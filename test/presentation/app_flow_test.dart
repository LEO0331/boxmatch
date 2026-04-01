import 'package:boxmatch/app/app.dart';
import 'package:boxmatch/app/app_scope.dart';
import 'package:boxmatch/features/surplus/data/in_memory_surplus_repository.dart';
import 'package:boxmatch/features/surplus/domain/listing_input.dart';
import 'package:boxmatch/features/surplus/domain/listing_visibility.dart';
import 'package:boxmatch/features/surplus/presentation/enterprise/enterprise_listing_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../test_helpers.dart';

ListingInput buildInput(DateTime now) {
  return ListingInput(
    venueId: 'taipei-nangang-exhibition-center-hall-1',
    pickupPointText: 'Booth A-1',
    itemType: 'Lunchbox',
    description: 'Warm lunch',
    quantityTotal: 2,
    price: 0,
    currency: 'TWD',
    pickupStartAt: now.add(const Duration(minutes: 10)),
    pickupEndAt: now.add(const Duration(hours: 1)),
    expiresAt: now.add(const Duration(hours: 2)),
    visibility: ListingVisibility.minimal,
    disclaimerAccepted: true,
  );
}

void main() {
  testWidgets(
    'user can reserve from listing detail and see confirmation page',
    (tester) async {
      final repository = InMemorySurplusRepository();
      final create = await repository.createListing(buildInput(DateTime.now()));
      final dependencies = await buildTestDependencies(repository: repository);

      await tester.pumpWidget(BoxmatchApp(dependencies: dependencies));
      await tester.pumpAndSettle();

      expect(find.textContaining('Lunchbox'), findsWidgets);

      await tester.tap(find.textContaining('Lunchbox').first);
      await tester.pumpAndSettle();

      expect(find.text('Listing details'), findsOneWidget);

      await tester.tap(find.text('Reserve 1 item'));
      await tester.pumpAndSettle();

      expect(find.text('Before reserving'), findsOneWidget);
      await tester.tap(find.byType(CheckboxListTile));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Reserve'));
      await tester.pumpAndSettle();

      expect(find.text('Reservation confirmed'), findsOneWidget);
      expect(find.textContaining('Show this 4-digit code'), findsOneWidget);

      final listing = await repository.watchListing(create.listingId).first;
      expect(listing?.quantityRemaining, 1);
    },
  );

  testWidgets('enterprise post page renders quick template and form', (
    tester,
  ) async {
    final repository = InMemorySurplusRepository();
    final dependencies = await buildTestDependencies(repository: repository);

    await tester.pumpWidget(BoxmatchApp(dependencies: dependencies));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Post'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Quick templates'), findsOneWidget);
    await tester.tap(find.text('Lunchbox Batch'));
    await tester.pumpAndSettle();
    expect(
      find.widgetWithText(TextFormField, 'Pickup point (booth / gate)'),
      findsOneWidget,
    );
    expect(find.widgetWithText(FilledButton, 'Post listing'), findsOneWidget);
  });

  testWidgets('enterprise edit page renders without token error', (
    tester,
  ) async {
    final repository = InMemorySurplusRepository();
    final create = await repository.createListing(buildInput(DateTime.now()));
    await repository.reserveListing(
      listingId: create.listingId,
      claimerUid: 'recipient-1',
      qty: 1,
      disclaimerAccepted: true,
    );

    final dependencies = await buildTestDependencies(repository: repository);

    await tester.pumpWidget(
      AppScope(
        dependencies: dependencies,
        child: MaterialApp(
          home: EnterpriseListingPage(
            listingId: create.listingId,
            token: create.editToken,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 600));
    expect(find.textContaining('Invalid or revoked edit token.'), findsNothing);
    expect(
      find.widgetWithText(TextFormField, 'Pickup point (booth / gate)'),
      findsOneWidget,
    );
  });

  testWidgets(
    'enterprise edit supports rotate/revoke dialogs and reservation section',
    (tester) async {
      final repository = InMemorySurplusRepository();
      final create = await repository.createListing(buildInput(DateTime.now()));
      final reservation = await repository.reserveListing(
        listingId: create.listingId,
        claimerUid: 'recipient-2',
        qty: 1,
        disclaimerAccepted: true,
      );
      final dependencies = await buildTestDependencies(repository: repository);

      await tester.pumpWidget(
        AppScope(
          dependencies: dependencies,
          child: MaterialApp(
            home: EnterpriseListingPage(
              listingId: create.listingId,
              token: create.editToken,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      final scrollable = find.byType(Scrollable).first;

      final rotateButton = find.widgetWithText(OutlinedButton, 'Rotate token');
      await tester.scrollUntilVisible(
        rotateButton,
        350,
        scrollable: scrollable,
      );
      await tester.tap(rotateButton);
      await tester.pumpAndSettle();
      expect(find.text('Rotate edit token?'), findsOneWidget);
      await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
      await tester.pumpAndSettle();

      final revokeButton = find.widgetWithText(OutlinedButton, 'Revoke token');
      await tester.scrollUntilVisible(
        revokeButton,
        350,
        scrollable: scrollable,
      );
      await tester.tap(revokeButton);
      await tester.pumpAndSettle();
      expect(find.text('Revoke edit token?'), findsOneWidget);
      await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
      await tester.pumpAndSettle();

      final codeField = find.widgetWithText(
        TextField,
        'Enter 4-digit pickup code',
      );
      await tester.scrollUntilVisible(codeField, 350, scrollable: scrollable);
      await tester.enterText(codeField.first, reservation.pickupCode);

      final confirmButton = find.widgetWithText(FilledButton, 'Confirm pickup');
      await tester.scrollUntilVisible(
        confirmButton,
        350,
        scrollable: scrollable,
      );
      await tester.tap(confirmButton.first);
      await tester.pumpAndSettle();

      final confirmed = await repository.watchReservation(reservation.id).first;
      expect(confirmed?.status.name, 'completed');
    },
  );
}
