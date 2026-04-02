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
            return Center(child: Text(s.noMyReservations));
          }

          return ListView.builder(
            padding: const EdgeInsets.all(12),
            itemCount: items.length,
            itemBuilder: (context, index) {
              final item = items[index];
              final reservation = item.reservation;
              final listing = item.listing;
              final statusLabel = s.statusLabel(switch (reservation.status) {
                ReservationStatus.reserved => AppStatusLabel.reserved,
                ReservationStatus.completed => AppStatusLabel.completed,
                ReservationStatus.expired => AppStatusLabel.expired,
                ReservationStatus.cancelled => AppStatusLabel.cancelled,
              });
              return Card(
                child: ListTile(
                  title: Text('${listing?.itemType ?? 'Item'} · $statusLabel'),
                  subtitle: Text(
                    'Code: ${reservation.pickupCode}\n'
                    'Pickup: ${listing?.pickupPointText ?? '-'}\n'
                    'Expires: ${formatDateTime(reservation.expiresAt)}',
                  ),
                  isThreeLine: true,
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
            },
          );
        },
      ),
    );
  }
}
