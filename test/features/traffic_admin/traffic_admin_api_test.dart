import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:boxmatch/features/traffic_admin/data/traffic_admin_api.dart';
import 'package:boxmatch/features/traffic_admin/data/traffic_admin_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _Session extends TrafficAdminSession {
  bool authorized = true;
  int epoch = 0;
  @override
  bool get isAuthenticated => authorized;
  @override
  bool get isAuthorized => authorized;
  @override
  bool get isBusy => false;
  @override
  int get revision => epoch;
  @override
  Future<String?> idToken({bool forceRefresh = false}) async =>
      authorized ? 'fixture-token' : null;
  @override
  void invalidate() {
    authorized = false;
    epoch++;
    notifyListeners();
  }

  @override
  Future<void> signIn(String email, String password) async {
    authorized = true;
    epoch++;
  }

  @override
  Future<void> signOut() async => invalidate();
}

class _StreamingClient extends http.BaseClient {
  _StreamingClient(this.body);
  final Stream<List<int>> body;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async =>
      http.StreamedResponse(body, 200);
}

Map<String, dynamic> _overview() => {
  'schemaVersion': 1,
  'period': {
    'startDate': '2026-11-20',
    'endDate': '2026-11-26',
    'timezone': 'UTC',
  },
  'coverage': {
    'requestedDays': 7,
    'availableDays': 0,
    'missingDays': 7,
    'invalidDays': 0,
    'unsupportedDays': 0,
    'lastPersistedAt': null,
  },
  'summary': {'websitePageViews': null},
  'dailyTrends': List.generate(
    7,
    (i) => {
      'date': '2026-11-${20 + i}',
      'available': false,
      'status': 'missing',
    },
  ),
  'api': <String, dynamic>{},
  'website': <String, dynamic>{},
  'network': <String, dynamic>{},
  'dataQuality': {'stale': null},
};

void main() {
  test(
    'overview sends only a bearer header to the configured API and requests no cache/redirects',
    () async {
      final session = _Session();
      final client = MockClient((request) async {
        expect(
          request.url.toString(),
          'https://api.example.test/admin/traffic/overview?days=7',
        );
        expect(request.headers['authorization'], 'Bearer fixture-token');
        expect(request.headers['cache-control'], 'no-store');
        expect(request.headers['pragma'], 'no-cache');
        expect(request.followRedirects, isFalse);
        return http.Response(jsonEncode(_overview()), 200);
      });
      final api = HttpTrafficAdminApi(
        apiBaseUrl: 'https://api.example.test/',
        session: session,
        client: client,
      );
      final overview = await api.overview(7);
      expect(overview.coverage.missingDays, 7);
      expect(overview.dailyTrends.first.apiRequests, isNull);
      expect(overview.summary['websitePageViews'], isNull);
      client.close();
      session.dispose();
    },
  );

  test(
    'CSV downloads use the same authenticated API and a constant safe filename',
    () async {
      final session = _Session();
      final client = MockClient((request) async {
        expect(request.url.path, '/admin/traffic/export');
        expect(request.headers['accept'], 'text/csv');
        return http.Response('date,count,status\n2026-11-20,,missing\n', 200);
      });
      final export = await HttpTrafficAdminApi(
        apiBaseUrl: 'https://api.example.test',
        session: session,
        client: client,
      ).exportCsv(30);
      expect(export.filename, 'boxmatch-traffic-30d.csv');
      expect(export.content, contains('missing'));
      client.close();
      session.dispose();
    },
  );

  test(
    '401 and 403 clear administrator access, including cached UI listeners',
    () async {
      for (final status in [401, 403]) {
        final session = _Session();
        int notified = 0;
        session.addListener(() => notified++);
        final client = MockClient(
          (_) async => http.Response('PRIVATE_ERROR', status),
        );
        final api = HttpTrafficAdminApi(
          apiBaseUrl: 'https://api.example.test',
          session: session,
          client: client,
        );
        await expectLater(
          api.overview(7),
          throwsA(
            isA<TrafficAdminApiException>().having(
              (e) => e.status,
              'status',
              status,
            ),
          ),
        );
        expect(session.isAuthorized, isFalse);
        expect(notified, 1);
        client.close();
        session.dispose();
      }
    },
  );

  test(
    'a late response cannot restore data or invalidate a new login after logout',
    () async {
      final session = _Session();
      final response = Completer<http.Response>();
      final client = MockClient((_) => response.future);
      final api = HttpTrafficAdminApi(
        apiBaseUrl: 'https://api.example.test',
        session: session,
        client: client,
      );
      final pending = api.overview(7);
      await Future<void>.delayed(Duration.zero);
      await session.signOut();
      await session.signIn('another@example.test', 'password');
      response.complete(http.Response('old-session-error', 401));
      await expectLater(
        pending,
        throwsA(
          isA<TrafficAdminApiException>().having(
            (e) => e.code,
            'code',
            'stale-session',
          ),
        ),
      );
      expect(session.isAuthorized, isTrue);
      client.close();
      session.dispose();
    },
  );

  test(
    'invalid period/configuration and signed-out calls never send a request',
    () async {
      final session = _Session();
      int calls = 0;
      final client = MockClient((_) async {
        calls++;
        return http.Response('', 200);
      });
      for (final url in [
        'not-a-url',
        'https://user:password@api.example.test',
        'https://api.example.test?token=private',
        'http://api.example.test',
      ]) {
        expect(
          () => HttpTrafficAdminApi(apiBaseUrl: url, session: session),
          throwsA(isA<TrafficAdminApiException>()),
        );
      }
      await expectLater(
        createTrafficAdminClient('http://api.example.test'),
        throwsA(isA<TrafficAdminApiException>()),
      );
      expect(
        HttpTrafficAdminApi(
          apiBaseUrl: 'http://127.0.0.1:8080',
          session: session,
        ),
        isA<HttpTrafficAdminApi>(),
      );
      final api = HttpTrafficAdminApi(
        apiBaseUrl: 'https://api.example.test',
        session: session,
        client: client,
      );
      await expectLater(
        api.overview(91),
        throwsA(isA<TrafficAdminApiException>()),
      );
      session.invalidate();
      await expectLater(
        api.overview(7),
        throwsA(isA<TrafficAdminApiException>()),
      );
      expect(calls, 0);
      client.close();
      session.dispose();
    },
  );

  test(
    'offline, timeout, throttle, unavailable, redirect and malformed responses fail safely without retries',
    () async {
      for (final status in [302, 429, 503, 500, 200]) {
        final session = _Session();
        int calls = 0;
        final client = MockClient((_) async {
          calls++;
          return http.Response('PRIVATE_BAD_RESPONSE', status);
        });
        final api = HttpTrafficAdminApi(
          apiBaseUrl: 'https://api.example.test',
          session: session,
          client: client,
        );
        await expectLater(
          api.overview(7),
          throwsA(isA<TrafficAdminApiException>()),
        );
        expect(calls, 1);
        expect(session.isAuthorized, isTrue);
        client.close();
        session.dispose();
      }
      for (final timeout in [false, true]) {
        final session = _Session();
        final client = MockClient(
          (_) => timeout
              ? Completer<http.Response>().future
              : Future.error(http.ClientException('PRIVATE')),
        );
        final api = HttpTrafficAdminApi(
          apiBaseUrl: 'https://api.example.test',
          session: session,
          client: client,
          timeout: const Duration(milliseconds: 2),
        );
        await expectLater(
          api.overview(7),
          throwsA(isA<TrafficAdminApiException>()),
        );
        client.close();
        session.dispose();
      }
    },
  );

  test(
    'CSV permits legitimate large exports but caps CSV and JSON response sizes independently',
    () async {
      final session = _Session();
      final bytes = Uint8List(1024 * 1024 + 1)
        ..fillRange(0, 1024 * 1024 + 1, 120);
      final csv = HttpTrafficAdminApi(
        apiBaseUrl: 'https://api.example.test',
        session: session,
        client: _StreamingClient(Stream.value(bytes)),
      );
      expect((await csv.exportCsv(90)).content.length, bytes.length);
      final json = HttpTrafficAdminApi(
        apiBaseUrl: 'https://api.example.test',
        session: session,
        client: _StreamingClient(Stream.value(bytes)),
      );
      await expectLater(
        json.overview(7),
        throwsA(
          isA<TrafficAdminApiException>().having(
            (e) => e.code,
            'code',
            'response-too-large',
          ),
        ),
      );
      final oversized = HttpTrafficAdminApi(
        apiBaseUrl: 'https://api.example.test',
        session: session,
        client: _StreamingClient(Stream.value(Uint8List(8 * 1024 * 1024 + 1))),
      );
      await expectLater(
        oversized.exportCsv(90),
        throwsA(
          isA<TrafficAdminApiException>().having(
            (e) => e.code,
            'code',
            'response-too-large',
          ),
        ),
      );
      session.dispose();
    },
  );

  test(
    'a slowly streaming body cannot reset the overall response deadline',
    () async {
      final session = _Session();
      final body = StreamController<List<int>>();
      final timer = Timer.periodic(
        const Duration(milliseconds: 2),
        (_) => body.add([120]),
      );
      final api = HttpTrafficAdminApi(
        apiBaseUrl: 'https://api.example.test',
        session: session,
        client: _StreamingClient(body.stream),
        timeout: const Duration(milliseconds: 15),
      );
      try {
        await expectLater(
          api.exportCsv(7),
          throwsA(
            isA<TrafficAdminApiException>().having(
              (e) => e.code,
              'code',
              'timeout',
            ),
          ),
        );
      } finally {
        timer.cancel();
        await body.close();
        session.dispose();
      }
    },
  );
}
