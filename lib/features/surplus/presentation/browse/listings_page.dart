import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_scope.dart';
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
  }

  @override
  Widget build(BuildContext context) {
    final dependencies = AppScope.of(context);
    final repository = dependencies.repository;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Exhibition Surplus Food'),
        actions: [
          IconButton(
            onPressed: _manualRefresh,
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: StreamBuilder<List<Venue>>(
        stream: repository.watchVenues(),
        builder: (context, venuesSnapshot) {
          final venueMap = {
            for (final venue in venuesSnapshot.data ?? const <Venue>[])
              venue.id: venue,
          };

          return StreamBuilder<List<Listing>>(
            stream: repository.watchActiveListings(),
            builder: (context, listingSnapshot) {
              final listings = listingSnapshot.data ?? const <Listing>[];

              if (listingSnapshot.connectionState == ConnectionState.waiting &&
                  listings.isEmpty) {
                return const Center(child: CircularProgressIndicator());
              }

              if (listings.isEmpty) {
                return ListView(
                  padding: const EdgeInsets.all(24),
                  children: const [
                    SizedBox(height: 48),
                    Icon(Icons.lunch_dining_outlined, size: 48),
                    SizedBox(height: 12),
                    Text(
                      'No active listings right now.\nTry checking map view or post a new listing.',
                      textAlign: TextAlign.center,
                    ),
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
                            margin: const EdgeInsets.fromLTRB(12, 12, 12, 8),
                            child: const Padding(
                              padding: EdgeInsets.all(12),
                              child: Text(
                                'Running in local demo mode. Configure Firebase to persist live data across devices.',
                              ),
                            ),
                          ),
                        const Card(
                          margin: EdgeInsets.fromLTRB(12, 8, 12, 8),
                          child: Padding(
                            padding: EdgeInsets.all(12),
                            child: Text(
                              'Platform note: Boxmatch is a matching service only and does not guarantee food safety.',
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
                      : 'Private donor';

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
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.go('/listing/${listing.id}'),
                    ),
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
