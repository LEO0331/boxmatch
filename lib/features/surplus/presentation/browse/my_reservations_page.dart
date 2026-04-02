import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_scope.dart';
import '../../../../core/i18n/app_strings.dart';
import '../../../../core/i18n/language_menu_button.dart';
import '../../../../core/widgets/load_error_view.dart';
import '../../../../core/utils/date_time_formatters.dart';
import '../../../surplus/domain/listing.dart';
import '../../../surplus/domain/reservation.dart';
import '../../../surplus/domain/surplus_exceptions.dart';

class _ReservationWithListing {
  const _ReservationWithListing({
    required this.reservation,
    required this.listing,
  });

  final Reservation reservation;
  final Listing? listing;
}

class MyReservationsPage extends StatefulWidget {
  const MyReservationsPage({super.key});

  @override
  State<MyReservationsPage> createState() => _MyReservationsPageState();
}

class _MyReservationsPageState extends State<MyReservationsPage> {
  Future<String>? _uidFuture;
  Future<List<_ReservationWithListing>>? _loadFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _uidFuture ??= AppScope.of(context).identityService.ensureRecipientUid();
    _loadFuture ??= _loadReservations();
  }

  Future<List<_ReservationWithListing>> _loadReservations() async {
    final deps = AppScope.of(context);
    final uid = await (_uidFuture ?? deps.identityService.ensureRecipientUid());
    final reservations = await deps.repository.listRecipientReservations(
      claimerUid: uid,
    );
    final items = await Future.wait(
      reservations.map((reservation) async {
        final listing = await deps.repository
            .watchListing(reservation.listingId)
            .first;
        return _ReservationWithListing(
          reservation: reservation,
          listing: listing,
        );
      }),
    );
    return items;
  }

  void _refresh() {
    setState(() {
      _loadFuture = _loadReservations();
    });
  }

  Future<void> _cancelReservation(Reservation reservation) async {
    final deps = AppScope.of(context);
    final s = AppStrings.of(context);
    final uid = await (_uidFuture ?? deps.identityService.ensureRecipientUid());
    try {
      await deps.repository.cancelReservation(
        reservationId: reservation.id,
        claimerUid: uid,
      );
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(s.reservationCancelled)));
      _refresh();
    } on SurplusException catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Color _statusColor(ReservationStatus status) {
    switch (status) {
      case ReservationStatus.reserved:
        return const Color(0xFF2D6A4F);
      case ReservationStatus.completed:
        return const Color(0xFF1D8348);
      case ReservationStatus.expired:
        return const Color(0xFF8E7D63);
      case ReservationStatus.cancelled:
        return const Color(0xFF9E9E9E);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = AppStrings.of(context);
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          onPressed: () => context.go('/'),
          tooltip: s.navListings,
          icon: const Icon(Icons.arrow_back),
        ),
        title: Text(s.myReservationsTitle),
        actions: [
          IconButton(
            onPressed: _refresh,
            tooltip: s.refresh,
            icon: const Icon(Icons.refresh),
          ),
          const LanguageMenuButton(),
        ],
      ),
      body: FutureBuilder<List<_ReservationWithListing>>(
        future: _loadFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return LoadErrorView(
              title: s.genericLoadErrorTitle,
              message: s.genericLoadErrorBody,
              retryLabel: s.retry,
              onRetry: _refresh,
            );
          }

          final items = snapshot.data ?? const <_ReservationWithListing>[];
          if (items.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.receipt_long_outlined, size: 44),
                    const SizedBox(height: 10),
                    Text(s.noMyReservations),
                    const SizedBox(height: 12),
                    FilledButton.tonalIcon(
                      onPressed: () => context.go('/'),
                      icon: const Icon(Icons.search_outlined),
                      label: Text(
                        AppScope.of(context).localeController.isZhTw
                            ? '去找可領取餐點'
                            : 'Browse listings',
                      ),
                    ),
                  ],
                ),
              ),
            );
          }

          final aliasFrequency = <String, int>{};
          for (final item in items) {
            final alias = item.listing?.displayNameOptional?.trim() ?? '';
            if (alias.isEmpty) {
              continue;
            }
            final normalized = alias.toLowerCase();
            aliasFrequency[normalized] = (aliasFrequency[normalized] ?? 0) + 1;
          }

          return ListView(
            padding: const EdgeInsets.all(12),
            children: [
              Card(
                color: Theme.of(context).colorScheme.surfaceContainerLow,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        s.privacyFaqTitle,
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        s.privacyNotice,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        s.faqNotice,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              ...items.map((item) {
                final reservation = item.reservation;
                final listing = item.listing;
                final alias = listing?.displayNameOptional?.trim() ?? '';
                final isFrequentEnterprise =
                    alias.isNotEmpty &&
                    (aliasFrequency[alias.toLowerCase()] ?? 0) >= 2;
                final statusLabel = s.statusLabel(switch (reservation.status) {
                  ReservationStatus.reserved => AppStatusLabel.reserved,
                  ReservationStatus.completed => AppStatusLabel.completed,
                  ReservationStatus.expired => AppStatusLabel.expired,
                  ReservationStatus.cancelled => AppStatusLabel.cancelled,
                });
                return Card(
                  child: ListTile(
                    title: Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(listing?.itemType ?? 'Item'),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: _statusColor(
                              reservation.status,
                            ).withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            statusLabel,
                            style: TextStyle(
                              color: _statusColor(reservation.status),
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'Code: ${reservation.pickupCode}\n'
                          'Pickup: ${listing?.pickupPointText ?? '-'}\n'
                          'Expires: ${formatDateTime(reservation.expiresAt)}',
                        ),
                        if (isFrequentEnterprise) ...[
                          const SizedBox(height: 6),
                          Chip(
                            visualDensity: VisualDensity.compact,
                            avatar: const Icon(
                              Icons.verified,
                              size: 16,
                              color: Color(0xFF2D6A4F),
                            ),
                            label: Text(s.frequentEnterprise),
                          ),
                        ],
                      ],
                    ),
                    trailing: reservation.status == ReservationStatus.reserved
                        ? OutlinedButton(
                            onPressed: () => _cancelReservation(reservation),
                            child: Text(s.cancelReservation),
                          )
                        : null,
                    onTap: () => context.go(
                      '/listing/${reservation.listingId}/reservation/${reservation.id}',
                    ),
                  ),
                );
              }),
            ],
          );
        },
      ),
    );
  }
}
