import 'dart:async';
import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../models/traffic_overview.dart';
import 'traffic_admin_auth.dart';

class TrafficAdminApiException implements Exception {
  const TrafficAdminApiException(this.status, this.code);
  final int status;
  final String code;
  @override
  String toString() => 'TrafficAdminApiException($status, $code)';
}

abstract class TrafficAdminApi {
  Future<TrafficOverview> overview(int days);
  Future<TrafficCsvExport> exportCsv(int days);
}

class TrafficAdminClient {
  const TrafficAdminClient({required this.session, required this.api});
  final TrafficAdminSession session;
  final TrafficAdminApi api;
}

/// This factory is called by the optional deferred admin entry, never by public
/// bootstrap. A named app isolates its in-memory sign-in from recipient Auth.
Future<TrafficAdminClient> createTrafficAdminClient(String apiBaseUrl) async {
  // Reject unsafe configuration before allocating an Auth subscription.
  final baseUrl = HttpTrafficAdminApi._validatedBase(apiBaseUrl);
  const appName = 'boxmatch-traffic-admin';
  final existing = Firebase.apps.where((app) => app.name == appName);
  final app = existing.isNotEmpty
      ? existing.first
      : await Firebase.initializeApp(
          name: appName,
          options: Firebase.app().options,
        );
  final auth = FirebaseAuth.instanceFor(app: app);
  if (kIsWeb) await auth.setPersistence(Persistence.NONE);
  final session = FirebaseTrafficAdminSession(auth);
  return TrafficAdminClient(
    session: session,
    api: HttpTrafficAdminApi(apiBaseUrl: baseUrl, session: session),
  );
}

class HttpTrafficAdminApi implements TrafficAdminApi {
  HttpTrafficAdminApi({
    required String apiBaseUrl,
    required this.session,
    http.Client? client,
    this.timeout = const Duration(seconds: 8),
  }) : _baseUrl = _validatedBase(apiBaseUrl),
       _client = client;
  final String _baseUrl;
  final TrafficAdminSession session;
  final http.Client? _client;
  final Duration timeout;

  static String _validatedBase(String value) {
    final uri = Uri.tryParse(value);
    if (uri == null ||
        !{'https', 'http'}.contains(uri.scheme) ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment ||
        (uri.scheme == 'http' &&
            !{'localhost', '127.0.0.1', '::1'}.contains(uri.host))) {
      throw const TrafficAdminApiException(0, 'invalid-api-configuration');
    }
    return value.replaceAll(RegExp(r'/+$'), '');
  }

  Future<String> _get(String endpoint, int days, String accept) async {
    if (!{7, 30, 90}.contains(days)) {
      throw const TrafficAdminApiException(400, 'invalid-period');
    }
    if (!session.isAuthorized) {
      throw const TrafficAdminApiException(401, 'session-required');
    }
    final client = _client ?? http.Client();
    try {
      // One deadline covers token acquisition, headers and the complete body.
      return await _receive(client, endpoint, days, accept).timeout(timeout);
    } on TimeoutException {
      throw const TrafficAdminApiException(0, 'timeout');
    } on http.ClientException {
      throw const TrafficAdminApiException(0, 'unavailable');
    } finally {
      if (_client == null) client.close();
    }
  }

  Future<String> _receive(
    http.Client client,
    String endpoint,
    int days,
    String accept,
  ) async {
    final token = await session.idToken();
    if (token == null || !session.isAuthorized) {
      throw const TrafficAdminApiException(401, 'session-required');
    }
    final epoch = session.revision;
    final request =
        http.Request(
            'GET',
            Uri.parse('$_baseUrl/admin/traffic/$endpoint?days=$days'),
          )
          ..followRedirects = false
          ..headers.addAll({
            'authorization': 'Bearer $token',
            'accept': accept,
            'cache-control': 'no-store',
            'pragma': 'no-cache',
          });
    final response = await client.send(request);
    if (!session.isAuthorized || epoch != session.revision) {
      throw const TrafficAdminApiException(401, 'stale-session');
    }
    if (response.statusCode == 401 || response.statusCode == 403) {
      session.invalidate();
      throw TrafficAdminApiException(response.statusCode, 'authorization-lost');
    }
    if (response.statusCode != 200) {
      throw TrafficAdminApiException(
        response.statusCode,
        response.statusCode == 429
            ? 'rate-limited'
            : response.statusCode == 503
            ? 'unavailable'
            : 'request-failed',
      );
    }
    final maximum = (endpoint == 'export' ? 8 : 1) * 1024 * 1024;
    final bytes = <int>[];
    await for (final chunk in response.stream) {
      if (bytes.length + chunk.length > maximum) {
        throw const TrafficAdminApiException(0, 'response-too-large');
      }
      bytes.addAll(chunk);
    }
    if (!session.isAuthorized || epoch != session.revision) {
      throw const TrafficAdminApiException(401, 'stale-session');
    }
    return utf8.decode(bytes);
  }

  @override
  Future<TrafficOverview> overview(int days) async {
    final body = await _get('overview', days, 'application/json');
    try {
      final decoded = jsonDecode(body);
      if (decoded is! Map<String, dynamic>) throw const FormatException();
      return TrafficOverview.fromJson(decoded);
    } on FormatException {
      throw const TrafficAdminApiException(0, 'invalid-response');
    }
  }

  @override
  Future<TrafficCsvExport> exportCsv(int days) async {
    final content = await _get('export', days, 'text/csv');
    return TrafficCsvExport(
      filename: 'boxmatch-traffic-${days}d.csv',
      content: content,
    );
  }
}
