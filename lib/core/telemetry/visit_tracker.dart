import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'visit_environment.dart';
import 'visit_environment_stub.dart'
    if (dart.library.html) 'visit_environment_web.dart'
    as platform;

const _campaignSources = {
  'google',
  'bing',
  'duckduckgo',
  'facebook',
  'instagram',
  'linkedin',
  'reddit',
  'github',
  'chatgpt',
  'perplexity',
  'claude',
  'other',
};
const _campaignMediums = {
  'organic',
  'social',
  'referral',
  'email',
  'cpc',
  'paid_social',
  'other',
};

VisitTracker? _applicationTracker;

VisitTracker? createVisitTracker({
  required String apiBaseUrl,
  required bool usingFirebase,
}) {
  const enabled = bool.fromEnvironment('BOXMATCH_ENABLE_TELEMETRY');
  if (!enabled || !kIsWeb || !usingFirebase) return null;
  return _applicationTracker ??= VisitTracker(
    apiBaseUrl: apiBaseUrl,
    readEnvironment: platform.readVisitEnvironment,
  );
}

String? classifyVisitPage(Uri route) {
  final segments = route.pathSegments.where((part) => part.isNotEmpty).toList();
  if (route.queryParameters.keys.any(
    (key) => key.toLowerCase().contains('token'),
  )) {
    return null;
  }
  if (segments.isEmpty) return 'home';
  if (segments.length == 1 && segments[0] == 'map') return 'map';
  if (segments.length == 1 && segments[0] == 'my-reservations') {
    return 'my_reservations';
  }
  if (segments.length == 2 &&
      segments[0] == 'enterprise' &&
      segments[1] == 'new') {
    return 'enterprise_post';
  }
  if (segments.length >= 2 &&
      segments[0] == 'enterprise' &&
      segments[1] == 'edit') {
    return null;
  }
  if (segments.length == 4 &&
      segments[0] == 'listing' &&
      segments[2] == 'reservation') {
    return null;
  }
  if (segments.length == 2 && segments[0] == 'listing') return 'listing_detail';
  return 'unknown';
}

String? sanitizeReferrerDomain(String value) {
  if (value.length > 2048 || RegExp(r'[\x00-\x20\x7f]').hasMatch(value)) {
    return null;
  }
  final uri = Uri.tryParse(value);
  if (uri == null ||
      !{'https', 'http'}.contains(uri.scheme) ||
      uri.userInfo.isNotEmpty) {
    return null;
  }
  final host = uri.host.toLowerCase().replaceFirst(RegExp(r'\.$'), '');
  if (host.length > 253 ||
      !host.contains('.') ||
      RegExp(r'^[\d.]+$').hasMatch(host) ||
      !RegExp(r'^[a-z0-9.-]+$').hasMatch(host)) {
    return null;
  }
  if (host
      .split('.')
      .any(
        (part) =>
            part.isEmpty ||
            part.length > 63 ||
            part.startsWith('-') ||
            part.endsWith('-'),
      )) {
    return null;
  }
  return host;
}

String? _campaign(String? value, Set<String> allowed) {
  if (value == null || value.trim().isEmpty) return null;
  final normalized = value.trim().toLowerCase();
  if (normalized.length > 64 || !allowed.contains(normalized)) return 'other';
  return normalized;
}

/// At most one best-effort event per tracker/application load. It creates no
/// identity, cookies, or local-storage state, and never retries a failed send.
class VisitTracker {
  VisitTracker({
    required String apiBaseUrl,
    required VisitEnvironment Function() readEnvironment,
    http.Client? client,
    this.enabled = true,
    this.timeout = const Duration(seconds: 2),
  }) : _apiBaseUrl = apiBaseUrl,
       _readEnvironment = readEnvironment,
       _client = client;

  final String _apiBaseUrl;
  final VisitEnvironment Function() _readEnvironment;
  final http.Client? _client;
  final bool enabled;
  final Duration timeout;
  bool _submitted = false;

  Future<void> trackInitial(Uri route, {required bool usingFirebase}) async {
    if (_submitted || !enabled || !usingFirebase) return;
    _submitted = true;
    http.Client? ownedClient;
    try {
      final environment = _readEnvironment();
      if (environment.privacyOptOut) return;
      if (environment.uri.queryParameters.keys.any(
        (key) => key.toLowerCase().contains('token'),
      )) {
        return;
      }
      final page = classifyVisitPage(route);
      if (page == null) return;
      final base = Uri.tryParse(_apiBaseUrl);
      if (base == null ||
          !{'https', 'http'}.contains(base.scheme) ||
          base.host.isEmpty ||
          base.userInfo.isNotEmpty ||
          base.hasQuery ||
          base.hasFragment) {
        return;
      }
      final endpoint = Uri.parse(
        '${_apiBaseUrl.replaceAll(RegExp(r'/+$'), '')}/telemetry/visit',
      );
      final payload = <String, Object>{
        'schemaVersion': 1,
        'eventType': 'page_view',
        'page': page,
      };
      final referrer = sanitizeReferrerDomain(environment.referrer);
      final source = _campaign(
        environment.uri.queryParameters['utm_source'],
        _campaignSources,
      );
      final medium = _campaign(
        environment.uri.queryParameters['utm_medium'],
        _campaignMediums,
      );
      if (referrer != null) payload['referrerDomain'] = referrer;
      if (source != null) payload['campaignSource'] = source;
      if (medium != null) payload['campaignMedium'] = medium;
      final client = _client ?? (ownedClient = http.Client());
      await client
          .post(
            endpoint,
            headers: {'content-type': 'application/json'},
            body: jsonEncode(payload),
          )
          .timeout(timeout);
    } catch (_) {
      // Offline, cold-start, parse and transport failures never reach the UI.
    } finally {
      ownedClient?.close();
    }
  }
}
