import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../../../app/app_scope.dart';
import '../../../surplus/domain/listing.dart';
import '../../../surplus/domain/venue.dart';

class VenuesMapPage extends StatelessWidget {
  const VenuesMapPage({super.key});

  @override
  Widget build(BuildContext context) {
    final repository = AppScope.of(context).repository;

    return Scaffold(
      appBar: AppBar(title: const Text('Venue Map')),
      body: StreamBuilder<List<Venue>>(
        stream: repository.watchVenues(),
        builder: (context, venuesSnapshot) {
          final venues = venuesSnapshot.data ?? const <Venue>[];

          return StreamBuilder<List<Listing>>(
            stream: repository.watchActiveListings(),
            builder: (context, listingSnapshot) {
              final listings = listingSnapshot.data ?? const <Listing>[];
              final listingCountByVenue = <String, int>{};
              for (final listing in listings) {
                listingCountByVenue[listing.venueId] =
                    (listingCountByVenue[listing.venueId] ?? 0) + 1;
              }

              return Column(
                children: [
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
                          urlTemplate:
                              'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                          userAgentPackageName: 'com.example.boxmatch',
                        ),
                        MarkerLayer(
                          markers: venues
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
                                        '${venue.name}\n${listingCountByVenue[venue.id] ?? 0} active',
                                    child: const Icon(
                                      Icons.location_on,
                                      size: 36,
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
                      itemCount: venues.length,
                      itemBuilder: (context, index) {
                        final venue = venues[index];
                        final count = listingCountByVenue[venue.id] ?? 0;
                        return ListTile(
                          leading: const Icon(Icons.place_outlined),
                          title: Text(venue.name),
                          subtitle: Text(venue.address),
                          trailing: Text('$count active'),
                        );
                      },
                    ),
                  ),
                ],
              );
            },
          );
        },
      ),
    );
  }
}
