import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_scope.dart';
import '../../../../core/i18n/app_strings.dart';
import '../../../../core/i18n/language_menu_button.dart';
import '../../../../core/widgets/load_error_view.dart';
import '../../../../core/utils/date_time_formatters.dart';
import '../../../surplus/domain/listing.dart';
import '../../../surplus/domain/venue.dart';

class ListingsPage extends StatefulWidget {
  const ListingsPage({super.key});

  @override
  State<ListingsPage> createState() => _ListingsPageState();
}

class _ListingsPageState extends State<ListingsPage> {
  Timer? _reconcileTimer;
  bool _favoritesOnly = false;

  @override
  void initState() {
    super.initState();
    _scheduleReconcile();
  }

  void _scheduleReconcile() {
    _reconcileTimer = Timer.periodic(const Duration(minutes: 30), (_) {
      final dependencies = AppScope.of(context);
      dependencies.repository.reconcileExpiredListings();
    });
  }

  @override
  void dispose() {
    _reconcileTimer?.cancel();
    super.dispose();
  }

  Future<void> _manualRefresh() async {
    final dependencies = AppScope.of(context);
    await dependencies.repository.reconcileExpiredListings();
    if (mounted) {
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final dependencies = AppScope.of(context);
    final repository = dependencies.repository;
    final favoritesStore = dependencies.favoritesStore;
    final s = AppStrings.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(s.listingsTitle),
        actions: [
          IconButton(
            onPressed: _manualRefresh,
            icon: const Icon(Icons.refresh),
            tooltip: s.refresh,
          ),
          const LanguageMenuButton(),
        ],
      ),
      body: AnimatedBuilder(
        animation: favoritesStore,
        builder: (context, _) {
          final favoriteVenueIds = favoritesStore.favoriteVenueIds;

          return StreamBuilder<List<Venue>>(
            stream: repository.watchVenues(),
            builder: (context, venuesSnapshot) {
              if (venuesSnapshot.hasError) {
                return LoadErrorView(
                  title: s.genericLoadErrorTitle,
                  message: s.genericLoadErrorBody,
                  retryLabel: s.retry,
                  onRetry: _manualRefresh,
                );
              }

              final venueMap = {
                for (final venue in venuesSnapshot.data ?? const <Venue>[])
                  venue.id: venue,
              };

              return StreamBuilder<List<Listing>>(
                stream: repository.watchActiveListings(),
                builder: (context, listingSnapshot) {
                  if (listingSnapshot.hasError) {
                    return LoadErrorView(
                      title: s.genericLoadErrorTitle,
                      message: s.genericLoadErrorBody,
                      retryLabel: s.retry,
                      onRetry: _manualRefresh,
                    );
                  }

                  final allListings = listingSnapshot.data ?? const <Listing>[];
                  final listings =
                      allListings
                          .where(
                            (listing) =>
                                !_favoritesOnly ||
                                favoriteVenueIds.contains(listing.venueId),
                          )
                          .toList()
                        ..sort((a, b) {
                          final aFav = favoriteVenueIds.contains(a.venueId)
                              ? 1
                              : 0;
                          final bFav = favoriteVenueIds.contains(b.venueId)
                              ? 1
                              : 0;
                          if (aFav != bFav) {
                            return bFav.compareTo(aFav);
                          }
                          return a.expiresAt.compareTo(b.expiresAt);
                        });

                  if (listingSnapshot.connectionState ==
                          ConnectionState.waiting &&
                      listings.isEmpty) {
                    return const Center(child: CircularProgressIndicator());
                  }

                  if (listings.isEmpty) {
                    return ListView(
                      padding: const EdgeInsets.all(24),
                      children: [
                        const SizedBox(height: 48),
                        const Icon(Icons.lunch_dining_outlined, size: 48),
                        const SizedBox(height: 12),
                        Text(s.noActiveListings, textAlign: TextAlign.center),
                      ],
                    );
                  }

                  return ListView.builder(
                    itemCount: listings.length + 1,
                    itemBuilder: (context, index) {
                      if (index == 0) {
                        return Column(
                          children: [
                            if (!dependencies.usingFirebase)
                              Card(
                                margin: const EdgeInsets.fromLTRB(
                                  12,
                                  12,
                                  12,
                                  8,
                                ),
                                child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Text(s.localDemoModeNotice),
                                ),
                              ),
                            Card(
                              margin: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(s.platformDisclaimer),
                                    const SizedBox(height: 8),
                                    Wrap(
                                      spacing: 8,
                                      runSpacing: 8,
                                      children: [
                                        ChoiceChip(
                                          selected: !_favoritesOnly,
                                          onSelected: (_) {
                                            setState(() {
                                              _favoritesOnly = false;
                                            });
                                          },
                                          label: Text(
                                            AppScope.of(
                                                  context,
                                                ).localeController.isZhTw
                                                ? '全部場館'
                                                : 'All venues',
                                          ),
                                        ),
                                        ChoiceChip(
                                          selected: _favoritesOnly,
                                          onSelected: (_) {
                                            setState(() {
                                              _favoritesOnly = true;
                                            });
                                          },
                                          label: Text(
                                            AppScope.of(
                                                  context,
                                                ).localeController.isZhTw
                                                ? '僅收藏場館'
                                                : 'Favorites only',
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        );
                      }

                      final listing = listings[index - 1];
                      final venue = venueMap[listing.venueId];
                      final donorName =
                          listing.displayNameOptional?.trim().isNotEmpty == true
                          ? listing.displayNameOptional!.trim()
                          : s.privateDonor;
                      final isFavorite = favoritesStore.isFavorite(
                        listing.venueId,
                      );

                      return Card(
                        child: ListTile(
                          title: Text(
                            '${listing.itemType} · ${listing.quantityRemaining} left',
                          ),
                          subtitle: Text(
                            '${venue?.name ?? 'Venue'}\n'
                            'Pickup: ${formatDateTime(listing.pickupStartAt)} - ${formatDateTime(listing.pickupEndAt)}\n'
                            'By: $donorName',
                          ),
                          isThreeLine: true,
                          trailing: SizedBox(
                            width: 88,
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.end,
                              children: [
                                IconButton(
                                  icon: Icon(
                                    isFavorite
                                        ? Icons.favorite
                                        : Icons.favorite_border,
                                    color: isFavorite
                                        ? Theme.of(context).colorScheme.error
                                        : null,
                                  ),
                                  onPressed: () => favoritesStore
                                      .toggleFavorite(listing.venueId),
                                ),
                                const Icon(Icons.chevron_right),
                              ],
                            ),
                          ),
                          onTap: () => context.go('/listing/${listing.id}'),
                        ),
                      );
                    },
                  );
                },
              );
            },
          );
        },
      ),
    );
  }
}
