class TrafficPeriod {
  const TrafficPeriod({
    required this.startDate,
    required this.endDate,
    this.timezone = 'UTC',
  });
  final String startDate;
  final String endDate;
  final String timezone;
}

class TrafficCoverage {
  const TrafficCoverage({
    required this.requestedDays,
    required this.availableDays,
    required this.missingDays,
    this.invalidDays = 0,
    this.unsupportedDays = 0,
    this.lastPersistedAt,
  });
  final int requestedDays;
  final int availableDays;
  final int missingDays;
  final int invalidDays;
  final int unsupportedDays;
  final DateTime? lastPersistedAt;
}

class TrafficDay {
  const TrafficDay({
    required this.date,
    required this.available,
    required this.status,
    this.pageViews,
    this.apiRequests,
    this.apiSuccess,
    this.clientErrors,
    this.serverErrors,
    this.aborted,
    this.suspicious,
    this.highRisk,
  });
  final String date;
  final bool available;
  final String status;
  final int? pageViews;
  final int? apiRequests;
  final int? apiSuccess;
  final int? clientErrors;
  final int? serverErrors;
  final int? aborted;
  final int? suspicious;
  final int? highRisk;
}

class TrafficOverview {
  const TrafficOverview({
    required this.period,
    required this.coverage,
    required this.summary,
    required this.dailyTrends,
    required this.api,
    required this.website,
    required this.network,
    required this.dataQuality,
    this.probes,
  });

  final TrafficPeriod period;
  final TrafficCoverage coverage;
  final Map<String, dynamic> summary;
  final List<TrafficDay> dailyTrends;
  final Map<String, dynamic> api;
  final Map<String, dynamic> website;
  final Map<String, dynamic> network;
  final Map<String, dynamic> dataQuality;
  final TrafficProbeOverview? probes;

  factory TrafficOverview.fromJson(Map<String, dynamic> value) {
    if (value['schemaVersion'] != 1) {
      throw const FormatException('Unsupported analytics schema.');
    }
    final period = _object(value['period']);
    final coverage = _object(value['coverage']);
    if (period['timezone'] != 'UTC') {
      throw const FormatException('Unsupported analytics timezone.');
    }
    final start = _date(period['startDate']);
    final end = _date(period['endDate']);
    final requested = _integer(coverage['requestedDays']);
    final available = _integer(coverage['availableDays']);
    final missing = _integer(coverage['missingDays']);
    final invalid = _integer(coverage['invalidDays']);
    final unsupported = _integer(coverage['unsupportedDays']);
    if (requested < 1 ||
        requested > 90 ||
        available + missing + invalid + unsupported != requested) {
      throw const FormatException('Invalid analytics coverage.');
    }
    final startTime = DateTime.parse('${start}T00:00:00Z');
    final endTime = DateTime.parse('${end}T00:00:00Z');
    if (endTime.difference(startTime).inDays + 1 != requested) {
      throw const FormatException('Invalid analytics period.');
    }
    final rawDays = value['dailyTrends'];
    if (rawDays is! List || rawDays.length != requested) {
      throw const FormatException('Invalid daily analytics.');
    }
    final days = rawDays
        .asMap()
        .entries
        .map((entry) {
          final raw = entry.value;
          final day = _object(raw);
          final date = _date(day['date']);
          if (date !=
              startTime
                  .add(Duration(days: entry.key))
                  .toIso8601String()
                  .substring(0, 10)) {
            throw const FormatException('Invalid daily ordering.');
          }
          final status = day['status'];
          if (!{
                'available',
                'missing',
                'invalid',
                'unsupported',
              }.contains(status) ||
              day['available'] != (status == 'available')) {
            throw const FormatException('Invalid daily status.');
          }
          int? metric(String key) =>
              status == 'available' ? _integer(day[key]) : null;
          return TrafficDay(
            date: date,
            available: status == 'available',
            status: status as String,
            pageViews: metric('pageViews'),
            apiRequests: metric('apiRequests'),
            apiSuccess: metric('apiSuccess'),
            clientErrors: metric('clientErrors'),
            serverErrors: metric('serverErrors'),
            aborted: metric('aborted'),
            suspicious: metric('suspicious'),
            highRisk: metric('highRisk'),
          );
        })
        .toList(growable: false);
    final timestamp = coverage['lastPersistedAt'];
    final persisted = timestamp == null
        ? null
        : timestamp is String
        ? DateTime.tryParse(timestamp)
        : null;
    if (timestamp != null && persisted == null) {
      throw const FormatException('Invalid persisted time.');
    }
    return TrafficOverview(
      period: TrafficPeriod(startDate: start, endDate: end),
      coverage: TrafficCoverage(
        requestedDays: requested,
        availableDays: available,
        missingDays: missing,
        invalidDays: invalid,
        unsupportedDays: unsupported,
        lastPersistedAt: persisted?.toUtc(),
      ),
      summary: _immutableObject(value['summary']),
      dailyTrends: List.unmodifiable(days),
      api: _immutableObject(value['api']),
      website: _immutableObject(value['website']),
      network: _immutableObject(value['network']),
      dataQuality: _immutableObject(value['dataQuality']),
      probes: TrafficProbeOverview.tryParse(value['probes'], days),
    );
  }
}

Map<String, dynamic> _object(Object? value) {
  if (value is! Map<String, dynamic>) {
    throw const FormatException('Invalid analytics object.');
  }
  return value;
}

Map<String, dynamic> _immutableObject(Object? value) =>
    Map.unmodifiable(_object(value));

int _integer(Object? value) {
  if (value is! int || value < 0 || value > 9007199254740991) {
    throw const FormatException('Invalid analytics count.');
  }
  return value;
}

String _date(Object? value) {
  if (value is! String || !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value)) {
    throw const FormatException('Invalid analytics date.');
  }
  final date = DateTime.tryParse('${value}T00:00:00Z');
  if (date == null || date.toIso8601String().substring(0, 10) != value) {
    throw const FormatException('Invalid analytics date.');
  }
  return value;
}

class TrafficCsvExport {
  const TrafficCsvExport({required this.filename, required this.content});
  final String filename;
  final String content;
}

class TrafficProbeOverview {
  const TrafficProbeOverview({
    required this.enabled,
    required this.observedDays,
    required this.invalidDays,
    required this.totals,
    required this.counts,
  });

  final bool enabled;
  final int observedDays, invalidDays;
  final Map<String, dynamic>? totals;
  final List<int?> counts;

  // Optional version-1 extension: malformed probe data cannot break the
  // original dashboard; never coerce missing observations into zero.
  static TrafficProbeOverview? tryParse(Object? raw, List<TrafficDay> days) {
    if (raw == null) return null;
    try {
      final data = _object(raw);
      final observed = _integer(data['observedDays']);
      final invalid = _integer(data['invalidDays']);
      if (data['collectionEnabled'] is! bool ||
          data['requestedDays'] != days.length ||
          observed + invalid > days.length) {
        throw const FormatException('Invalid probe coverage.');
      }
      final trend = data['dailyTrends'];
      if (trend is! List || trend.length != days.length) {
        throw const FormatException('Invalid probe trend.');
      }
      final counts = <int?>[];
      var observedCount = 0;
      var invalidCount = 0;
      for (var i = 0; i < days.length; i++) {
        final item = _object(trend[i]);
        if (item['date'] != days[i].date) {
          throw const FormatException('Invalid probe date.');
        }
        switch (item['status']) {
          case 'available':
            observedCount++;
            counts.add(_integer(item['count']));
          case 'invalid':
            invalidCount++;
            if (item['count'] != null) {
              throw const FormatException('Invalid probe count.');
            }
            counts.add(null);
          case 'not_observed':
            if (item['count'] != null) {
              throw const FormatException('Invalid probe count.');
            }
            counts.add(null);
          default:
            throw const FormatException('Invalid probe status.');
        }
      }
      if (observedCount != observed || invalidCount != invalid) {
        throw const FormatException('Invalid probe coverage.');
      }
      final totals = observed == 0 ? null : _immutableObject(data['totals']);
      if (totals != null) {
        for (final key in [
          'observedRequests', 'matchedRequests', 'correlatedRequests',
          'repeatRequests', 'multiCategoryRequests', 'success2xx',
        ]) {
          _integer(totals[key]);
        }
        if (counts.whereType<int>().fold<int>(0, (a, b) => a + b) !=
            totals['matchedRequests']) {
          throw const FormatException('Invalid probe total.');
        }
      } else if (data['totals'] != null) {
        throw const FormatException('Unexpected probe totals.');
      }
      return TrafficProbeOverview(
        enabled: data['collectionEnabled'] as bool,
        observedDays: observed,
        invalidDays: invalid,
        totals: totals,
        counts: List.unmodifiable(counts),
      );
    } on FormatException {
      return null;
    }
  }
}
