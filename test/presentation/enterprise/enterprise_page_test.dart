import 'package:boxmatch/app/app_scope.dart';
import 'package:boxmatch/features/surplus/data/in_memory_surplus_repository.dart';
import 'package:boxmatch/features/surplus/domain/listing_input.dart';
import 'package:boxmatch/features/surplus/domain/listing_visibility.dart';
import 'package:boxmatch/features/surplus/domain/reservation.dart';
import 'package:boxmatch/features/surplus/domain/surplus_exceptions.dart';
import 'package:boxmatch/features/surplus/domain/venue.dart';
import 'package:boxmatch/features/surplus/presentation/enterprise/enterprise_listing_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../test_helpers.dart';

class _EnterpriseInstrumentedRepository extends InMemorySurplusRepository {
  bool venuesStreamError = false;
  bool reservationsStreamError = false;
  bool emptyVenues = false;
  bool throwOnCreate = false;
  bool throwOnUpdate = false;
  bool throwOnRotate = false;
  bool throwOnRevoke = false;
  bool throwOnConfirmPickup = false;

  @override
  Stream<List<Venue>> watchVenues() {
    if (venuesStreamError) {
      return Stream.error(StateError('venue stream failed'));
    }
    if (emptyVenues) {
      return Stream<List<Venue>>.value(const <Venue>[]);
    }
    return super.watchVenues();
  }

  @override
  Stream<List<Reservation>> watchReservationsForListing({
    required String listingId,
    required String token,
  }) {
    if (reservationsStreamError) {
      return Stream.error(StateError('reservations stream failed'));
    }
    return super.watchReservationsForListing(listingId: listingId, token: token);
  }

  @override
  Future<CreatedListingResult> createListing(ListingInput input) {
    if (throwOnCreate) {
      throw const ValidationException('Create failed for test.');
    }
    return super.createListing(input);
  }

  @override
  Future<void> updateListing({
    required String listingId,
    required String token,
    required ListingInput input,
  }) {
    if (throwOnUpdate) {
      throw const ValidationException('Update failed for test.');
    }
    return super.updateListing(listingId: listingId, token: token, input: input);
  }

  @override
  Future<String> rotateEditToken({
    required String listingId,
    required String token,
  }) {
    if (throwOnRotate) {
      throw const ValidationException('Rotate failed for test.');
    }
    return super.rotateEditToken(listingId: listingId, token: token);
  }

  @override
  Future<void> revokeEditToken({
    required String listingId,
    required String token,
  }) {
    if (throwOnRevoke) {
      throw const ValidationException('Revoke failed for test.');
    }
    return super.revokeEditToken(listingId: listingId, token: token);
  }

  @override
  Future<void> confirmPickup({
    required String listingId,
    required String reservationId,
    required String token,
    required String pickupCode,
  }) {
    if (throwOnConfirmPickup) {
      throw const ValidationException('Confirm failed for test.');
    }
    return super.confirmPickup(
      listingId: listingId,
      reservationId: reservationId,
      token: token,
      pickupCode: pickupCode,
    );
  }
}

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
  bool usingFirebase = false,
}) async {
  final deps = await buildTestDependencies(
    repository: repo,
    usingFirebase: usingFirebase,
  );
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

  testWidgets(
    'create mode shows template analytics and can apply venue default pickup',
    (tester) async {
      final repo = InMemorySurplusRepository();
      await _pumpPage(tester, repo: repo);

      expect(find.textContaining('Template performance'), findsOneWidget);
      expect(find.byIcon(Icons.restart_alt_outlined), findsOneWidget);

      await tester.tap(find.byType(DropdownButtonFormField<String>).first);
      await tester.pumpAndSettle();
      await tester.tap(
        find.text('Taipei Nangang Exhibition Center Hall 2').last,
      );
      await tester.pumpAndSettle();

      await tester.tap(
        find.widgetWithText(OutlinedButton, 'Use venue default pickup point'),
      );
      await tester.pumpAndSettle();

      final pickupField = tester.widget<TextFormField>(
        find.widgetWithText(TextFormField, 'Pickup point (booth / gate)'),
      );
      expect(pickupField.controller?.text, 'Hall 2 main entrance service desk');
    },
  );

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

    expect(find.textContaining('Invalid token'), findsOneWidget);
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

  testWidgets('rotate token success shows new secure link card', (tester) async {
    final repo = InMemorySurplusRepository();
    final created = await repo.createListing(_input(DateTime.now()));

    await _pumpPage(
      tester,
      repo: repo,
      listingId: created.listingId,
      token: created.editToken,
    );

    final scrollable = find.byType(Scrollable).first;
    final rotateButton = find.widgetWithText(OutlinedButton, 'Rotate token');
    await tester.scrollUntilVisible(rotateButton, 250, scrollable: scrollable);
    await tester.tap(rotateButton);
    await tester.pumpAndSettle();

    expect(find.text('Rotate edit token?'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Rotate'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Save this edit link securely'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, 'Copy link'), findsOneWidget);
  });

  testWidgets('rotate token dialog can be cancelled', (tester) async {
    final repo = InMemorySurplusRepository();
    final created = await repo.createListing(_input(DateTime.now()));

    await _pumpPage(
      tester,
      repo: repo,
      listingId: created.listingId,
      token: created.editToken,
    );

    final scrollable = find.byType(Scrollable).first;
    final rotateButton = find.widgetWithText(OutlinedButton, 'Rotate token');
    await tester.scrollUntilVisible(rotateButton, 250, scrollable: scrollable);
    await tester.tap(rotateButton);
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
    await tester.pumpAndSettle();

    expect(find.text('Rotate edit token?'), findsNothing);
    expect(find.textContaining('Save this edit link securely'), findsNothing);
  });

  testWidgets('confirm pickup success updates reservation state', (tester) async {
    final repo = InMemorySurplusRepository();
    final created = await repo.createListing(_input(DateTime.now()));
    final reservation = await repo.reserveListing(
      listingId: created.listingId,
      claimerUid: 'recipient-y',
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
    final codeField = find.widgetWithText(TextField, 'Enter 4-digit pickup code');
    await tester.scrollUntilVisible(codeField, 250, scrollable: scrollable);
    await tester.enterText(codeField.first, reservation.pickupCode);

    final confirmButton = find.widgetWithText(FilledButton, 'Confirm pickup');
    await tester.tap(confirmButton.first);
    await tester.pumpAndSettle();

    expect(find.text('Pickup confirmed.'), findsOneWidget);
    expect(find.textContaining('Status: Completed'), findsWidgets);
  });

  testWidgets('reservation admin filter switches pending and confirmed', (
    tester,
  ) async {
    final repo = InMemorySurplusRepository();
    final created = await repo.createListing(_input(DateTime.now()));
    final first = await repo.reserveListing(
      listingId: created.listingId,
      claimerUid: 'recipient-a',
      qty: 1,
      disclaimerAccepted: true,
    );
    await repo.reserveListing(
      listingId: created.listingId,
      claimerUid: 'recipient-b',
      qty: 1,
      disclaimerAccepted: true,
    );
    await repo.confirmPickup(
      listingId: created.listingId,
      reservationId: first.id,
      token: created.editToken,
      pickupCode: first.pickupCode,
    );

    await _pumpPage(
      tester,
      repo: repo,
      listingId: created.listingId,
      token: created.editToken,
    );

    final scrollable = find.byType(Scrollable).first;
    final pendingChip = find.widgetWithText(ChoiceChip, 'Pending');
    await tester.scrollUntilVisible(pendingChip, 250, scrollable: scrollable);
    await tester.tap(pendingChip);
    await tester.pumpAndSettle();
    expect(find.textContaining('Status: Reserved'), findsWidgets);
    expect(find.textContaining('Status: Completed'), findsNothing);

    final confirmedChip = find.widgetWithText(ChoiceChip, 'Confirmed');
    await tester.tap(confirmedChip);
    await tester.pumpAndSettle();
    expect(find.textContaining('Status: Completed'), findsWidgets);
    expect(find.textContaining('Status: Reserved'), findsNothing);
  });

  testWidgets('enterprise page shows load error when venues stream fails', (
    tester,
  ) async {
    final repo = _EnterpriseInstrumentedRepository()..venuesStreamError = true;
    await _pumpPage(tester, repo: repo);

    expect(find.text('Unable to load'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Retry'));
    await tester.pumpAndSettle();
  });

  testWidgets('reservation admin shows no reservations yet', (tester) async {
    final repo = _EnterpriseInstrumentedRepository();
    final created = await repo.createListing(_input(DateTime.now()));
    await _pumpPage(
      tester,
      repo: repo,
      listingId: created.listingId,
      token: created.editToken,
    );

    expect(find.text('No reservations yet.'), findsOneWidget);
  });

  testWidgets('reservation admin shows stream error text', (tester) async {
    final repo = _EnterpriseInstrumentedRepository()
      ..reservationsStreamError = true;
    final created = await repo.createListing(_input(DateTime.now()));
    await _pumpPage(
      tester,
      repo: repo,
      listingId: created.listingId,
      token: created.editToken,
    );

    expect(find.textContaining('Unable to load reservations'), findsOneWidget);
  });

  testWidgets('template performance fallback path works in firebase mode', (
    tester,
  ) async {
    final repo = InMemorySurplusRepository();
    await _pumpPage(tester, repo: repo, usingFirebase: true);

    expect(find.textContaining('Template performance'), findsOneWidget);
    expect(
      find.textContaining('Not enough sample yet'),
      findsOneWidget,
    );

    await tester.tap(find.byIcon(Icons.refresh).first);
    await tester.pumpAndSettle();
    expect(find.textContaining('Template performance'), findsOneWidget);
  });

  testWidgets('create mode shows venue-required snackbar when no venue exists', (
    tester,
  ) async {
    final repo = _EnterpriseInstrumentedRepository()..emptyVenues = true;
    await _pumpPage(tester, repo: repo);

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Pickup point (booth / gate)'),
      'Service desk',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Simple description'),
      'No venue test',
    );
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Post listing'));
    await tester.pumpAndSettle();
    expect(find.text('Please select a venue.'), findsOneWidget);
  });

  testWidgets('create mode surfaces create error', (tester) async {
    final repo = _EnterpriseInstrumentedRepository()..throwOnCreate = true;
    await _pumpPage(tester, repo: repo);

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Pickup point (booth / gate)'),
      'Hall 1 Gate A',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Simple description'),
      'Create error',
    );
    await tester.tap(find.byType(CheckboxListTile).first);
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Post listing'));
    await tester.pumpAndSettle();
    expect(find.text('Create failed for test.'), findsOneWidget);
  });

  testWidgets('edit mode surfaces update error', (tester) async {
    final repo = _EnterpriseInstrumentedRepository()..throwOnUpdate = true;
    final created = await repo.createListing(_input(DateTime.now()));
    await _pumpPage(
      tester,
      repo: repo,
      listingId: created.listingId,
      token: created.editToken,
    );

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Simple description'),
      'Update error',
    );

    final scrollable = find.byType(Scrollable).first;
    final updateButton = find.widgetWithText(FilledButton, 'Update listing');
    await tester.scrollUntilVisible(updateButton, 250, scrollable: scrollable);
    await tester.tap(updateButton);
    await tester.pumpAndSettle();
    expect(find.text('Update failed for test.'), findsOneWidget);
  });

  testWidgets('rotate token surfaces error', (tester) async {
    final repo = _EnterpriseInstrumentedRepository()
      ..throwOnRotate = true
      ..throwOnRevoke = true;
    final created = await repo.createListing(_input(DateTime.now()));

    await _pumpPage(
      tester,
      repo: repo,
      listingId: created.listingId,
      token: created.editToken,
    );

    final scrollable = find.byType(Scrollable).first;
    final rotateButton = find.widgetWithText(OutlinedButton, 'Rotate token');
    await tester.scrollUntilVisible(rotateButton, 300, scrollable: scrollable);
    await tester.tap(rotateButton);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Rotate'));
    await tester.pumpAndSettle();
    expect(find.text('Rotate failed for test.'), findsOneWidget);
  });

  testWidgets('confirm pickup surfaces backend error', (tester) async {
    final repo = _EnterpriseInstrumentedRepository()..throwOnConfirmPickup = true;
    final created = await repo.createListing(_input(DateTime.now()));
    final reservation = await repo.reserveListing(
      listingId: created.listingId,
      claimerUid: 'recipient-z',
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
    final codeField = find.widgetWithText(TextField, 'Enter 4-digit pickup code');
    await tester.scrollUntilVisible(codeField, 250, scrollable: scrollable);
    await tester.enterText(codeField.first, reservation.pickupCode);
    await tester.tap(find.widgetWithText(FilledButton, 'Confirm pickup').first);
    await tester.pumpAndSettle();
    expect(find.text('Confirm failed for test.'), findsOneWidget);
  });

  testWidgets('revoke token surfaces error', (tester) async {
    final repo = _EnterpriseInstrumentedRepository()..throwOnRevoke = true;
    final created = await repo.createListing(_input(DateTime.now()));

    await _pumpPage(
      tester,
      repo: repo,
      listingId: created.listingId,
      token: created.editToken,
    );

    final scrollable = find.byType(Scrollable).first;
    final revokeButton = find.widgetWithText(OutlinedButton, 'Revoke token');
    await tester.scrollUntilVisible(revokeButton, 300, scrollable: scrollable);
    await tester.tap(revokeButton);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Revoke'));
    await tester.pumpAndSettle();
    expect(find.text('Revoke failed for test.'), findsOneWidget);
  });

  testWidgets('can pick date and time for all 3 time fields', (tester) async {
    final repo = InMemorySurplusRepository();
    await _pumpPage(tester, repo: repo);

    Future<void> pickWithIcon(IconData icon) async {
      await tester.tap(find.byIcon(icon).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK').last);
      await tester.pumpAndSettle();
    }

    await pickWithIcon(Icons.schedule);
    await pickWithIcon(Icons.schedule_send_outlined);
    await pickWithIcon(Icons.hourglass_bottom_outlined);

    expect(find.text('Pickup start'), findsOneWidget);
    expect(find.text('Pickup end'), findsOneWidget);
    expect(find.text('Expires at'), findsOneWidget);
  });
}
