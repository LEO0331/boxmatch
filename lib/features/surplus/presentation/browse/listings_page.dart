import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_scope.dart';
import '../../../../core/i18n/app_strings.dart';
import '../../../../core/i18n/language_menu_button.dart';
import '../../../../core/theme/app_theme.dart';
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
  static _ListingFilterMode _filterMemory = _ListingFilterMode.all;
  _ListingFilterMode _filter = _filterMemory;

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

  void _setFilter(_ListingFilterMode value) {
    setState(() {
      _filter = value;
      _filterMemory = value;
    });
  }

  Widget _buildModeNotice(AppStrings s) {
    return Card(
      margin: const EdgeInsets.fromLTRB(12, 12, 12, 8),
      color: const Color(0xFFF2F8EE),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Text(
          s.localDemoModeNotice,
          style: const TextStyle(color: Color(0xFF2E5233)),
        ),
      ),
    );
  }

  Widget _buildFilterCard(
    BuildContext context,
    AppStrings s, {
    required int favoriteCount,
  }) {
    final activeColor = Theme.of(context).colorScheme.primary;
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 12, 12, 10),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        gradient: const LinearGradient(
          colors: [BoxmatchColors.warmAccent, Color(0xFFFFF4E8)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        border: Border.all(color: BoxmatchColors.warmBorder),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              s.listingsSubtitle,
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(color: const Color(0xFF33523E)),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(
                  Icons.eco_outlined,
                  size: 18,
                  color: BoxmatchColors.seed,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    s.platformDisclaimer,
                    style: const TextStyle(
                      color: Color(0xFF2D4A2F),
                      fontSize: 13,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ChoiceChip(
                  selected: _filter == _ListingFilterMode.all,
                  onSelected: (_) => _setFilter(_ListingFilterMode.all),
                  selectedColor: activeColor,
                  labelStyle: TextStyle(
                    color: _filter == _ListingFilterMode.all
                        ? Colors.white
                        : const Color(0xFF2D4A2F),
                    fontWeight: FontWeight.w600,
                  ),
                  label: Text(s.filterAllVenues),
                ),
                ChoiceChip(
                  selected: _filter == _ListingFilterMode.favoritesOnly,
                  onSelected: (_) =>
                      _setFilter(_ListingFilterMode.favoritesOnly),
                  selectedColor: activeColor,
                  labelStyle: TextStyle(
                    color: _filter == _ListingFilterMode.favoritesOnly
                        ? Colors.white
                        : const Color(0xFF2D4A2F),
                    fontWeight: FontWeight.w600,
                  ),
                  label: Text(s.filterFavoriteVenues),
                ),
                ChoiceChip(
                  selected: _filter == _ListingFilterMode.nearHubs,
                  onSelected: (_) => _setFilter(_ListingFilterMode.nearHubs),
                  selectedColor: activeColor,
                  labelStyle: TextStyle(
                    color: _filter == _ListingFilterMode.nearHubs
                        ? Colors.white
                        : const Color(0xFF2D4A2F),
                    fontWeight: FontWeight.w600,
                  ),
                  label: Text(s.filterNearHubs),
                ),
                ChoiceChip(
                  selected: _filter == _ListingFilterMode.availableNow,
                  onSelected: (_) =>
                      _setFilter(_ListingFilterMode.availableNow),
                  selectedColor: activeColor,
                  labelStyle: TextStyle(
                    color: _filter == _ListingFilterMode.availableNow
                        ? Colors.white
                        : const Color(0xFF2D4A2F),
                    fontWeight: FontWeight.w600,
                  ),
                  label: Text(s.filterAvailableNow),
                ),
                if (_filter != _ListingFilterMode.all)
                  ActionChip(
                    avatar: const Icon(Icons.filter_alt_off_outlined, size: 16),
                    label: Text(s.clearFilter),
                    onPressed: () => _setFilter(_ListingFilterMode.all),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Text(
                  '${s.filterFavoriteVenues}: $favoriteCount',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const Spacer(),
                TextButton.icon(
                  onPressed: () => context.go('/map'),
                  icon: const Icon(Icons.map_outlined, size: 16),
                  label: Text(s.openMap),
                ),
              ],
            ),
          ],
        ),
      ),
    );
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
            onPressed: () => context.go('/my-reservations'),
            icon: const Icon(Icons.receipt_long_outlined),
            tooltip: s.myReservationsCta,
          ),
          IconButton(
            onPressed: _manualRefresh,
            icon: const Icon(Icons.refresh),
            tooltip: s.refresh,
          ),
          const LanguageMenuButton(),
        ],
      ),
      body: _desktopFrame(
        context,
        AnimatedBuilder(
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

                    final allListings =
                        listingSnapshot.data ?? const <Listing>[];
                    final now = DateTime.now();
                    final listings =
                        allListings
                            .where(
                              (listing) => switch (_filter) {
                                _ListingFilterMode.all => true,
                                _ListingFilterMode.favoritesOnly =>
                                  favoriteVenueIds.contains(listing.venueId),
                                _ListingFilterMode.nearHubs => _isNearTaipeiHub(
                                  venueMap[listing.venueId],
                                ),
                                _ListingFilterMode.availableNow =>
                                  !now.isBefore(listing.pickupStartAt) &&
                                      !now.isAfter(listing.pickupEndAt),
                              },
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
                      return _buildLoadingSkeleton();
                    }

                    if (listings.isEmpty) {
                      return Column(
                        children: [
                          if (!dependencies.usingFirebase) _buildModeNotice(s),
                          _buildFilterCard(
                            context,
                            s,
                            favoriteCount: favoriteVenueIds.length,
                          ),
                          Expanded(
                            child: ListView(
                              padding: const EdgeInsets.all(24),
                              children: [
                                const SizedBox(height: 48),
                                const Icon(
                                  Icons.lunch_dining_outlined,
                                  size: 48,
                                ),
                                const SizedBox(height: 12),
                                Text(
                                  s.noActiveListings,
                                  textAlign: TextAlign.center,
                                ),
                                const SizedBox(height: 12),
                                FilledButton.tonalIcon(
                                  onPressed: () => context.go('/map'),
                                  icon: const Icon(Icons.map_outlined),
                                  label: Text(
                                    AppScope.of(context).localeController.isZhTw
                                        ? '去場館地圖看看'
                                        : 'Open venue map',
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      );
                    }

                    return Column(
                      children: [
                        if (!dependencies.usingFirebase) _buildModeNotice(s),
                        _buildFilterCard(
                          context,
                          s,
                          favoriteCount: favoriteVenueIds.length,
                        ),
                        Expanded(
                          child: ListView.builder(
                            padding: const EdgeInsets.only(bottom: 24),
                            itemCount: listings.length,
                            itemBuilder: (context, index) {
                              final listing = listings[index];
                              final venue = venueMap[listing.venueId];
                              final donorName =
                                  listing.displayNameOptional
                                          ?.trim()
                                          .isNotEmpty ==
                                      true
                                  ? listing.displayNameOptional!.trim()
                                  : s.privateDonor;
                              final isFavorite = favoritesStore.isFavorite(
                                listing.venueId,
                              );
                              final badgeLabels = listing.enterpriseBadges
                                  .map(s.enterpriseBadgeLabel)
                                  .whereType<String>()
                                  .toList();
                              final badgeTag = badgeLabels.isEmpty
                                  ? null
                                  : badgeLabels.first;
                              final donorSuffix = badgeTag == null
                                  ? ''
                                  : ' · $badgeTag';
                              final minutesLeft = listing.expiresAt
                                  .difference(DateTime.now())
                                  .inMinutes
                                  .clamp(0, 9999);

                              return Card(
                                child: InkWell(
                                  onTap: () =>
                                      context.go('/listing/${listing.id}'),
                                  child: Padding(
                                    padding: const EdgeInsets.fromLTRB(
                                      16,
                                      14,
                                      12,
                                      14,
                                    ),
                                    child: Row(
                                      children: [
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              LayoutBuilder(
                                                builder: (context, constraints) {
                                                  final chip = Container(
                                                    padding:
                                                        const EdgeInsets.symmetric(
                                                          horizontal: 10,
                                                          vertical: 4,
                                                        ),
                                                    decoration: BoxDecoration(
                                                      color: BoxmatchColors
                                                          .warmSuccessBg,
                                                      borderRadius:
                                                          BorderRadius.circular(
                                                            999,
                                                          ),
                                                      border: Border.all(
                                                        color: BoxmatchColors
                                                            .warmBorder,
                                                      ),
                                                    ),
                                                    child: Text(
                                                      '${s.pickupCountdownLabel}: ${s.pickupCountdownValue(minutesLeft)}',
                                                      style: Theme.of(context)
                                                          .textTheme
                                                          .labelMedium
                                                          ?.copyWith(
                                                            color: const Color(
                                                              0xFF2D6A4F,
                                                            ),
                                                          ),
                                                    ),
                                                  );
                                                  final title = Text(
                                                    '${listing.itemType} · ${listing.quantityRemaining} left',
                                                    style: Theme.of(
                                                      context,
                                                    ).textTheme.titleMedium,
                                                  );
                                                  if (constraints.maxWidth <
                                                      260) {
                                                    return Column(
                                                      crossAxisAlignment:
                                                          CrossAxisAlignment
                                                              .start,
                                                      children: [
                                                        title,
                                                        const SizedBox(
                                                          height: 6,
                                                        ),
                                                        chip,
                                                      ],
                                                    );
                                                  }
                                                  return Row(
                                                    children: [
                                                      Expanded(child: title),
                                                      const SizedBox(width: 10),
                                                      chip,
                                                    ],
                                                  );
                                                },
                                              ),
                                              const SizedBox(height: 8),
                                              Text(
                                                '${formatDateTime(listing.pickupStartAt)} - ${formatDateTime(listing.pickupEndAt)}',
                                                style: Theme.of(context)
                                                    .textTheme
                                                    .bodyMedium
                                                    ?.copyWith(
                                                      fontWeight:
                                                          FontWeight.w600,
                                                    ),
                                              ),
                                              const SizedBox(height: 4),
                                              Text(
                                                '${venue?.name ?? 'Venue'} · ${listing.pickupPointText}',
                                                style: Theme.of(
                                                  context,
                                                ).textTheme.bodySmall,
                                              ),
                                              const SizedBox(height: 2),
                                              Text(
                                                '$donorName$donorSuffix',
                                                style: Theme.of(
                                                  context,
                                                ).textTheme.bodySmall,
                                              ),
                                            ],
                                          ),
                                        ),
                                        const SizedBox(width: 12),
                                        Column(
                                          children: [
                                            IconButton(
                                              icon: Icon(
                                                isFavorite
                                                    ? Icons.favorite
                                                    : Icons.favorite_border,
                                                color: isFavorite
                                                    ? Theme.of(
                                                        context,
                                                      ).colorScheme.error
                                                    : null,
                                              ),
                                              onPressed: () =>
                                                  favoritesStore.toggleFavorite(
                                                    listing.venueId,
                                                  ),
                                            ),
                                            FilledButton(
                                              onPressed: () => context.go(
                                                '/listing/${listing.id}',
                                              ),
                                              child: Text(s.reserveNow),
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                      ],
                    );
                  },
                );
              },
            );
          },
        ),
      ),
    );
  }

  Widget _buildLoadingSkeleton() {
    return ListView.builder(
      itemCount: 4,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      itemBuilder: (context, index) => Card(
        child: Container(
          height: 112,
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                height: 14,
                width: 180,
                color: BoxmatchColors.warmSurfaceAlt,
              ),
              const SizedBox(height: 10),
              Container(
                height: 12,
                width: double.infinity,
                color: BoxmatchColors.warmSurfaceAlt,
              ),
              const SizedBox(height: 6),
              Container(
                height: 12,
                width: 220,
                color: BoxmatchColors.warmSurfaceAlt,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _desktopFrame(BuildContext context, Widget child) {
    final width = MediaQuery.sizeOf(context).width;
    if (width < 1024) {
      return child;
    }
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1140),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: child,
        ),
      ),
    );
  }

  bool _isNearTaipeiHub(Venue? venue) {
    if (venue == null) return false;
    const taipeiCenterLat = 25.0478;
    const taipeiCenterLng = 121.5319;
    final d = _haversineKm(
      taipeiCenterLat,
      taipeiCenterLng,
      venue.latitude,
      venue.longitude,
    );
    return d <= 8.0;
  }

  double _haversineKm(double lat1, double lon1, double lat2, double lon2) {
    const earthRadiusKm = 6371.0;
    final dLat = _deg2rad(lat2 - lat1);
    final dLon = _deg2rad(lon2 - lon1);
    final a =
        math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(_deg2rad(lat1)) *
            math.cos(_deg2rad(lat2)) *
            math.sin(dLon / 2) *
            math.sin(dLon / 2);
    final c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
    return earthRadiusKm * c;
  }

  double _deg2rad(double degrees) => degrees * (math.pi / 180.0);
}

enum _ListingFilterMode { all, favoritesOnly, nearHubs, availableNow }
