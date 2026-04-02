import 'package:boxmatch/app/app.dart';
import 'package:boxmatch/app/app_scope.dart';
import 'package:boxmatch/core/identity/recipient_identity_service.dart';
import 'package:boxmatch/features/surplus/data/in_memory_surplus_repository.dart';
import 'package:boxmatch/features/surplus/domain/listing.dart';
import 'package:boxmatch/features/surplus/domain/listing_input.dart';
import 'package:boxmatch/features/surplus/domain/listing_visibility.dart';
import 'package:boxmatch/features/surplus/domain/reservation.dart';
import 'package:boxmatch/features/surplus/domain/surplus_exceptions.dart';
import 'package:boxmatch/features/surplus/domain/venue.dart';
import 'package:boxmatch/features/surplus/presentation/browse/listing_detail_page.dart';
import 'package:boxmatch/features/surplus/presentation/browse/reservation_confirmation_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../test_helpers.dart';

class _InstrumentedRepository extends InMemorySurplusRepository {
  bool venuesStreamError = false;
  bool activeListingsStreamError = false;
  bool reservationStreamError = false;
  bool throwOnReserve = false;
  bool throwOnAbuseSignal = false;
  String? lastAbuseReason;
  int reconcileCalls = 0;

  final Set<String> listingStreamErrorIds = <String>{};
  final Map<String, Listing> forcedListings = <String, Listing>{};
  final Map<String, Reservation> forcedReservations = <String, Reservation>{};

  @override
  Stream<Listing?> watchListing(String listingId) {
    if (listingStreamErrorIds.contains(listingId)) {
      return Stream.error(StateError('listing stream failed'));
    }
    final forced = forcedListings[listingId];
    if (forced != null) {
      return Stream<Listing?>.value(forced);
    }
    return super.watchListing(listingId);
  }

  @override
  Stream<List<Venue>> watchVenues() {
    if (venuesStreamError) {
      return Stream.error(StateError('venue stream failed'));
    }
    return super.watchVenues();
  }

  @override
  Stream<List<Listing>> watchActiveListings() {
    if (activeListingsStreamError) {
      return Stream.error(StateError('active listing stream failed'));
    }
    return super.watchActiveListings();
  }

  @override
  Stream<Reservation?> watchReservation(String reservationId) {
    if (reservationStreamError) {
      return Stream.error(StateError('reservation stream failed'));
    }
    final forced = forcedReservations[reservationId];
    if (forced != null) {
      return Stream<Reservation?>.value(forced);
    }
    return super.watchReservation(reservationId);
  }

  @override
  Future<int> reconcileExpiredListings() async {
    reconcileCalls += 1;
    return super.reconcileExpiredListings();
  }

  @override
  Future<Reservation> reserveListing({
    required String listingId,
    required String claimerUid,
    required int qty,
    required bool disclaimerAccepted,
  }) async {
    if (throwOnReserve) {
      throw const ValidationException('Reserve failed for test.');
    }
    return super.reserveListing(
      listingId: listingId,
      claimerUid: claimerUid,
      qty: qty,
      disclaimerAccepted: disclaimerAccepted,
    );
  }

  @override
  Future<void> addAbuseSignal({
    required String listingId,
    required String claimerUid,
    required String reason,
  }) async {
    if (throwOnAbuseSignal) {
      throw const ValidationException('Abuse report failed for test.');
    }
    lastAbuseReason = reason;
    await super.addAbuseSignal(
      listingId: listingId,
      claimerUid: claimerUid,
      reason: reason,
    );
  }
}

class _LocalFallbackIdentityService implements RecipientIdentityService {
  @override
  bool get isUsingLocalFallback => true;

  @override
  Future<String> ensureRecipientUid() async => 'local-fallback-user';
}

ListingInput _input(
  DateTime now, {
  required String venueId,
  required String itemType,
  String? displayName,
  int quantityTotal = 2,
  Duration expiresIn = const Duration(hours: 2),
}) {
  return ListingInput(
    venueId: venueId,
    pickupPointText: 'Gate A',
    itemType: itemType,
    description: '$itemType description',
    quantityTotal: quantityTotal,
    price: 0,
    currency: 'TWD',
    pickupStartAt: now.add(const Duration(minutes: 10)),
    pickupEndAt: now.add(const Duration(minutes: 80)),
    expiresAt: now.add(expiresIn),
    displayNameOptional: displayName,
    visibility: ListingVisibility.minimal,
    disclaimerAccepted: true,
  );
}

Listing _forcedListing(
  DateTime now, {
  required String id,
  required ListingStatus status,
  required int quantityRemaining,
  required DateTime expiresAt,
  String? displayNameOptional,
  bool enterpriseVerified = false,
}) {
  return Listing(
    id: id,
    venueId: 'taipei-nangang-exhibition-center-hall-1',
    pickupPointText: 'Gate B',
    itemType: 'Lunchbox',
    description: 'Forced listing',
    quantityTotal: 2,
    quantityRemaining: quantityRemaining,
    price: 0,
    currency: 'TWD',
    pickupStartAt: now.add(const Duration(minutes: 5)),
    pickupEndAt: now.add(const Duration(minutes: 30)),
    expiresAt: expiresAt,
    displayNameOptional: displayNameOptional,
    enterpriseVerified: enterpriseVerified,
    visibility: ListingVisibility.minimal,
    status: status,
    editTokenHash: 'hash',
    createdAt: now,
    updatedAt: now,
  );
}

Reservation _forcedReservation(
  DateTime now, {
  required String id,
  required String listingId,
  required ReservationStatus status,
}) {
  return Reservation(
    id: id,
    listingId: listingId,
    claimerUid: 'u1',
    qty: 1,
    pickupCode: '1234',
    status: status,
    createdAt: now,
    expiresAt: now.add(const Duration(hours: 1)),
  );
}

Future<void> _pumpHome(
  WidgetTester tester,
  _InstrumentedRepository repo,
) async {
  final dependencies = await buildTestDependencies(repository: repo);
  await tester.pumpWidget(BoxmatchApp(dependencies: dependencies));
  await tester.pumpAndSettle();
}

Future<void> _pumpDetail(
  WidgetTester tester,
  _InstrumentedRepository repo,
  String listingId,
) async {
  final dependencies = await buildTestDependencies(repository: repo);
  await tester.pumpWidget(
    AppScope(
      dependencies: dependencies,
      child: MaterialApp(home: ListingDetailPage(listingId: listingId)),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _pumpConfirmation(
  WidgetTester tester,
  _InstrumentedRepository repo, {
  required String listingId,
  required String reservationId,
  RecipientIdentityService? identityService,
}) async {
  final dependencies = await buildTestDependencies(
    repository: repo,
    identityService: identityService,
  );
  await tester.pumpWidget(
    AppScope(
      dependencies: dependencies,
      child: MaterialApp(
        home: ReservationConfirmationPage(
          listingId: listingId,
          reservationId: reservationId,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'listings page covers refresh, timer, favorites and donor display',
    (tester) async {
      final repo = _InstrumentedRepository();
      final now = DateTime.now();
      await repo.createListing(
        _input(
          now,
          venueId: 'taipei-nangang-exhibition-center-hall-1',
          itemType: 'Item A',
          displayName: null,
          expiresIn: const Duration(hours: 2),
        ),
      );
      await repo.createListing(
        _input(
          now,
          venueId: 'taipei-nangang-exhibition-center-hall-2',
          itemType: 'Item B',
          displayName: 'Acme Corp',
          expiresIn: const Duration(hours: 3),
        ),
      );

      await _pumpHome(tester, repo);

      expect(find.textContaining('Running in local demo mode'), findsOneWidget);
      expect(find.textContaining('Private donor'), findsOneWidget);
      expect(find.textContaining('Acme Corp'), findsOneWidget);

      final favButtons = find.byIcon(Icons.favorite_border);
      expect(favButtons, findsNWidgets(2));
      await tester.tap(favButtons.at(1));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Favorites only'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Item B'), findsOneWidget);
      expect(find.textContaining('Item A'), findsNothing);

      await tester.tap(find.text('All venues'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Item A'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.refresh));
      await tester.pumpAndSettle();

      await tester.pump(const Duration(minutes: 31));
      await tester.pumpAndSettle();

      expect(repo.reconcileCalls, greaterThanOrEqualTo(2));
    },
  );

  testWidgets('listings page shows load error when venue stream fails', (
    tester,
  ) async {
    final repo = _InstrumentedRepository()..venuesStreamError = true;
    await _pumpHome(tester, repo);

    expect(find.text('Unable to load'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Retry'));
    await tester.pumpAndSettle();

    expect(repo.reconcileCalls, greaterThan(0));
  });

  testWidgets('listings page shows load error when listing stream fails', (
    tester,
  ) async {
    final repo = _InstrumentedRepository()..activeListingsStreamError = true;
    await _pumpHome(tester, repo);

    expect(find.text('Unable to load'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Retry'));
    await tester.pumpAndSettle();

    expect(repo.reconcileCalls, greaterThan(0));
  });

  testWidgets('listing detail supports disclaimer cancel without reserve', (
    tester,
  ) async {
    final repo = _InstrumentedRepository();
    final created = await repo.createListing(
      _input(
        DateTime.now(),
        venueId: 'taipei-nangang-exhibition-center-hall-1',
        itemType: 'Cancel flow',
      ),
    );
    await _pumpDetail(tester, repo, created.listingId);

    await tester.tap(find.text('Reserve 1 item'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
    await tester.pumpAndSettle();

    expect(find.text('Listing details'), findsOneWidget);
  });

  testWidgets('listing detail shows snackbar when reserve throws error', (
    tester,
  ) async {
    final repo = _InstrumentedRepository()..throwOnReserve = true;
    final created = await repo.createListing(
      _input(
        DateTime.now(),
        venueId: 'taipei-nangang-exhibition-center-hall-1',
        itemType: 'Reserve error',
      ),
    );
    await _pumpDetail(tester, repo, created.listingId);

    await tester.tap(find.text('Reserve 1 item'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Reserve'));
    await tester.pumpAndSettle();

    expect(find.text('Reserve failed for test.'), findsOneWidget);
  });

  testWidgets('listing detail shows listing not found', (tester) async {
    final repo = _InstrumentedRepository();
    await _pumpDetail(tester, repo, 'missing-listing');
    expect(find.text('Listing not found.'), findsOneWidget);
  });

  testWidgets('listing detail shows load error when listing stream fails', (
    tester,
  ) async {
    final repo = _InstrumentedRepository()
      ..listingStreamErrorIds.add('bad-listing');
    await _pumpDetail(tester, repo, 'bad-listing');
    expect(find.text('Unable to load'), findsOneWidget);
  });

  testWidgets('listing detail shows load error when venues stream fails', (
    tester,
  ) async {
    final repo = _InstrumentedRepository()..venuesStreamError = true;
    final created = await repo.createListing(
      _input(
        DateTime.now(),
        venueId: 'taipei-nangang-exhibition-center-hall-1',
        itemType: 'Venue error',
      ),
    );
    await _pumpDetail(tester, repo, created.listingId);
    expect(find.text('Unable to load'), findsOneWidget);
  });

  testWidgets(
    'listing detail renders reserved, expired and completed statuses',
    (tester) async {
      final now = DateTime.now();
      final repo = _InstrumentedRepository()
        ..forcedListings['reserved-id'] = _forcedListing(
          now,
          id: 'reserved-id',
          status: ListingStatus.active,
          quantityRemaining: 0,
          expiresAt: now.add(const Duration(hours: 1)),
        )
        ..forcedListings['expired-id'] = _forcedListing(
          now,
          id: 'expired-id',
          status: ListingStatus.active,
          quantityRemaining: 1,
          expiresAt: now.subtract(const Duration(minutes: 1)),
        )
        ..forcedListings['completed-id'] = _forcedListing(
          now,
          id: 'completed-id',
          status: ListingStatus.completed,
          quantityRemaining: 0,
          expiresAt: now.add(const Duration(hours: 1)),
        );

      await _pumpDetail(tester, repo, 'reserved-id');
      expect(find.textContaining('Status: Reserved'), findsOneWidget);

      await _pumpDetail(tester, repo, 'expired-id');
      expect(find.textContaining('Status: Expired'), findsOneWidget);

      await _pumpDetail(tester, repo, 'completed-id');
      expect(find.textContaining('Status: Completed'), findsOneWidget);
    },
  );

  testWidgets(
    'reservation confirmation shows error when reservation stream fails',
    (tester) async {
      final repo = _InstrumentedRepository()..reservationStreamError = true;
      await _pumpConfirmation(
        tester,
        repo,
        listingId: 'l1',
        reservationId: 'r1',
      );
      expect(find.text('Unable to load'), findsOneWidget);
    },
  );

  testWidgets(
    'reservation confirmation shows not found when missing reservation',
    (tester) async {
      final repo = _InstrumentedRepository();
      await _pumpConfirmation(
        tester,
        repo,
        listingId: 'l1',
        reservationId: 'missing-reservation',
      );
      expect(find.text('Reservation not found.'), findsOneWidget);
    },
  );

  testWidgets(
    'reservation confirmation shows error when listing stream fails',
    (tester) async {
      final now = DateTime.now();
      final repo = _InstrumentedRepository()
        ..listingStreamErrorIds.add('listing-error')
        ..forcedReservations['reservation-ok'] = _forcedReservation(
          now,
          id: 'reservation-ok',
          listingId: 'listing-error',
          status: ReservationStatus.reserved,
        );

      await _pumpConfirmation(
        tester,
        repo,
        listingId: 'listing-error',
        reservationId: 'reservation-ok',
      );

      expect(find.text('Unable to load'), findsOneWidget);
    },
  );

  testWidgets(
    'reservation confirmation renders completed, expired and cancelled statuses',
    (tester) async {
      final now = DateTime.now();
      final repo = _InstrumentedRepository()
        ..forcedListings['shared-listing'] = _forcedListing(
          now,
          id: 'shared-listing',
          status: ListingStatus.active,
          quantityRemaining: 1,
          expiresAt: now.add(const Duration(hours: 1)),
        )
        ..forcedReservations['r-completed'] = _forcedReservation(
          now,
          id: 'r-completed',
          listingId: 'shared-listing',
          status: ReservationStatus.completed,
        )
        ..forcedReservations['r-expired'] = _forcedReservation(
          now,
          id: 'r-expired',
          listingId: 'shared-listing',
          status: ReservationStatus.expired,
        )
        ..forcedReservations['r-cancelled'] = _forcedReservation(
          now,
          id: 'r-cancelled',
          listingId: 'shared-listing',
          status: ReservationStatus.cancelled,
        );

      await _pumpConfirmation(
        tester,
        repo,
        listingId: 'shared-listing',
        reservationId: 'r-completed',
      );
      expect(find.text('Completed'), findsWidgets);

      await _pumpConfirmation(
        tester,
        repo,
        listingId: 'shared-listing',
        reservationId: 'r-expired',
      );
      expect(find.text('Expired'), findsWidgets);

      await _pumpConfirmation(
        tester,
        repo,
        listingId: 'shared-listing',
        reservationId: 'r-cancelled',
      );
      expect(find.text('Cancelled'), findsWidgets);
    },
  );

  testWidgets(
    'reservation confirmation shows local fallback hint and can go back',
    (tester) async {
      final now = DateTime.now();
      final repo = _InstrumentedRepository()
        ..forcedListings['badge-listing'] = _forcedListing(
          now,
          id: 'badge-listing',
          status: ListingStatus.active,
          quantityRemaining: 1,
          expiresAt: now.add(const Duration(hours: 2)),
          displayNameOptional: 'Trusted Enterprise',
          enterpriseVerified: true,
        )
        ..forcedListings['badge-listing-2'] = _forcedListing(
          now,
          id: 'badge-listing-2',
          status: ListingStatus.active,
          quantityRemaining: 1,
          expiresAt: now.add(const Duration(hours: 3)),
          displayNameOptional: 'Trusted Enterprise',
          enterpriseVerified: false,
        )
        ..forcedReservations['badge-reservation'] = _forcedReservation(
          now,
          id: 'badge-reservation',
          listingId: 'badge-listing',
          status: ReservationStatus.reserved,
        );

      await _pumpConfirmation(
        tester,
        repo,
        listingId: 'badge-listing',
        reservationId: 'badge-reservation',
        identityService: _LocalFallbackIdentityService(),
      );

      expect(find.text('Using offline identity mode'), findsOneWidget);
      expect(find.text('1234'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Back to listings'), findsOneWidget);
    },
  );

}
