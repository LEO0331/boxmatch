const { classifyProbe, createProbeWindow } = require('../observability/probeClassifier');
const { createRequestIntelligence } = require('../observability/requestContext');
const { createTrafficAggregator, mergeDailyData } = require('../observability/trafficAggregator');
const { createTrafficQueryService, sanitizeDay } = require('../admin/trafficQueryService');
const { snapshotCsv } = require('../observability/trafficCsv');
const { readConfig } = require('../observability/config');

const now = Date.parse('2026-11-26T08:21:00Z');
const day = '2026-11-26';
const network = { identityConfidence: 'trusted', ipFingerprint: 'hmac:' + 'a'.repeat(64), geoStatus: 'resolved', country: 'TW', asn: 3462 };
const config = { enableSecurityProbes: true, enableTrafficAggregation: true, enableRequestIntelligence: true };
const event = (category, extra = {}) => ({ ts: now, method: 'GET', path: '[pre-route-or-unmatched]', status: 404, network,
  security: { classification: 'suspected_security_scanner', riskLevel: 'low', verificationStatus: 'not_applicable', probeCategory: category }, ...extra });

test.each([
  ['/.env?token=PRIVATE', 'environment'], ['/a/.ENV.local', 'environment'],
  ['/.git/config', 'git_metadata'], ['/wp-admin/', 'wordpress'],
  ['/backup.zip', 'backup'], ['/config.php.bak', 'backup'],
  ['/a/%2e%2e/file', 'path_traversal'], ['/phpmyadmin', 'admin_tools'],
  ['/config.json', 'configuration'], ['/credentials.json', 'credentials'],
  ['/listings?file=.env', null], ['/listing/environment', null],
  ['/wp-administrator', null], ['/%bad', null], ['/' + 'x'.repeat(4097) + '/.env', null]
])('classifies bounded path %s without retaining input', (path, expected) => expect(classifyProbe(path)).toBe(expected));

test('flag defaults off; all prerequisites are required and capture only emits coarse category', () => {
  expect(readConfig({}).enableSecurityProbes).toBe(false);
  expect(readConfig({ ENABLE_SECURITY_PROBES: 'TRUE' }).enableSecurityProbes).toBe(false);
  const deps = { resolveNetworkIdentity: () => network, verifier: { check: () => 'not_applicable', close() {} } };
  const req = { originalUrl: '/.env?token=PRIVATE', method: 'GET', headers: {} };
  for (const disabled of [{ enableSecurityProbes: false }, { enableTrafficAggregation: false }]) {
    const intelligence = createRequestIntelligence({ ...config, ...disabled }, deps);
    expect(intelligence.capture(req)({ route: '[pre-route-or-unmatched]', method: 'GET', status: 404 }).security).not.toHaveProperty('probeCategory');
  }
  const intelligence = createRequestIntelligence(config, deps);
  const result = intelligence.capture(req)({ route: '[pre-route-or-unmatched]', method: 'GET', status: 404 });
  expect(result.security.probeCategory).toBe('environment');
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});

test('correlation is bounded, expires, and requires trusted HMAC', () => {
  let time = now;
  const tracker = createProbeWindow({ now: () => time, maxEntries: 2 });
  expect(tracker.observe({ ...network, identityConfidence: 'proxy' }, 'environment').correlated).toBe(false);
  expect(tracker.observe(network, 'environment')).toEqual({ correlated: true, repeated: false, multiCategory: false });
  expect(tracker.observe(network, 'environment')).toEqual({ correlated: true, repeated: true, multiCategory: false });
  expect(tracker.observe(network, 'git_metadata')).toEqual({ correlated: true, repeated: true, multiCategory: true });
  time += 60000;
  expect(tracker.observe(network, 'git_metadata').repeated).toBe(false);
  for (const char of ['b', 'c', 'd']) tracker.observe({ ...network, ipFingerprint: 'hmac:' + char.repeat(64) }, 'backup');
  expect(tracker.size).toBe(2);
  expect(tracker.observe(network, 'environment').repeated).toBe(false);
  tracker.close();
  expect(tracker.size).toBe(0);
});

test('optional aggregate covers eligible requests, not just matches; keeps exact bounded dimensions', () => {
  const agg = createTrafficAggregator(config, { now: () => now });
  agg.recordApi(event(null));
  agg.recordApi(event('environment'));
  agg.recordApi(event('git_metadata', { method: 'HEAD', status: 200 }));
  agg.recordApi(event('backup', { status: 499, aborted: true, network: { ...network, identityConfidence: 'proxy' } }));
  agg.recordApi(event('environment', { preflight: true }));
  agg.recordApi(event('environment', { telemetry: true }));
  agg.recordApi(event('environment', { path: '/health' }));
  const [snapshot] = agg.takePending();
  expect(snapshot.api.totalRequests).toBe(4);
  expect(snapshot.probes).toMatchObject({ observedRequests: 4, matchedRequests: 3, correlatedRequests: 2,
    repeatRequests: 1, multiCategoryRequests: 1, success2xx: 1,
    probeTargets: { environment: 1, git_metadata: 1, backup: 1 },
    probeHours: { '08': 3 }, probeStatuses: { '404': 1, '2xx': 1, aborted: 1 },
    probeMethods: { GET: 2, HEAD: 1 }, countries: { TW: 2, unknown: 1 } });
  expect(JSON.stringify(snapshot)).not.toMatch(/hmac:|PRIVATE/);
  const merged = mergeDailyData(snapshot, snapshot, config);
  expect(merged.probes.matchedRequests).toBe(6);
  expect(mergeDailyData(snapshot, { ...snapshot, probes: undefined }, {}).probes.matchedRequests).toBe(3);
  expect(sanitizeDay(day, snapshot, now).data.probes.matchedRequests).toBe(3);
  agg.close();
});

test('disabled aggregation remains compatible; enabled collection with no matches is observed zero', () => {
  const disabled = createTrafficAggregator({ ...config, enableSecurityProbes: false }, { now: () => now });
  disabled.recordApi(event('environment'));
  expect(disabled.takePending()[0]).not.toHaveProperty('probes');
  const enabled = createTrafficAggregator(config, { now: () => now });
  enabled.recordApi(event(null));
  expect(enabled.takePending()[0].probes).toMatchObject({ observedRequests: 1, matchedRequests: 0 });
  disabled.close();
  enabled.close();
});

test('dashboard and CSV distinguish missing, observed zero and invalid probe data without breaking API analytics', async () => {
  const agg = createTrafficAggregator(config, { now: () => now });
  agg.recordApi(event(null));
  const [zero] = agg.takePending();
  const malformed = { ...zero, dayKey: '2026-11-25', probes: { ...zero.probes, matchedRequests: 5 } };
  const records = { [day]: zero, '2026-11-25': malformed };
  const db = { collection: () => ({ doc: date => ({ get: async () => ({ exists: !!records[date], data: () => records[date] }) }) }) };
  const query = createTrafficQueryService(config, { db, now: () => now });
  const snapshot = await query.getSnapshot({ days: 3 });
  expect(snapshot.overview.coverage.availableDays).toBe(2);
  expect(snapshot.overview.probes).toMatchObject({ collectionEnabled: true, observedDays: 1, invalidDays: 1,
    totals: { matchedRequests: 0 }, dailyTrends: [{ count: null, status: 'not_observed' }, { count: null, status: 'invalid' }, { count: 0, status: 'available' }] });
  const csv = snapshotCsv(snapshot);
  expect(csv).toContain('2026-11-24,probes,coverage,observation,,not_observed');
  expect(csv).toContain('2026-11-25,probes,coverage,observation,,invalid');
  expect(csv).toContain('2026-11-26,probes,totals,matchedRequests,0,available');
  agg.close();
});
