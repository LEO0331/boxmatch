// coverage:ignore-file
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_cancellable_tile_provider/flutter_map_cancellable_tile_provider.dart';
import 'package:latlong2/latlong.dart';

import '../../../../app/app_scope.dart';
import '../../../../core/i18n/app_strings.dart';
import '../../../../core/i18n/language_menu_button.dart';
import '../../../../core/widgets/load_error_view.dart';
import '../../../surplus/domain/listing.dart';
import '../../../surplus/domain/venue.dart';

class _TileProviderOption {
  const _TileProviderOption({
    required this.name,
    required this.urlTemplate,
    this.fallbackUrl,
    this.subdomains = const <String>[],
  });

  final String name;
  final String urlTemplate;
  final String? fallbackUrl;
  final List<String> subdomains;
}

const _tileProviderOptions = <_TileProviderOption>[
  _TileProviderOption(
    name: 'Carto Light',
    urlTemplate:
        'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    fallbackUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c', 'd'],
  ),
  _TileProviderOption(
    name: 'OpenStreetMap',
    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    fallbackUrl: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
  ),
  _TileProviderOption(
    name: 'OSM HOT',
    urlTemplate: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    fallbackUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
  ),
];

class VenuesMapPage extends StatefulWidget {
  const VenuesMapPage({super.key});

  @override
  State<VenuesMapPage> createState() => _VenuesMapPageState();
}

class _VenuesMapPageState extends State<VenuesMapPage> {
  int _providerIndex = 1;
  int _recentErrorCount = 0;
  DateTime? _lastErrorAt;
  DateTime? _lastSwitchAt;

  void _onTileError() {
    final now = DateTime.now();

    if (_lastErrorAt != null &&
        now.difference(_lastErrorAt!) > const Duration(seconds: 15)) {
      _recentErrorCount = 0;
    }

    _lastErrorAt = now;
    _recentErrorCount += 1;

    final inCooldown =
        _lastSwitchAt != null &&
        now.difference(_lastSwitchAt!) < const Duration(seconds: 20);

    if (!inCooldown && _recentErrorCount >= 10) {
      setState(() {
        _providerIndex = (_providerIndex + 1) % _tileProviderOptions.length;
        _recentErrorCount = 0;
        _lastSwitchAt = now;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final dependencies = AppScope.of(context);
    final repository = dependencies.repository;
    final favoritesStore = dependencies.favoritesStore;
    final provider = _tileProviderOptions[_providerIndex];
    final s = AppStrings.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(s.mapTitle),
        actions: const [LanguageMenuButton()],
      ),
      body: AnimatedBuilder(
        animation: favoritesStore,
        builder: (context, _) {
          return StreamBuilder<List<Venue>>(
            stream: repository.watchVenues(),
            builder: (context, venuesSnapshot) {
              if (venuesSnapshot.hasError) {
                return LoadErrorView(
                  title: s.genericLoadErrorTitle,
                  message: s.genericLoadErrorBody,
                  retryLabel: s.retry,
                  onRetry: () => setState(() {}),
                );
              }

              final venues = venuesSnapshot.data ?? const <Venue>[];

              return StreamBuilder<List<Listing>>(
                stream: repository.watchActiveListings(),
                builder: (context, listingSnapshot) {
                  if (listingSnapshot.hasError) {
                    return LoadErrorView(
                      title: s.genericLoadErrorTitle,
                      message: s.genericLoadErrorBody,
                      retryLabel: s.retry,
                      onRetry: () => setState(() {}),
                    );
                  }

                  final listings = listingSnapshot.data ?? const <Listing>[];
                  final listingCountByVenue = <String, int>{};
                  for (final listing in listings) {
                    listingCountByVenue[listing.venueId] =
                        (listingCountByVenue[listing.venueId] ?? 0) + 1;
                  }

                  final favoriteVenueIds = favoritesStore.favoriteVenueIds;
                  final sortedVenues = venues.toList()
                    ..sort((a, b) {
                      final aFav = favoriteVenueIds.contains(a.id) ? 1 : 0;
                      final bFav = favoriteVenueIds.contains(b.id) ? 1 : 0;
                      if (aFav != bFav) {
                        return bFav.compareTo(aFav);
                      }
                      return a.name.compareTo(b.name);
                    });

                  return Column(
                    children: [
                      Material(
                        color: Theme.of(
                          context,
                        ).colorScheme.surfaceContainerHighest,
                        child: SizedBox(
                          width: double.infinity,
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 8,
                            ),
                            child: Text(
                              s.mapSource(provider.name),
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ),
                        ),
                      ),
                      Expanded(
                        child: FlutterMap(
                          options: MapOptions(
                            initialCenter: venues.isNotEmpty
                                ? LatLng(
                                    venues.first.latitude,
                                    venues.first.longitude,
                                  )
                                : const LatLng(25.0478, 121.5319),
                            initialZoom: 12,
                            maxZoom: 18,
                          ),
                          children: [
                            TileLayer(
                              urlTemplate: provider.urlTemplate,
                              fallbackUrl: provider.fallbackUrl,
                              subdomains: provider.subdomains,
                              retinaMode:
                                  MediaQuery.devicePixelRatioOf(context) > 1.0,
                              userAgentPackageName: 'com.example.boxmatch',
                              tileProvider: CancellableNetworkTileProvider(),
                              errorTileCallback: (tile, error, stackTrace) =>
                                  _onTileError(),
                            ),
                            RichAttributionWidget(
                              attributions: const [
                                TextSourceAttribution(
                                  'OpenStreetMap contributors',
                                ),
                                TextSourceAttribution('CARTO'),
                              ],
                            ),
                            MarkerLayer(
                              markers: sortedVenues
                                  .map(
                                    (venue) => Marker(
                                      point: LatLng(
                                        venue.latitude,
                                        venue.longitude,
                                      ),
                                      width: 50,
                                      height: 50,
                                      child: Tooltip(
                                        message:
                                            '${venue.name}\n${s.activeCount(listingCountByVenue[venue.id] ?? 0)}',
                                        child: Icon(
                                          favoritesStore.isFavorite(venue.id)
                                              ? Icons.place
                                              : Icons.location_on,
                                          size: 36,
                                          color:
                                              favoritesStore.isFavorite(
                                                venue.id,
                                              )
                                              ? Theme.of(
                                                  context,
                                                ).colorScheme.error
                                              : null,
                                        ),
                                      ),
                                    ),
                                  )
                                  .toList(),
                            ),
                          ],
                        ),
                      ),
                      SizedBox(
                        height: 220,
                        child: ListView.builder(
                          itemCount: sortedVenues.length,
                          itemBuilder: (context, index) {
                            final venue = sortedVenues[index];
                            final count = listingCountByVenue[venue.id] ?? 0;
                            final isFavorite = favoritesStore.isFavorite(
                              venue.id,
                            );
                            return ListTile(
                              leading: const Icon(Icons.place_outlined),
                              title: Text(venue.name),
                              subtitle: Text(venue.address),
                              trailing: SizedBox(
                                width: 160,
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.end,
                                  children: [
                                    Expanded(
                                      child: Text(
                                        s.activeCount(count),
                                        textAlign: TextAlign.end,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                    IconButton(
                                      onPressed: () => favoritesStore
                                          .toggleFavorite(venue.id),
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
                                    ),
                                  ],
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
    );
  }
}
