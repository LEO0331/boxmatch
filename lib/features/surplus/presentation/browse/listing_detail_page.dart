import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_scope.dart';
import '../../../../core/utils/date_time_formatters.dart';
import '../../../surplus/domain/listing.dart';
import '../../../surplus/domain/surplus_exceptions.dart';
import '../../../surplus/domain/venue.dart';

class ListingDetailPage extends StatefulWidget {
  const ListingDetailPage({required this.listingId, super.key});

  final String listingId;

  @override
  State<ListingDetailPage> createState() => _ListingDetailPageState();
}

class _ListingDetailPageState extends State<ListingDetailPage> {
  Future<String>? _uidFuture;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _uidFuture ??= AppScope.of(context).identityService.ensureRecipientUid();
  }

  Future<void> _reserve(Listing listing) async {
    final accepted = await _showReserveDisclaimer();
    if (!accepted || !mounted) {
      return;
    }

    final dependencies = AppScope.of(context);
    final uid =
        await (_uidFuture ??
            AppScope.of(context).identityService.ensureRecipientUid());

    setState(() {
      _busy = true;
    });

    try {
      final reservation = await dependencies.repository.reserveListing(
        listingId: listing.id,
        claimerUid: uid,
        qty: 1,
        disclaimerAccepted: true,
      );
      if (!mounted) {
        return;
      }
      context.go('/listing/${listing.id}/reservation/${reservation.id}');
    } on SurplusException catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
        });
      }
    }
  }

  Future<bool> _showReserveDisclaimer() async {
    var accepted = false;
    final result = await showDialog<bool>(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setLocalState) {
            return AlertDialog(
              title: const Text('Before reserving'),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'This app only matches donors and recipients. Boxmatch does not guarantee food safety.',
                  ),
                  const SizedBox(height: 12),
                  CheckboxListTile(
                    value: accepted,
                    contentPadding: EdgeInsets.zero,
                    title: const Text(
                      'I understand and accept this disclaimer.',
                    ),
                    onChanged: (value) {
                      setLocalState(() {
                        accepted = value ?? false;
                      });
                    },
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  child: const Text('Cancel'),
                ),
                FilledButton(
                  onPressed: accepted
                      ? () => Navigator.of(context).pop(true)
                      : null,
                  child: const Text('Reserve'),
                ),
              ],
            );
          },
        );
      },
    );
    return result ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final dependencies = AppScope.of(context);
    final repository = dependencies.repository;

    return Scaffold(
      appBar: AppBar(title: const Text('Listing details')),
      body: StreamBuilder<Listing?>(
        stream: repository.watchListing(widget.listingId),
        builder: (context, listingSnapshot) {
          final listing = listingSnapshot.data;
          if (listing == null) {
            if (listingSnapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            return const Center(child: Text('Listing not found.'));
          }

          return StreamBuilder<List<Venue>>(
            stream: repository.watchVenues(),
            builder: (context, venuesSnapshot) {
              final venueMap = {
                for (final venue in venuesSnapshot.data ?? const <Venue>[])
                  venue.id: venue,
              };
              final venue = venueMap[listing.venueId];
              final status = listing.resolvedStatus(DateTime.now());
              final canReserve =
                  status == ListingStatus.active &&
                  listing.quantityRemaining > 0;

              return ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${listing.itemType} · ${listing.quantityRemaining}/${listing.quantityTotal}',
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                          const SizedBox(height: 8),
                          Text(listing.description),
                          const SizedBox(height: 8),
                          Text('Venue: ${venue?.name ?? listing.venueId}'),
                          Text('Pickup point: ${listing.pickupPointText}'),
                          Text(
                            'Pickup window: ${formatDateTime(listing.pickupStartAt)} - ${formatDateTime(listing.pickupEndAt)}',
                          ),
                          Text('Expires: ${formatDateTime(listing.expiresAt)}'),
                          Text(
                            'Donor: ${listing.displayNameOptional?.trim().isNotEmpty == true ? listing.displayNameOptional : 'Private donor'}',
                          ),
                          const SizedBox(height: 8),
                          Chip(label: Text('Status: ${status.name}')),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  const Card(
                    child: Padding(
                      padding: EdgeInsets.all(16),
                      child: Text(
                        'Food safety disclaimer: Boxmatch is a matching platform only. Please inspect items at pickup and decide if they are suitable.',
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: canReserve && !_busy
                        ? () => _reserve(listing)
                        : null,
                    icon: _busy
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.check_circle_outline),
                    label: const Text('Reserve 1 item'),
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
