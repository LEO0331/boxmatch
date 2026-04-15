import 'package:go_router/go_router.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';

import '../core/layout/app_shell.dart';
import '../features/surplus/presentation/browse/listings_page.dart';
import '../features/surplus/presentation/browse/listing_detail_page.dart'
    as listing_detail_page_direct;
import '../features/surplus/presentation/browse/listing_detail_page.dart'
    deferred as listing_detail_page_deferred;
import '../features/surplus/presentation/browse/my_reservations_page.dart'
    as my_reservations_page_direct;
import '../features/surplus/presentation/browse/my_reservations_page.dart'
    deferred as my_reservations_page_deferred;
import '../features/surplus/presentation/browse/reservation_confirmation_page.dart'
    as reservation_confirmation_page_direct;
import '../features/surplus/presentation/browse/reservation_confirmation_page.dart'
    deferred as reservation_confirmation_page_deferred;
import '../features/surplus/presentation/enterprise/enterprise_listing_page.dart'
    as enterprise_listing_page_direct;
import '../features/surplus/presentation/enterprise/enterprise_listing_page.dart'
    deferred as enterprise_listing_page_deferred;
import '../features/surplus/presentation/map/venues_map_page.dart'
    as venues_map_page_direct;
import '../features/surplus/presentation/map/venues_map_page.dart'
    deferred as venues_map_page_deferred;

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

class _DeferredRoutePage extends StatefulWidget {
  const _DeferredRoutePage({required this.loadLibrary, required this.builder});

  final Future<void> Function() loadLibrary;
  final WidgetBuilder builder;

  @override
  State<_DeferredRoutePage> createState() => _DeferredRoutePageState();
}

class _DeferredRoutePageState extends State<_DeferredRoutePage> {
  late final Future<void> _loadFuture = widget.loadLibrary();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<void>(
      future: _loadFuture,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return const Scaffold(
            body: Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text('載入頁面失敗，請重新整理後再試。', textAlign: TextAlign.center),
              ),
            ),
          );
        }
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        return widget.builder(context);
      },
    );
  }
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
            builder: (context, state) => kIsWeb
                ? _DeferredRoutePage(
                    loadLibrary: venues_map_page_deferred.loadLibrary,
                    builder: (_) => venues_map_page_deferred.VenuesMapPage(),
                  )
                : const venues_map_page_direct.VenuesMapPage(),
          ),
          GoRoute(
            path: '/enterprise/new',
            builder: (context, state) => kIsWeb
                ? _DeferredRoutePage(
                    loadLibrary: enterprise_listing_page_deferred.loadLibrary,
                    builder: (_) =>
                        enterprise_listing_page_deferred.EnterpriseListingPage(),
                  )
                : const enterprise_listing_page_direct.EnterpriseListingPage(),
          ),
        ],
      ),
      GoRoute(
        path: '/listing/:listingId',
        builder: (context, state) {
          final listingId = state.pathParameters['listingId']!;
          return kIsWeb
              ? _DeferredRoutePage(
                  loadLibrary: listing_detail_page_deferred.loadLibrary,
                  builder: (_) =>
                      listing_detail_page_deferred.ListingDetailPage(
                        listingId: listingId,
                      ),
                )
              : listing_detail_page_direct.ListingDetailPage(
                  listingId: listingId,
                );
        },
      ),
      GoRoute(
        path: '/listing/:listingId/reservation/:reservationId',
        builder: (context, state) {
          return kIsWeb
              ? _DeferredRoutePage(
                  loadLibrary:
                      reservation_confirmation_page_deferred.loadLibrary,
                  builder: (_) =>
                      reservation_confirmation_page_deferred.ReservationConfirmationPage(
                        listingId: state.pathParameters['listingId']!,
                        reservationId: state.pathParameters['reservationId']!,
                      ),
                )
              : reservation_confirmation_page_direct.ReservationConfirmationPage(
                  listingId: state.pathParameters['listingId']!,
                  reservationId: state.pathParameters['reservationId']!,
                );
        },
      ),
      GoRoute(
        path: '/my-reservations',
        builder: (context, state) => kIsWeb
            ? _DeferredRoutePage(
                loadLibrary: my_reservations_page_deferred.loadLibrary,
                builder: (_) =>
                    my_reservations_page_deferred.MyReservationsPage(),
              )
            : const my_reservations_page_direct.MyReservationsPage(),
      ),
      GoRoute(
        path: '/enterprise/edit/:listingId',
        builder: (context, state) {
          final listingId = state.pathParameters['listingId'];
          final token = _extractEnterpriseEditToken(state);
          return kIsWeb
              ? _DeferredRoutePage(
                  loadLibrary: enterprise_listing_page_deferred.loadLibrary,
                  builder: (_) =>
                      enterprise_listing_page_deferred.EnterpriseListingPage(
                        listingId: listingId,
                        token: token,
                      ),
                )
              : enterprise_listing_page_direct.EnterpriseListingPage(
                  listingId: listingId,
                  token: token,
                );
        },
      ),
    ],
  );
}
