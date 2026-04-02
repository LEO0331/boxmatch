import 'package:flutter/material.dart';

import '../../../../app/app_scope.dart';
import '../../../../core/i18n/app_strings.dart';
import '../../../../core/i18n/language_menu_button.dart';
import '../../../../core/widgets/load_error_view.dart';
import '../../../../core/utils/date_time_formatters.dart';
import '../../../surplus/domain/listing.dart';
import '../../../surplus/domain/reservation.dart';

class ReservationConfirmationPage extends StatelessWidget {
  const ReservationConfirmationPage({
    required this.listingId,
    required this.reservationId,
    super.key,
  });

  final String listingId;
  final String reservationId;

  @override
  Widget build(BuildContext context) {
    final dependencies = AppScope.of(context);
    final repository = dependencies.repository;
    final identityService = dependencies.identityService;
    final s = AppStrings.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(s.reservationConfirmed),
        actions: const [LanguageMenuButton()],
      ),
      body: StreamBuilder<Reservation?>(
        stream: repository.watchReservation(reservationId),
        builder: (context, reservationSnapshot) {
          if (reservationSnapshot.hasError) {
            return LoadErrorView(
              title: s.genericLoadErrorTitle,
              message: s.genericLoadErrorBody,
              retryLabel: s.retry,
              onRetry: () {},
            );
          }

          final reservation = reservationSnapshot.data;
          if (reservation == null) {
            if (reservationSnapshot.connectionState ==
                ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            return Center(child: Text(s.reservationNotFound));
          }

          return StreamBuilder<Listing?>(
            stream: repository.watchListing(listingId),
            builder: (context, listingSnapshot) {
              if (listingSnapshot.hasError) {
                return LoadErrorView(
                  title: s.genericLoadErrorTitle,
                  message: s.genericLoadErrorBody,
                  retryLabel: s.retry,
                  onRetry: () {},
                );
              }

              final listing = listingSnapshot.data;
              return ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (identityService.isUsingLocalFallback)
                    Card(
                      color: Theme.of(context).colorScheme.surfaceContainerHigh,
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Text(s.offlineIdentityMode),
                      ),
                    ),
                  if (identityService.isUsingLocalFallback)
                    const SizedBox(height: 12),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        children: [
                          Text(
                            reservation.pickupCode,
                            style: Theme.of(context).textTheme.displayMedium,
                          ),
                          const SizedBox(height: 8),
                          Text(s.showPickupCodeHelp),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  _ReservationStatusTimeline(reservation: reservation),
                  const SizedBox(height: 12),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Reservation status: ${s.statusLabel(_statusToLabel(reservation.status))}',
                          ),
                          const SizedBox(height: 8),
                          if (listing != null) ...[
                            Text('Item: ${listing.itemType}'),
                            Text('Pickup point: ${listing.pickupPointText}'),
                            Text(
                              'Pickup window: ${formatDateTime(listing.pickupStartAt)} - ${formatDateTime(listing.pickupEndAt)}',
                            ),
                          ],
                          Text(
                            'Reservation expires at: ${formatDateTime(reservation.expiresAt)}',
                          ),
                        ],
                      ),
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

  AppStatusLabel _statusToLabel(ReservationStatus status) {
    switch (status) {
      case ReservationStatus.reserved:
        return AppStatusLabel.reserved;
      case ReservationStatus.completed:
        return AppStatusLabel.completed;
      case ReservationStatus.expired:
        return AppStatusLabel.expired;
      case ReservationStatus.cancelled:
        return AppStatusLabel.cancelled;
    }
  }
}

class _ReservationStatusTimeline extends StatelessWidget {
  const _ReservationStatusTimeline({required this.reservation});

  final Reservation reservation;

  @override
  Widget build(BuildContext context) {
    final s = AppStrings.of(context);
    final status = reservation.status;

    final steps = <_TimelineStep>[
      _TimelineStep(
        label: s.statusLabel(AppStatusLabel.reserved),
        active: true,
        icon: Icons.check_circle,
      ),
      _TimelineStep(
        label: s.statusLabel(AppStatusLabel.completed),
        active: status == ReservationStatus.completed,
        icon: Icons.task_alt,
      ),
      _TimelineStep(
        label: s.statusLabel(AppStatusLabel.expired),
        active: status == ReservationStatus.expired,
        icon: Icons.hourglass_disabled,
      ),
      _TimelineStep(
        label: s.statusLabel(AppStatusLabel.cancelled),
        active: status == ReservationStatus.cancelled,
        icon: Icons.cancel,
      ),
    ];

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              AppScope.of(context).localeController.isZhTw
                  ? '取餐狀態時間軸'
                  : 'Pickup status timeline',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 10),
            ...steps.map(
              (step) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Icon(
                      step.icon,
                      color: step.active
                          ? Theme.of(context).colorScheme.primary
                          : Theme.of(context).disabledColor,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      step.label,
                      style: TextStyle(
                        fontWeight: step.active
                            ? FontWeight.w600
                            : FontWeight.normal,
                        color: step.active
                            ? null
                            : Theme.of(context).textTheme.bodyMedium?.color,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TimelineStep {
  const _TimelineStep({
    required this.label,
    required this.active,
    required this.icon,
  });

  final String label;
  final bool active;
  final IconData icon;
}
