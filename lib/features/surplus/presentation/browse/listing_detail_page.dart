import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_scope.dart';
import '../../../../core/i18n/app_strings.dart';
import '../../../../core/i18n/language_menu_button.dart';
import '../../../../core/widgets/load_error_view.dart';
import '../../../../core/utils/date_time_formatters.dart';
import 'reservation_confirmation_page.dart';
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
      final target = '/listing/${listing.id}/reservation/${reservation.id}';
      try {
        context.go(target);
      } catch (_) {
        if (!mounted) {
          return;
        }
        await Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => ReservationConfirmationPage(
              listingId: listing.id,
              reservationId: reservation.id,
            ),
          ),
        );
      }
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
    final s = AppStrings.of(context);
    var accepted = false;
    final result = await showDialog<bool>(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setLocalState) {
            return AlertDialog(
              title: Text(s.beforeReserving),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(s.reserveDisclaimer),
                  const SizedBox(height: 12),
                  CheckboxListTile(
                    value: accepted,
                    contentPadding: EdgeInsets.zero,
                    title: Text(s.reserveDisclaimerAccept),
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
                  child: Text(s.cancel),
                ),
                FilledButton(
                  onPressed: accepted
                      ? () => Navigator.of(context).pop(true)
                      : null,
                  child: Text(s.reserve),
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
    final s = AppStrings.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(s.listingDetailTitle),
        actions: const [LanguageMenuButton()],
      ),
      body: StreamBuilder<Listing?>(
        stream: repository.watchListing(widget.listingId),
        builder: (context, listingSnapshot) {
          if (listingSnapshot.hasError) {
            return LoadErrorView(
              title: s.genericLoadErrorTitle,
              message: s.genericLoadErrorBody,
              retryLabel: s.retry,
              onRetry: () => setState(() {}),
            );
          }

          final listing = listingSnapshot.data;
          if (listing == null) {
            if (listingSnapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            return Center(child: Text(s.listingNotFound));
          }

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
                            'Donor: ${listing.displayNameOptional?.trim().isNotEmpty == true ? listing.displayNameOptional : s.privateDonor}',
                          ),
                          if (listing.enterpriseBadges.isNotEmpty) ...[
                            const SizedBox(height: 6),
                            Wrap(
                              spacing: 6,
                              runSpacing: 6,
                              children: listing.enterpriseBadges
                                  .map(s.enterpriseBadgeLabel)
                                  .whereType<String>()
                                  .map(
                                    (label) => Chip(
                                      avatar: const Icon(
                                        Icons.verified,
                                        size: 16,
                                        color: Color(0xFF2D6A4F),
                                      ),
                                      label: Text(label),
                                    ),
                                  )
                                  .toList(),
                            ),
                          ],
                          const SizedBox(height: 8),
                          Chip(
                            label: Text(
                              'Status: ${s.statusLabel(_statusToLabel(status))}',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(s.reserveDisclaimer),
                          const SizedBox(height: 8),
                          Text(
                            s.publicPickupOnlyNotice,
                            style: const TextStyle(
                              color: Color(0xFF7A4A00),
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
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
                    label: Text(s.reserveOneItem),
                  ),
                ],
              );
            },
          );
        },
      ),
    );
  }

  AppStatusLabel _statusToLabel(ListingStatus status) {
    switch (status) {
      case ListingStatus.active:
        return AppStatusLabel.active;
      case ListingStatus.reserved:
        return AppStatusLabel.reserved;
      case ListingStatus.expired:
        return AppStatusLabel.expired;
      case ListingStatus.completed:
        return AppStatusLabel.completed;
    }
  }
}
