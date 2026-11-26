import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_scope.dart';
import '../../../../core/i18n/app_strings.dart';
import '../../../../core/i18n/language_menu_button.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/load_error_view.dart';
import '../../../../core/utils/date_time_formatters.dart';
import '../../../surplus/data/surplus_repository.dart';
import '../../../surplus/domain/listing.dart';
import '../../../surplus/domain/reservation.dart';
import '../../../surplus/domain/surplus_exceptions.dart';

class MyReservationsPage extends StatefulWidget {
  const MyReservationsPage({super.key});

  @override
  State<MyReservationsPage> createState() => _MyReservationsPageState();
}

class _MyReservationsPageState extends State<MyReservationsPage> {
  static const _loadDeadline = Duration(seconds: 25);
  static const _listingDeadline = Duration(seconds: 5);
  static const _listingConcurrency = 6;
  List<Reservation>? _reservations;
  final Map<String, Listing?> _listingDetails = {};
  RecipientReservationReadCache? _cache;
  StreamSubscription<String?>? _uidSubscription;
  Future<void>? _hydration;
  String? _owner;
  bool _initialized = false, _loading = true, _loadError = false;
  bool _cancelling = false;
  int _generation = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_initialized) return;
    _initialized = true;
    final repository = AppScope.of(context).repository;
    if (repository is RecipientReservationReadCache) {
      _cache = repository as RecipientReservationReadCache;
      _uidSubscription = _cache!.recipientUidChanges.listen((uid) {
        if (!mounted || _owner == null || uid == _owner) return;
        setState(() {
          _generation++;
          _owner = null;
          _reservations = null;
          _listingDetails.clear();
          _loading = false;
          _loadError = true;
          _cancelling = false;
        });
      });
    }
    unawaited(_loadReservations());
  }

  bool _isCurrent(int generation) => mounted && generation == _generation;

  Future<void> _loadReservations() async {
    final deps = AppScope.of(context);
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _loadError = false;
    });
    try {
      final uid = await deps.identityService
          .ensureRecipientUid()
          .timeout(const Duration(seconds: 8));
      if (!_isCurrent(generation)) return;
      if (_cache != null && _cache!.currentRecipientUid != uid) {
        throw const PermissionDeniedException('Recipient identity unavailable.');
      }
      final cached = _cache?.cachedRecipientReservations(uid);
      setState(() {
        if (_owner != uid) {
          _reservations = null;
          _listingDetails.clear();
        }
        _owner = uid;
        if (cached != null) _reservations = cached;
      });
      // The repository owns retry policy. Never repeat the whole operation.
      final reservations = await deps.repository
          .listRecipientReservations(claimerUid: uid)
          .timeout(_loadDeadline);
      if (!_isCurrent(generation)) return;
      if (_cache != null && _cache!.currentRecipientUid != uid) {
        throw const PermissionDeniedException('Recipient identity changed.');
      }
      final listingIds = reservations.map((r) => r.listingId).toSet();
      setState(() {
        _reservations = reservations;
        _listingDetails.removeWhere((id, _) => !listingIds.contains(id));
        _loading = false;
      });
      // Pickup codes and statuses are already available. Listing enrichment is
      // independent, deduplicated and bounded; slow/missing details cannot block.
      final previous = _hydration ?? Future<void>.value();
      final hydration = previous.then((_) async {
        if (_isCurrent(generation)) {
          await _hydrateListings(deps.repository, reservations, generation);
        }
      });
      _hydration = hydration;
      unawaited(hydration);
    } catch (_) {
      if (!_isCurrent(generation)) return;
      setState(() {
        _reservations = null;
        _listingDetails.clear();
        _loading = false;
        _loadError = true;
      });
    }
  }

  Future<void> _hydrateListings(
    SurplusRepository repository,
    List<Reservation> reservations,
    int generation,
  ) async {
    final ids = reservations.map((r) => r.listingId).where((id) => id.isNotEmpty).toSet().toList();
    for (var start = 0; start < ids.length; start += _listingConcurrency) {
      if (!_isCurrent(generation)) return;
      await Future.wait(ids.skip(start).take(_listingConcurrency).map((id) async {
        try {
          final listing = await repository.watchListing(id)
              .timeout(_listingDeadline).first;
          if (_isCurrent(generation)) {
            setState(() => _listingDetails[id] = listing);
          }
        } catch (_) {
          // Keep the reservation visible; optional listing metadata is unavailable.
        }
      }));
    }
  }

  void _refresh() {
    if (_loading || _cancelling) return;
    unawaited(_loadReservations());
  }

  Future<void> _cancelReservation(Reservation reservation) async {
    if (_loading || _cancelling) return;
    final deps = AppScope.of(context);
    final s = AppStrings.of(context);
    final uid = _owner;
    if (uid == null || uid != reservation.claimerUid ||
        (_cache != null && _cache!.currentRecipientUid != uid)) {
      return;
    }
    final generation = _generation;
    setState(() => _cancelling = true);
    try {
      await deps.repository.cancelReservation(
        reservationId: reservation.id,
        claimerUid: uid,
      );
      if (!mounted || generation != _generation) return;
      setState(() {
        _reservations = _reservations?.map((item) =>
          item.id == reservation.id
              ? item.copyWith(status: ReservationStatus.cancelled)
              : item).toList();
        _cancelling = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(s.reservationCancelled)),
      );
      _refresh();
    } on SurplusException catch (error) {
      if (!mounted || generation != _generation) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.message)),
      );
    } finally {
      if (_isCurrent(generation)) setState(() => _cancelling = false);
    }
  }

  @override
  void dispose() {
    _generation++;
    unawaited(_uidSubscription?.cancel());
    super.dispose();
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
            onPressed: _loading || _cancelling ? null : _refresh,
            tooltip: s.refresh,
            icon: const Icon(Icons.refresh),
          ),
          const LanguageMenuButton(),
        ],
      ),
      body: desktopFrame(
        Builder(
          builder: (context) {
            if (_loading && (_reservations == null || _reservations!.isEmpty)) {
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
            if (_loadError) {
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

            final items = _reservations ?? const <Reservation>[];
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
                if (_loading)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      AppScope.of(context).localeController.isZhTw
                          ? '正在重新確認預約資料，暫時無法操作。'
                          : 'Refreshing reservations. Actions are temporarily unavailable.',
                    ),
                  ),
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
                ...items.map((reservation) {
                  final listing = _listingDetails[reservation.listingId];
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
                              onPressed: _loading || _cancelling
                                  ? null
                                  : () => _cancelReservation(reservation),
                              child: Text(s.cancelReservation),
                            )
                          : null,
                      onTap: _loading || _cancelling
                          ? null
                          : () => context.go(
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
