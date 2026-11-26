import 'dart:convert';

import 'package:boxmatch/features/traffic_admin/models/traffic_overview.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> fixture() => {
  'schemaVersion': 1,
  'period': {
    'startDate': '2026-11-20',
    'endDate': '2026-11-26',
    'timezone': 'UTC',
  },
  'coverage': {
    'requestedDays': 7,
    'availableDays': 1,
    'missingDays': 6,
    'invalidDays': 0,
    'unsupportedDays': 0,
    'lastPersistedAt': '2026-11-26T00:00:00Z',
  },
  'summary': {'websitePageViews': 0, 'apiSuccessRate': null},
  'dailyTrends': List.generate(
    7,
    (i) => {
      'date': '2026-11-${20 + i}',
      'available': i == 0,
      'status': i == 0 ? 'available' : 'missing',
      if (i == 0) ...{
        'pageViews': 0,
        'apiRequests': 0,
        'apiSuccess': 0,
        'clientErrors': 0,
        'serverErrors': 0,
        'aborted': 0,
        'suspicious': 0,
        'highRisk': 0,
      },
    },
  ),
  'api': {'totalRequests': 0},
  'website': {'pageViews': 0},
  'network': {'apiKnownCountryRate': null},
  'dataQuality': {'stale': false, 'currentDayPartial': true},
};

void main() {
  test('optional probe coverage preserves historical gaps and observed zero', () {
    final data = fixture();
    data['probes'] = {
      'collectionEnabled': true,
      'requestedDays': 7,
      'observedDays': 1,
      'invalidDays': 0,
      'totals': {
        'observedRequests': 3, 'matchedRequests': 0,
        'correlatedRequests': 0, 'repeatRequests': 0,
        'multiCategoryRequests': 0, 'success2xx': 0,
      },
      'dailyTrends': List.generate(7, (i) => {
        'date': '2026-11-${20 + i}',
        'status': i == 0 ? 'available' : 'not_observed',
        'count': i == 0 ? 0 : null,
      }),
    };
    final overview = TrafficOverview.fromJson(data);
    expect(overview.probes!.counts, [0, null, null, null, null, null, null]);
    expect(overview.probes!.totals!['matchedRequests'], 0);
    data['probes']['observedDays'] = 7;
    expect(TrafficOverview.fromJson(data).probes, isNull);
    expect(TrafficOverview.fromJson(fixture()).probes, isNull);
  });

  test('missing daily observations remain null instead of becoming zero', () {
    final overview = TrafficOverview.fromJson(fixture());
    expect(overview.period.timezone, 'UTC');
    expect(overview.coverage.requestedDays, 7);
    expect(overview.coverage.availableDays, 1);
    expect(overview.coverage.lastPersistedAt!.isUtc, isTrue);
    expect(overview.dailyTrends.first.pageViews, 0);
    expect(overview.dailyTrends[1].pageViews, isNull);
    expect(overview.summary['apiSuccessRate'], isNull);
    expect(() => overview.api['totalRequests'] = 1, throwsUnsupportedError);
    expect(() => overview.dailyTrends.clear(), throwsUnsupportedError);
  });

  test(
    'malformed versions, periods, counts, dates and document shapes are rejected',
    () {
      final mutations = <void Function(Map<String, dynamic>)>[
        (value) => value['schemaVersion'] = 2,
        (value) => value['period']['timezone'] = 'Asia/Taipei',
        (value) => value['period']['startDate'] = '2026-02-30',
        (value) => value['period']['endDate'] = '2026-11-19',
        (value) => value['coverage']['requestedDays'] = 91,
        (value) => value['coverage']['availableDays'] = -1,
        (value) => value['coverage']['availableDays'] = 9007199254740992,
        (value) => value['coverage']['missingDays'] = 0,
        (value) => value['coverage']['lastPersistedAt'] = 'PRIVATE_BAD_DATE',
        (value) => value['dailyTrends'] = [],
        (value) => value['dailyTrends'][0]['status'] = 'PRIVATE_STATUS',
        (value) => value['dailyTrends'][0]['available'] = false,
        (value) => value['dailyTrends'][0]['apiRequests'] = -1,
        (value) => value['dailyTrends'][0]['date'] = '2026-11-21',
        (value) => value['dailyTrends'][0]['date'] = 'not-a-date',
        (value) => value['api'] = [],
      ];
      for (final mutate in mutations) {
        final value = jsonDecode(jsonEncode(fixture())) as Map<String, dynamic>;
        mutate(value);
        expect(() => TrafficOverview.fromJson(value), throwsFormatException);
      }
    },
  );
}
