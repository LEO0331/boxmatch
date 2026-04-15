import 'package:go_router/go_router.dart';
import 'package:flutter/foundation.dart';

import '../core/layout/app_shell.dart';
import '../features/surplus/presentation/browse/listing_detail_page.dart';
import '../features/surplus/presentation/browse/listings_page.dart';
import '../features/surplus/presentation/browse/my_reservations_page.dart';
import '../features/surplus/presentation/browse/reservation_confirmation_page.dart';
import '../features/surplus/presentation/enterprise/enterprise_listing_page.dart';
import '../features/surplus/presentation/map/venues_map_page.dart';

@visibleForTesting
String? parseEnterpriseEditTokenFromFragment(String fragment) {
  if (fragment.isEmpty) {
    return null;
  }

  final normalized = fragment.startsWith('/') ? fragment : '/$fragment';
  try {
    final fragmentUri = Uri.parse(normalized);
    final fromFragment = fragmentUri.queryParameters['token'];
    if (fromFragment != null && fromFragment.isNotEmpty) {
      return fromFragment;
    }
  } catch (_) {
    // no-op: fall through and return null
  }
  return null;
}

String? _extractEnterpriseEditToken(GoRouterState state) {
  final fromQuery = state.uri.queryParameters['token'];
  if (fromQuery != null && fromQuery.isNotEmpty) {
    return fromQuery;
  }

  return parseEnterpriseEditTokenFromFragment(Uri.base.fragment);
}

GoRouter buildRouter() {
  return GoRouter(
    initialLocation: '/',
    routes: [
      ShellRoute(
        builder: (context, state, child) {
          return AppShell(state: state, child: child);
        },
        routes: [
          GoRoute(path: '/', builder: (context, state) => const ListingsPage()),
          GoRoute(
            path: '/map',
            builder: (context, state) => const VenuesMapPage(),
          ),
          GoRoute(
            path: '/enterprise/new',
            builder: (context, state) => const EnterpriseListingPage(),
          ),
        ],
      ),
      GoRoute(
        path: '/listing/:listingId',
        builder: (context, state) {
          final listingId = state.pathParameters['listingId']!;
          return ListingDetailPage(listingId: listingId);
        },
      ),
      GoRoute(
        path: '/listing/:listingId/reservation/:reservationId',
        builder: (context, state) {
          return ReservationConfirmationPage(
            listingId: state.pathParameters['listingId']!,
            reservationId: state.pathParameters['reservationId']!,
          );
        },
      ),
      GoRoute(
        path: '/my-reservations',
        builder: (context, state) => const MyReservationsPage(),
      ),
      GoRoute(
        path: '/enterprise/edit/:listingId',
        builder: (context, state) {
          final listingId = state.pathParameters['listingId'];
          final token = _extractEnterpriseEditToken(state);
          return EnterpriseListingPage(listingId: listingId, token: token);
        },
      ),
    ],
  );
}
