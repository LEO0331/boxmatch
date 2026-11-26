import 'dart:async';
import 'dart:convert';

import 'package:boxmatch/core/telemetry/visit_environment.dart';
import 'package:boxmatch/core/telemetry/visit_tracker.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  VisitEnvironment environment({
    String referrer = '',
    String query = '',
    bool privacy = false,
  }) => VisitEnvironment(
    uri: Uri.parse('https://example.com/boxmatch/$query'),
    referrer: referrer,
    privacyOptOut: privacy,
  );

  test('normalizes only actual public router categories', () {
    final pages = {
      '/': 'home',
      '/map': 'map',
      '/enterprise/new': 'enterprise_post',
      '/listing/PRIVATE_ID': 'listing_detail',
      '/my-reservations': 'my_reservations',
      '/unknown/PRIVATE_ID': 'unknown',
    };
    for (final entry in pages.entries) {
      expect(classifyVisitPage(Uri.parse(entry.key)), entry.value);
    }
    for (final path in [
      '/enterprise/edit/PRIVATE_ID',
      '/listing/PRIVATE_ID/reservation/PRIVATE_RESERVATION',
      '/map?token=PRIVATE_TOKEN',
      '/admin/login',
      '/admin/traffic',
    ]) {
      expect(classifyVisitPage(Uri.parse(path)), isNull);
    }
  });

  test(
    'sends a single sanitized initial page view despite repeated initialization',
    () async {
      final requests = <http.Request>[];
      final tracker = VisitTracker(
        apiBaseUrl: 'https://api.example.com/v1/',
        readEnvironment: () => environment(
          referrer: 'https://www.google.com/search?q=PRIVATE_SEARCH',
          query:
              '?utm_source=GOOGLE&utm_medium=organic&gclid=PRIVATE_CLICK&utm_content=PRIVATE_AD',
        ),
        client: MockClient((request) async {
          requests.add(request);
          return http.Response('', 204);
        }),
      );
      await Future.wait([
        tracker.trackInitial(
          Uri.parse('/listing/PRIVATE_LISTING'),
          usingFirebase: true,
        ),
        tracker.trackInitial(Uri.parse('/map'), usingFirebase: true),
      ]);
      await tracker.trackInitial(Uri.parse('/'), usingFirebase: true);
      expect(requests, hasLength(1));
      expect(
        requests.single.url.toString(),
        'https://api.example.com/v1/telemetry/visit',
      );
      expect(jsonDecode(requests.single.body), {
        'schemaVersion': 1,
        'eventType': 'page_view',
        'page': 'listing_detail',
        'referrerDomain': 'www.google.com',
        'campaignSource': 'google',
        'campaignMedium': 'organic',
      });
      expect(requests.single.body, isNot(contains('PRIVATE')));
      expect(requests.single.headers.containsKey('authorization'), isFalse);
    },
  );

  test(
    'missing referrer stays absent and high-cardinality campaigns collapse',
    () async {
      late Map<String, dynamic> payload;
      final tracker = VisitTracker(
        apiBaseUrl: 'https://api.example.com',
        readEnvironment: () => environment(
          query:
              '?utm_source=PRIVATE_USER&utm_medium=unlisted&utm_campaign=PRIVATE_CAMPAIGN',
        ),
        client: MockClient((request) async {
          payload = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response('', 204);
        }),
      );
      await tracker.trackInitial(Uri.parse('/'), usingFirebase: true);
      expect(payload, {
        'schemaVersion': 1,
        'eventType': 'page_view',
        'page': 'home',
        'campaignSource': 'other',
        'campaignMedium': 'other',
      });
    },
  );

  test(
    'token-bearing outer URLs and sensitive routes produce no telemetry',
    () async {
      int calls = 0;
      final client = MockClient((_) async {
        calls++;
        return http.Response('', 204);
      });
      for (final route in [
        '/enterprise/edit/secret',
        '/listing/id/reservation/secret',
      ]) {
        final tracker = VisitTracker(
          apiBaseUrl: 'https://api.example.com',
          readEnvironment: () => environment(),
          client: client,
        );
        await tracker.trackInitial(Uri.parse(route), usingFirebase: true);
      }
      final outerToken = VisitTracker(
        apiBaseUrl: 'https://api.example.com',
        readEnvironment: () => environment(query: '?token=PRIVATE_TOKEN'),
        client: client,
      );
      await outerToken.trackInitial(Uri.parse('/'), usingFirebase: true);
      expect(calls, 0);
    },
  );

  test(
    'disabled, local demo and privacy choices never contact the endpoint',
    () async {
      int calls = 0;
      final client = MockClient((_) async {
        calls++;
        return http.Response('', 204);
      });
      for (final mode in ['disabled', 'demo', 'privacy']) {
        final tracker = VisitTracker(
          apiBaseUrl: 'https://api.example.com',
          enabled: mode != 'disabled',
          readEnvironment: () => environment(privacy: mode == 'privacy'),
          client: client,
        );
        await tracker.trackInitial(
          Uri.parse('/'),
          usingFirebase: mode != 'demo',
        );
      }
      expect(calls, 0);
      expect(
        createVisitTracker(
          apiBaseUrl: 'https://api.example.com',
          usingFirebase: false,
        ),
        isNull,
      );
    },
  );

  test('offline failures and timeouts are swallowed without retries', () async {
    for (final timeout in [false, true]) {
      int calls = 0;
      final tracker = VisitTracker(
        apiBaseUrl: 'https://api.example.com',
        readEnvironment: () => environment(),
        timeout: const Duration(milliseconds: 2),
        client: MockClient((_) {
          calls++;
          if (timeout) return Completer<http.Response>().future;
          throw http.ClientException('offline');
        }),
      );
      await tracker.trackInitial(Uri.parse('/'), usingFirebase: true);
      await tracker.trackInitial(Uri.parse('/'), usingFirebase: true);
      expect(calls, 1);
    }
  });

  test(
    'invalid source values, malformed API URLs and environment failures degrade safely',
    () async {
      for (final referrer in [
        'https://name:PRIVATE@google.com/',
        'https://127.0.0.1/x',
        'https://[::1]/',
        'javascript:PRIVATE',
        'https://google..com/',
        'https://google.com/\nPRIVATE',
      ]) {
        expect(sanitizeReferrerDomain(referrer), isNull);
      }
      expect(
        sanitizeReferrerDomain('https://WWW.GOOGLE.COM./search?token=PRIVATE'),
        'www.google.com',
      );
      int calls = 0;
      final client = MockClient((_) async {
        calls++;
        return http.Response('', 204);
      });
      for (final url in [
        'not-an-api',
        'https://api.example.com/?token=PRIVATE',
        'https://user:PRIVATE@api.example.com',
      ]) {
        await VisitTracker(
          apiBaseUrl: url,
          readEnvironment: () => environment(),
          client: client,
        ).trackInitial(Uri.parse('/'), usingFirebase: true);
      }
      await VisitTracker(
        apiBaseUrl: 'https://api.example.com',
        readEnvironment: () => throw StateError('no browser'),
        client: client,
      ).trackInitial(Uri.parse('/'), usingFirebase: true);
      expect(calls, 0);
    },
  );
}
