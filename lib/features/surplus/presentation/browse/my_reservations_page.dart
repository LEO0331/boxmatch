import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_scope.dart';
import '../../../../core/i18n/app_strings.dart';
import '../../../../core/i18n/language_menu_button.dart';
import '../../../../core/theme/app_theme.dart';
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
  static const Duration _loadRetryDelay = Duration(milliseconds: 700);
  Future<String>? _uidFuture;
  Future<List<_ReservationWithListing>>? _loadFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _uidFuture ??= AppScope.of(context).identityService.ensureRecipientUid();
    _loadFuture ??= _loadReservations();
  }

  Future<List<_ReservationWithListing>> _loadReservations() async {
    try {
      return await _loadReservationsOnce();
    } on SurplusException {
      await Future<void>.delayed(_loadRetryDelay);
      return _loadReservationsOnce();
    } catch (_) {
      await Future<void>.delayed(_loadRetryDelay);
      return _loadReservationsOnce();
    }
  }

  Future<List<_ReservationWithListing>> _loadReservationsOnce() async {
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
    Widget desktopFrame(Widget child) {
      final width = MediaQuery.sizeOf(context).width;
      if (width < 1024) {
        return child;
      }
      return Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1100),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: child,
          ),
        ),
      );
    }

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
      body: desktopFrame(
        FutureBuilder<List<_ReservationWithListing>>(
          future: _loadFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return ListView.builder(
                padding: const EdgeInsets.all(12),
                itemCount: 4,
                itemBuilder: (context, index) => Card(
                  child: Container(
                    height: 96,
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          height: 14,
                          width: 140,
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
                          width: 200,
                          color: BoxmatchColors.warmSurfaceAlt,
                        ),
                      ],
                    ),
                  ),
                ),
              );
            }
            if (snapshot.hasError) {
              return Column(
                children: [
                  Container(
                    margin: const EdgeInsets.fromLTRB(12, 12, 12, 0),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: BoxmatchColors.warmWarningBg,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: const Color(0xFFE5C27A)),
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.hourglass_top_rounded,
                          color: BoxmatchColors.warmWarningText,
                        ),
                        const SizedBox(width: 8),
                        Expanded(child: Text(s.apiWarmupRetryHint)),
                      ],
                    ),
                  ),
                  Expanded(
                    child: LoadErrorView(
                      title: s.genericLoadErrorTitle,
                      message: s.genericLoadErrorBody,
                      retryLabel: s.retry,
                      onRetry: _refresh,
                    ),
                  ),
                ],
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
                  final badgeLabels =
                      (listing?.enterpriseBadges ?? const <String>[])
                          .map(s.enterpriseBadgeLabel)
                          .whereType<String>()
                          .toList();
                  final statusLabel = s.statusLabel(
                    switch (reservation.status) {
                      ReservationStatus.reserved => AppStatusLabel.reserved,
                      ReservationStatus.completed => AppStatusLabel.completed,
                      ReservationStatus.expired => AppStatusLabel.expired,
                      ReservationStatus.cancelled => AppStatusLabel.cancelled,
                    },
                  );
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
                          if (badgeLabels.isNotEmpty) ...[
                            const SizedBox(height: 6),
                            Wrap(
                              spacing: 6,
                              runSpacing: 6,
                              children: badgeLabels
                                  .map(
                                    (label) => Chip(
                                      visualDensity: VisualDensity.compact,
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
      ),
    );
  }
}
