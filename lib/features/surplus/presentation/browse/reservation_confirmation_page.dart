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

class ReservationConfirmationPage extends StatelessWidget {
  const ReservationConfirmationPage({
    required this.listingId,
    required this.reservationId,
    super.key,
  });

  final String listingId;
  final String reservationId;

  Future<String?> _pickRiskReason(BuildContext context) async {
    final s = AppStrings.of(context);
    final reasons = <({String code, String label})>[
      (
        code: 'recipient_report_private_location_request',
        label: s.riskReasonPrivateLocation,
      ),
      (
        code: 'recipient_report_suspicious_behavior',
        label: s.riskReasonSuspiciousBehavior,
      ),
      (
        code: 'recipient_report_public_handoff_no_show',
        label: s.riskReasonNoShow,
      ),
      (
        code: 'recipient_report_food_condition_unsafe',
        label: s.riskReasonUnsafeCondition,
      ),
      (code: 'recipient_report_other', label: s.riskReasonOther),
    ];

    return showDialog<String>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(s.reportRiskSelectReasonTitle),
          content: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: reasons
                    .map(
                      (reason) => ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        title: Text(reason.label),
                        onTap: () => Navigator.of(context).pop(reason.code),
                      ),
                    )
                    .toList(),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: Text(s.cancel),
            ),
          ],
        );
      },
    );
  }

  Future<void> _reportAbuse(BuildContext context) async {
    final deps = AppScope.of(context);
    final s = AppStrings.of(context);
    final reason = await _pickRiskReason(context);
    if (reason == null || reason.isEmpty || !context.mounted) {
      return;
    }
    try {
      final uid = await deps.identityService.ensureRecipientUid();
      await deps.repository.addAbuseSignal(
        listingId: listingId,
        claimerUid: uid,
        reason: reason,
      );
      if (!context.mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(s.abuseReported)));
    } on SurplusException catch (error) {
      if (!context.mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  IconData _badgeIcon(String badgeId) {
    switch (badgeId) {
      case 'verified':
        return Icons.verified;
      case 'quality_trusted':
        return Icons.emoji_events_outlined;
      case 'high_impact':
        return Icons.workspace_premium_outlined;
      case 'flexible_pickup':
        return Icons.schedule_outlined;
      case 'stable_shelf_life':
        return Icons.inventory_2_outlined;
      default:
        return Icons.star_outline;
    }
  }

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
              final badgeIds = (listing?.enterpriseBadges ?? const <String>[])
                  .toSet()
                  .toList();

              return ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      if (identityService.isUsingLocalFallback)
                        Card(
                          color: Theme.of(
                            context,
                          ).colorScheme.surfaceContainerHigh,
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Text(s.offlineIdentityMode),
                          ),
                        ),
                      if (identityService.isUsingLocalFallback)
                        const SizedBox(height: 12),
                      Card(
                        color: Theme.of(
                          context,
                        ).colorScheme.surfaceContainerLow,
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
                      const SizedBox(height: 12),
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(20),
                          child: Column(
                            children: [
                              Text(
                                reservation.pickupCode,
                                style: Theme.of(
                                  context,
                                ).textTheme.displayMedium,
                              ),
                              const SizedBox(height: 8),
                              Text(s.showPickupCodeHelp),
                              const SizedBox(height: 12),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  OutlinedButton.icon(
                                    onPressed: () =>
                                        context.go('/my-reservations'),
                                    icon: const Icon(
                                      Icons.receipt_long_outlined,
                                    ),
                                    label: Text(s.myReservationsCta),
                                  ),
                                  OutlinedButton.icon(
                                    onPressed: () => context.go('/'),
                                    icon: const Icon(Icons.home_outlined),
                                    label: Text(
                                      AppScope.of(context)
                                              .localeController
                                              .isZhTw
                                          ? '回清單'
                                          : 'Back to listings',
                                    ),
                                  ),
                                ],
                              ),
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
                                Text(
                                  'Pickup point: ${listing.pickupPointText}',
                                ),
                                if ((listing.displayNameOptional ?? '')
                                    .trim()
                                    .isNotEmpty)
                                  Text(
                                    'Enterprise: ${listing.displayNameOptional}',
                                  ),
                                if (badgeIds.isNotEmpty)
                                  Padding(
                                    padding: const EdgeInsets.only(
                                      top: 6,
                                      bottom: 4,
                                    ),
                                    child: Wrap(
                                      spacing: 8,
                                      runSpacing: 6,
                                      children: badgeIds
                                          .map((badgeId) {
                                            final label =
                                                s.enterpriseBadgeLabel(badgeId);
                                            if (label == null) {
                                              return null;
                                            }
                                            return Chip(
                                              avatar: Icon(
                                                _badgeIcon(badgeId),
                                                size: 16,
                                                color: const Color(0xFF2D6A4F),
                                              ),
                                              label: Text(label),
                                            );
                                          })
                                          .whereType<Widget>()
                                          .toList(),
                                    ),
                                  ),
                                Text(
                                  'Pickup window: ${formatDateTime(listing.pickupStartAt)} - ${formatDateTime(listing.pickupEndAt)}',
                                ),
                              ],
                              Text(
                                'Reservation expires at: ${formatDateTime(reservation.expiresAt)}',
                              ),
                              const SizedBox(height: 12),
                              Text(
                                s.publicPickupOnlyNotice,
                                style: const TextStyle(
                                  color: Color(0xFF7A4A00),
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: 10),
                              OutlinedButton.icon(
                                onPressed: () => _reportAbuse(context),
                                icon: const Icon(
                                  Icons.report_gmailerrorred_outlined,
                                ),
                                label: Text(s.reportSafetyConcern),
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
