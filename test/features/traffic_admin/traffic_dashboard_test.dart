import 'dart:async';

import 'package:boxmatch/features/traffic_admin/data/traffic_admin_api.dart';
import 'package:boxmatch/features/traffic_admin/data/traffic_admin_auth.dart';
import 'package:boxmatch/features/traffic_admin/models/traffic_overview.dart';
import 'package:boxmatch/features/traffic_admin/presentation/traffic_admin_entry.dart';
import 'package:boxmatch/features/traffic_admin/presentation/traffic_labels.dart';
import 'package:boxmatch/features/traffic_admin/presentation/traffic_widgets.dart';
import 'package:boxmatch/core/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class FakeAdminSession extends TrafficAdminSession {
  FakeAdminSession({bool authorized = true})
    : authenticated = authorized,
      allowed = authorized;
  bool authenticated;
  bool allowed;
  bool busy = false;
  bool grantOnSignIn = true;
  bool failSignIn = false;
  int version = 0;
  int signOuts = 0;
  @override
  bool get isAuthenticated => authenticated;
  @override
  bool get isAuthorized => allowed;
  @override
  bool get isBusy => busy;
  @override
  int get revision => version;
  @override
  Future<void> signIn(String email, String password) async {
    busy = true;
    notifyListeners();
    await Future<void>.value();
    busy = false;
    if (failSignIn) {
      notifyListeners();
      throw StateError('PRIVATE_AUTH_ERROR');
    }
    authenticated = true;
    allowed = grantOnSignIn;
    version++;
    notifyListeners();
  }

  @override
  Future<void> signOut() async {
    signOuts++;
    invalidate();
  }

  @override
  Future<String?> idToken({bool forceRefresh = false}) async =>
      allowed ? 'fixture' : null;
  @override
  void invalidate() {
    authenticated = false;
    allowed = false;
    version++;
    notifyListeners();
  }
}

class FakeAdminApi implements TrafficAdminApi {
  final calls = <int>[];
  final exports = <int>[];
  Future<TrafficOverview> Function(int)? handler;
  Future<TrafficCsvExport> Function(int)? exportHandler;
  @override
  Future<TrafficOverview> overview(int days) {
    calls.add(days);
    return handler?.call(days) ?? Future.value(fixtureOverview());
  }

  @override
  Future<TrafficCsvExport> exportCsv(int days) {
    exports.add(days);
    return exportHandler?.call(days) ??
        Future.value(
          const TrafficCsvExport(
            filename: 'traffic-fixture.csv',
            content: 'day,status\n2026-11-26,available\n',
          ),
        );
  }
}

TrafficOverview fixtureOverview({
  bool empty = false,
  bool stale = false,
  int requests = 100,
  List<int>? supportedPeriods,
}) => TrafficOverview(
  period: const TrafficPeriod(startDate: '2026-11-20', endDate: '2026-11-26'),
  coverage: TrafficCoverage(
    requestedDays: 7,
    availableDays: empty ? 0 : 6,
    missingDays: empty ? 7 : 1,
    lastPersistedAt: empty ? null : DateTime.utc(2026, 11, 26, 10),
  ),
  summary: {
    'websitePageViews': empty ? null : 75,
    'apiRequests': empty ? null : requests,
    'apiSuccessRate': empty ? null : 80.0,
    'apiErrorRate': empty ? null : 17.0,
    'suspiciousRequests': empty ? null : 5,
    'highRiskRequests': empty ? null : 2,
    'verifiedBotRequests': empty ? null : 8,
    'apiKnownCountryRate': empty ? null : 70.0,
    'websiteKnownCountryRate': empty ? null : 60.0,
  },
  dailyTrends: empty
      ? const []
      : const [
          TrafficDay(
            date: '2026-11-20',
            available: true,
            status: 'available',
            pageViews: 30,
            apiRequests: 40,
            apiSuccess: 30,
            clientErrors: 6,
            serverErrors: 2,
            aborted: 2,
            suspicious: 3,
            highRisk: 1,
          ),
          TrafficDay(date: '2026-11-21', available: false, status: 'missing'),
          TrafficDay(
            date: '2026-11-26',
            available: true,
            status: 'available',
            pageViews: 45,
            apiRequests: 60,
            apiSuccess: 50,
            clientErrors: 8,
            serverErrors: 1,
            aborted: 1,
            suspicious: 2,
            highRisk: 1,
          ),
        ],
  api: empty
      ? {
          'totalRequests': 0,
          'clientErrors': 0,
          'serverErrors': 0,
          'aborted': 0,
          'rateLimited': 0,
        }
      : {
          'totalRequests': requests,
          'success': 80,
          'clientErrors': 14,
          'serverErrors': 3,
          'aborted': 3,
          'rateLimited': 4,
          'classifications': {
            'likely_human': 70,
            'ai_crawler': 15,
            'unknown': 15,
          },
          'riskLevels': {'low': 93, 'suspicious': 5, 'high': 2},
          'verificationStatuses': {
            'verified': 8,
            'unverified': 7,
            'not_applicable': 80,
            'unknown': 5,
          },
          'sourceChannels': {'direct_or_unknown': 100},
          'countries': {'TW': 50, 'US': 20, 'unknown': 20, 'other': 10},
          'asns': {'3462': 50, 'unknown': 50},
          'identityConfidence': {'trusted': 70, 'proxy': 20, 'unresolved': 10},
          'geoStatuses': {'resolved': 70, 'unavailable': 30},
        },
  website: empty
      ? {'pageViews': 0}
      : {
          'pageViews': 75,
          'channels': {
            'organic_search': 40,
            'ai_referral': 15,
            'direct_or_unknown': 20,
          },
          'campaignSources': {'google': 40, 'unknown': 35},
          'campaignMediums': {'organic': 40, 'unknown': 35},
          'pages': {'home': 60, 'map': 15},
          'browsers': {'Chrome': 60, 'unknown': 15},
          'operatingSystems': {'Windows': 60, 'unknown': 15},
          'countries': {'TW': 45, 'unknown': 30},
          'asns': {'3462': 45, 'unknown': 30},
          'identityConfidence': {'trusted': 45, 'proxy': 30},
          'geoStatuses': {'resolved': 45, 'unavailable': 30},
        },
  network: const {},
  dataQuality: {
    'stale': stale,
    'currentDayPartial': true,
    'supportedPeriods': ?supportedPeriods,
    'issues': ['MISSING_DAYS'],
    'flags': {
      'trafficAggregation': true,
      'geoEnrichment': false,
      'botVerification': false,
      'trafficAdmin': true,
    },
  },
);

Future<void> showEntry(
  WidgetTester tester,
  FakeAdminSession session,
  FakeAdminApi api, {
  bool enabled = true,
  bool zh = false,
  bool Function(String, String)? download,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(),
      home: TrafficAdminEntry(
        login: true,
        apiBaseUrl: 'https://api.example.com',
        enabled: enabled,
        isZhTw: zh,
        client: TrafficAdminClient(session: session, api: api),
        onDownload: download,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('disabled administrator UI never requests protected analytics', (
    tester,
  ) async {
    final session = FakeAdminSession();
    final api = FakeAdminApi();
    await showEntry(tester, session, api, enabled: false);
    expect(find.text('Administrator interface is disabled.'), findsOneWidget);
    expect(api.calls, isEmpty);
  });

  testWidgets('unauthorized entry requires sign-in before requesting data', (
    tester,
  ) async {
    final session = FakeAdminSession(authorized: false);
    final api = FakeAdminApi();
    await showEntry(tester, session, api);
    expect(api.calls, isEmpty);
    expect(find.text('Administrator sign-in'), findsOneWidget);
    await tester.enterText(
      find.byKey(const ValueKey('traffic-email')),
      'operator@example.com',
    );
    await tester.enterText(
      find.byKey(const ValueKey('traffic-password')),
      'test-password',
    );
    await tester.tap(find.byKey(const ValueKey('traffic-sign-in')));
    await tester.pumpAndSettle();
    expect(api.calls, [7]);
    expect(find.text('Traffic Intelligence Dashboard'), findsOneWidget);
  });

  testWidgets('an ordinary signed-in account cannot load the dashboard', (
    tester,
  ) async {
    final session = FakeAdminSession(authorized: false)..grantOnSignIn = false;
    final api = FakeAdminApi();
    await showEntry(tester, session, api);
    await tester.tap(find.byKey(const ValueKey('traffic-sign-in')));
    await tester.pumpAndSettle();
    expect(
      find.text('This account does not have traffic administrator access.'),
      findsOneWidget,
    );
    expect(api.calls, isEmpty);
  });

  testWidgets('sign-in errors show a generic message and clear the password', (
    tester,
  ) async {
    final session = FakeAdminSession(authorized: false)..failSignIn = true;
    await showEntry(tester, session, FakeAdminApi());
    await tester.enterText(
      find.byKey(const ValueKey('traffic-password')),
      'PRIVATE_PASSWORD',
    );
    await tester.tap(find.byKey(const ValueKey('traffic-sign-in')));
    await tester.pumpAndSettle();
    expect(
      find.text('Sign-in failed. Check your credentials and account access.'),
      findsOneWidget,
    );
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('traffic-password')))
          .controller!
          .text,
      isEmpty,
    );
    expect(find.textContaining('PRIVATE_AUTH_ERROR'), findsNothing);
  });

  testWidgets(
    'authorized dashboard shows separate streams and partial coverage',
    (tester) async {
      await showEntry(tester, FakeAdminSession(), FakeAdminApi());
      expect(find.text('Traffic Intelligence Dashboard'), findsOneWidget);
      expect(find.text('Persisted days: 6/7 · Missing: 1'), findsOneWidget);
      expect(find.textContaining('Partial coverage:'), findsOneWidget);
      for (final title in [
        'Website acquisition',
        'API client intelligence',
        'Geographic intelligence',
        'Security observations',
        'Browsers and operating systems',
        'Data quality',
      ]) {
        expect(find.text(title), findsOneWidget);
      }
      expect(find.text('AS3462'), findsWidgets);
      expect(find.text('Taiwan (TW)'), findsWidgets);
    },
  );

  testWidgets(
    'empty data is unavailable rather than fabricated zero observations',
    (tester) async {
      final api = FakeAdminApi()
        ..handler = (_) async => fixtureOverview(empty: true);
      await showEntry(tester, FakeAdminSession(), api);
      expect(
        find.textContaining('No persisted analytics are available'),
        findsOneWidget,
      );
      expect(find.text('—'), findsWidgets);
      expect(find.text('No observations available'), findsWidgets);
    },
  );

  testWidgets('stale data has an explicit persisted-data warning', (
    tester,
  ) async {
    final api = FakeAdminApi()
      ..handler = (_) async => fixtureOverview(stale: true);
    await showEntry(tester, FakeAdminSession(), api);
    expect(
      find.text(
        'Persisted data is stale. These values are not live monitoring.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('backend failures support a bounded manual retry', (
    tester,
  ) async {
    final api = FakeAdminApi()
      ..handler = (_) async => throw StateError('PRIVATE_DATABASE_ERROR');
    await showEntry(tester, FakeAdminSession(), api);
    expect(
      find.textContaining('Analytics could not be loaded.'),
      findsOneWidget,
    );
    expect(find.textContaining('PRIVATE_DATABASE_ERROR'), findsNothing);
    api.handler = (_) async => fixtureOverview();
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(api.calls, [7, 7]);
    expect(find.text('Traffic Intelligence Dashboard'), findsOneWidget);
    await tester.pump(const Duration(seconds: 31));
  });

  testWidgets('date selection loads a single overview for all widgets', (
    tester,
  ) async {
    final api = FakeAdminApi();
    await showEntry(tester, FakeAdminSession(), api);
    await tester.tap(find.byKey(const ValueKey('traffic-period')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('30 days').last);
    await tester.pumpAndSettle();
    expect(api.calls, [7, 30]);
  });

  testWidgets('refresh has a cooldown without automatic backend polling', (
    tester,
  ) async {
    final api = FakeAdminApi();
    await showEntry(tester, FakeAdminSession(), api);
    await tester.tap(find.byKey(const ValueKey('traffic-refresh')));
    await tester.pumpAndSettle();
    expect(api.calls, [7, 7]);
    expect(
      tester
          .widget<OutlinedButton>(find.byKey(const ValueKey('traffic-refresh')))
          .onPressed,
      isNull,
    );
    await tester.pump(const Duration(seconds: 31));
    expect(api.calls, [7, 7]);
    expect(
      tester
          .widget<OutlinedButton>(find.byKey(const ValueKey('traffic-refresh')))
          .onPressed,
      isNotNull,
    );
  });

  testWidgets('export downloads only the authorized transient CSV', (
    tester,
  ) async {
    final api = FakeAdminApi();
    final downloads = <String>[];
    await showEntry(
      tester,
      FakeAdminSession(),
      api,
      download: (filename, content) {
        downloads.add(filename);
        downloads.add(content);
        return true;
      },
    );
    await tester.tap(find.byKey(const ValueKey('traffic-export')));
    await tester.pumpAndSettle();
    expect(api.exports, [7]);
    expect(downloads.first, 'traffic-fixture.csv');
    expect(downloads.last, contains('available'));
  });

  testWidgets('sign-out clears data before a late refresh response completes', (
    tester,
  ) async {
    final session = FakeAdminSession();
    final api = FakeAdminApi();
    await showEntry(tester, session, api);
    final pending = Completer<TrafficOverview>();
    api.handler = (_) => pending.future;
    await tester.tap(find.byKey(const ValueKey('traffic-refresh')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('traffic-sign-out')));
    await tester.pumpAndSettle();
    expect(find.text('Administrator sign-in'), findsOneWidget);
    pending.complete(fixtureOverview(requests: 4321));
    await tester.pumpAndSettle();
    expect(find.text('4,321'), findsNothing);
    expect(find.text('Traffic Intelligence Dashboard'), findsNothing);
    expect(session.signOuts, 1);
  });

  testWidgets('authorization removal immediately clears dashboard values', (
    tester,
  ) async {
    final session = FakeAdminSession();
    await showEntry(tester, session, FakeAdminApi());
    session.invalidate();
    await tester.pumpAndSettle();
    expect(find.text('Administrator sign-in'), findsOneWidget);
    expect(find.text('Traffic Intelligence Dashboard'), findsNothing);
    expect(find.text('100'), findsNothing);
    expect(
      find.text(
        'Your administrator session ended or access was removed. Sign in again.',
      ),
      findsOneWidget,
    );
  });

  testWidgets(
    'a changed session revision discards data without leaving a permanent loader',
    (tester) async {
      final session = FakeAdminSession();
      final api = FakeAdminApi()
        ..handler = (_) async {
          session.version++;
          return fixtureOverview(requests: 9876);
        };
      await showEntry(tester, session, api);
      expect(find.text('9,876'), findsNothing);
      expect(
        find.text(
          'Your administrator session changed. Refresh to load analytics again.',
        ),
        findsOneWidget,
      );
      expect(find.byType(CircularProgressIndicator), findsNothing);
      api.handler = (_) async => fixtureOverview();
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();
      expect(find.text('Traffic Intelligence Dashboard'), findsOneWidget);
      await tester.pump(const Duration(seconds: 31));
    },
  );

  testWidgets('pending export disables refresh and period changes then restores controls', (tester) async {
    final pending = Completer<TrafficCsvExport>();
    final api = FakeAdminApi()..exportHandler = (_) => pending.future;
    await showEntry(tester, FakeAdminSession(), api, download: (_, _) => true);
    await tester.tap(find.byKey(const ValueKey('traffic-export')));
    await tester.pump();
    expect(tester.widget<OutlinedButton>(find.byKey(const ValueKey('traffic-refresh'))).onPressed, isNull);
    await tester.tap(find.byKey(const ValueKey('traffic-period')));
    await tester.pumpAndSettle();
    expect(find.text('30 days').hitTestable(), findsNothing);
    expect(api.calls, [7]);
    pending.complete(const TrafficCsvExport(filename: 'fixture.csv', content: 'fixture'));
    await tester.pumpAndSettle();
    expect(tester.widget<OutlinedButton>(find.byKey(const ValueKey('traffic-refresh'))).onPressed, isNotNull);
    await tester.tap(find.byKey(const ValueKey('traffic-period')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('30 days').last);
    await tester.pumpAndSettle();
    expect(api.calls, [7, 30]);
  });

  testWidgets('period selector follows the authorized backend capability', (tester) async {
    final api = FakeAdminApi()..handler = (_) async => fixtureOverview(supportedPeriods: [7, 30]);
    await showEntry(tester, FakeAdminSession(), api);
    await tester.tap(find.byKey(const ValueKey('traffic-period')));
    await tester.pumpAndSettle();
    expect(find.text('90 days'), findsNothing);
    await tester.tap(find.text('30 days').last);
    await tester.pumpAndSettle();
    expect(api.calls, [7, 30]);
  });

  testWidgets('a late export cannot download after sign-out', (tester) async {
    final session = FakeAdminSession();
    final api = FakeAdminApi();
    final pending = Completer<TrafficCsvExport>();
    api.exportHandler = (_) => pending.future;
    var downloads = 0;
    await showEntry(
      tester,
      session,
      api,
      download: (_, _) {
        downloads++;
        return true;
      },
    );
    await tester.tap(find.byKey(const ValueKey('traffic-export')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('traffic-sign-out')));
    await tester.pumpAndSettle();
    pending.complete(
      const TrafficCsvExport(filename: 'private.csv', content: 'PRIVATE_DATA'),
    );
    await tester.pumpAndSettle();
    expect(downloads, 0);
  });

  testWidgets('Traditional Chinese copy remains available', (tester) async {
    await showEntry(tester, FakeAdminSession(), FakeAdminApi(), zh: true);
    expect(find.text('流量情報儀表板'), findsOneWidget);
    expect(find.text('安全觀測'), findsOneWidget);
    expect(find.text('臺灣 (TW)'), findsWidgets);
  });

  testWidgets('desktop tablet and narrow mobile avoid layout exceptions', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    for (final width in [1280.0, 768.0, 320.0]) {
      tester.view.physicalSize = Size(width, 1000);
      await showEntry(tester, FakeAdminSession(), FakeAdminApi());
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    }
  });

  testWidgets(
    'dimension tables sort and expand without losing unknown buckets',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: TrafficDistribution(
                title: 'Fixture distribution',
                values: {
                  for (var i = 0; i < 9; i++) 'source$i': i,
                  'unknown': 3,
                },
                isZhTw: false,
                label: (key) => trafficLabel(key, false),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Show all 10 categories'), findsOneWidget);
      await tester.tap(find.text('Sort by name'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Show all 10 categories'));
      await tester.pumpAndSettle();
      expect(find.text('Unknown'), findsOneWidget);
      expect(find.text('source0'), findsOneWidget);
      await tester.ensureVisible(find.text('Show less'));
      await tester.tap(find.text('Show less'));
      await tester.pumpAndSettle();
      expect(find.text('Sort by count'), findsOneWidget);
    },
  );

  test('number, country and ASN labels keep unsupported values honest', () {
    expect(trafficNumber(null, false), '—');
    expect(trafficPercent(null), '—');
    expect(trafficCountryLabel('ZZ', false), 'ZZ (ZZ)');
    expect(trafficAsnLabel('other', false), 'Other');
    expect(trafficAsnLabel('3462', false), 'AS3462');
  });
}
