import 'package:go_router/go_router.dart';

import '../core/layout/app_shell.dart';
import '../features/surplus/presentation/browse/listing_detail_page.dart';
import '../features/surplus/presentation/browse/listings_page.dart';
import '../features/surplus/presentation/browse/reservation_confirmation_page.dart';
import '../features/surplus/presentation/enterprise/enterprise_listing_page.dart';
import '../features/surplus/presentation/map/venues_map_page.dart';

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
        path: '/enterprise/edit/:listingId',
        builder: (context, state) {
          final listingId = state.pathParameters['listingId'];
          final token = state.uri.queryParameters['token'];
          return EnterpriseListingPage(listingId: listingId, token: token);
        },
      ),
    ],
  );
}
