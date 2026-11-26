const { createTrafficAggregator, mergeDailyData, emptyDaily } = require('../observability/trafficAggregator');

const start = Date.parse('2026-11-25T12:00:00Z');
const api = { method: 'GET', path: '/listings', status: 200,
  security: { classification: 'likely_human', riskLevel: 'low', verificationStatus: 'not_applicable' },
  source: { channel: 'github_referral' }, network: { identityConfidence: 'trusted', geoStatus: 'resolved', country: 'TW', asn: 3462 } };

function make(config = {}, now = () => start) {
  return createTrafficAggregator({ enableTrafficAggregation: true, ...config }, { now });
}

test('keeps website views and API denominators distinct and excludes transport/health/preflight', () => {
  const aggregator = make();
  aggregator.recordVisit({ page: 'home', acquisitionChannel: 'organic_search', campaignSource: 'google', campaignMedium: 'organic', client: { browser: 'Chrome', os: 'Windows' }, network: api.network });
  for (let i = 0; i < 3; i++) aggregator.recordApi(api);
  for (const event of [{ ...api, path: '/health' }, { ...api, preflight: true }, { ...api, path: '/telemetry/visit' }, { ...api, telemetry: true, path: '[pre-route-or-unmatched]' }]) expect(aggregator.recordApi(event)).toBe(false);
  const [snapshot] = aggregator.takePending();
  expect(snapshot.api.totalRequests).toBe(3);
  expect(snapshot.website.pageViews).toBe(1);
  expect(snapshot.api.classifications.likely_human).toBe(3);
  expect(snapshot.website.channels.organic_search).toBe(1);
  expect(snapshot.website.browsers.Chrome).toBe(1);
});

test('response outcome partition is consistent and 429 remains a client error subset', () => {
  const aggregator = make();
  for (const status of [200, 302, 401, 403, 404, 429, 500, 503]) aggregator.recordApi({ ...api, status });
  aggregator.recordApi({ ...api, status: 499, aborted: true });
  const [snapshot] = aggregator.takePending();
  expect(snapshot.api).toMatchObject({ totalRequests: 9, success: 2, clientErrors: 4, serverErrors: 2, aborted: 1, rateLimited: 1 });
  expect(snapshot.api.success + snapshot.api.clientErrors + snapshot.api.serverErrors + snapshot.api.aborted).toBe(snapshot.api.totalRequests);
  expect(Object.values(snapshot.api.countries).reduce((a, b) => a + b, 0)).toBe(9);
});

test('unmatched telemetry namespace probes remain part of API observations', () => {
  const aggregator = make();
  expect(aggregator.recordApi({ ...api, path: '/telemetry/.env', status: 404 })).toBe(true);
  expect(aggregator.recordApi({ ...api, path: '/TELEMETRY/visit/', status: 204 })).toBe(false);
  expect(aggregator.takePending()[0].api.totalRequests).toBe(1);
});

test('unknown values are coarse buckets and identifiers are never retained', () => {
  const aggregator = make();
  aggregator.recordVisit({ page: '/listing/SECRET_ID', acquisitionChannel: 'PRIVATE_URL', campaignSource: 'PRIVATE_UID', client: { browser: 'PRIVATE_AGENT' }, network: { ip: '8.8.8.8', ipFingerprint: 'PRIVATE_HASH', organization: 'PRIVATE_ORG', country: 'PRIVATE_COUNTRY', asn: 'PRIVATE_ASN' } });
  const [snapshot] = aggregator.takePending();
  expect(snapshot.website.pages.unknown).toBe(1);
  expect(snapshot.website.countries.unknown).toBe(1);
  expect(snapshot.website.asns.unknown).toBe(1);
  expect(JSON.stringify(snapshot)).not.toMatch(/SECRET|PRIVATE|8\.8\.8\.8/);
});

test('caps ASN/country dimensions with overflow and preserves explicit unknown', () => {
  const aggregator = make({ trafficMaxAsnBuckets: 2, trafficMaxCountryBuckets: 2 });
  for (const [country, asn] of [['TW', 3462], ['US', 15169], ['JP', 2516], [null, null]]) {
    aggregator.recordApi({ ...api, network: { ...api.network, country, asn } });
  }
  const [snapshot] = aggregator.takePending();
  expect(snapshot.api.countries).toEqual({ unknown: 1, other: 1, TW: 1, US: 1 });
  expect(snapshot.api.asns).toEqual({ unknown: 1, other: 1, 3462: 1, 15169: 1 });
});

test('does not assign a proxy location to visitors', () => {
  const aggregator = make();
  aggregator.recordApi({ ...api, network: { ...api.network, identityConfidence: 'proxy' } });
  const [snapshot] = aggregator.takePending();
  expect(snapshot.api.countries).toEqual({ unknown: 1, other: 0 });
  expect(snapshot.api.asns).toEqual({ unknown: 1, other: 0 });
});

test('UTC rollover and late completions keep their original day; old/future timestamps drop', () => {
  const aggregator = make({}, () => Date.parse('2026-11-26T00:00:01Z'));
  aggregator.recordApi({ ...api, ts: '2026-11-25T23:59:59Z' });
  aggregator.recordVisit({ page: 'home', ts: '2026-11-26T00:00:01Z' });
  expect(aggregator.recordApi({ ...api, ts: '2026-01-01' })).toBe(false);
  expect(aggregator.recordApi({ ...api, ts: '2027-01-01' })).toBe(false);
  expect(aggregator.takePending().map((data) => data.dayKey)).toEqual(['2026-11-25', '2026-11-26']);
  expect(aggregator.droppedEvents).toBe(2);
});

test('in-flight snapshots occupy bounded day slots and new observations stay separate', () => {
  let now = start;
  const aggregator = make({ trafficMaxPendingDays: 1 }, () => now);
  aggregator.recordApi(api);
  const [snapshot] = aggregator.takePending();
  aggregator.recordApi(api);
  expect(aggregator.takePending()).toEqual([]);
  now += 86400000;
  expect(aggregator.recordApi(api)).toBe(false);
  aggregator.ackPending(snapshot);
  const [newSnapshot] = aggregator.takePending();
  expect(newSnapshot.api.totalRequests).toBe(1);
  expect(newSnapshot.dayKey).toBe('2026-11-25');
  aggregator.ackPending(newSnapshot);
  expect(aggregator.recordApi(api)).toBe(true);
  expect(aggregator.size).toBe(1);
});

test('restoring a reserved snapshot merges newer observations without duplication', () => {
  const aggregator = make();
  aggregator.recordApi(api);
  const [snapshot] = aggregator.takePending();
  aggregator.recordApi(api);
  aggregator.restorePending(snapshot);
  aggregator.restorePending(snapshot);
  expect(aggregator.takePending()[0].api.totalRequests).toBe(2);
});

test('inactive non-flight days expire and disabled aggregation does no work', () => {
  let now = start;
  const aggregator = make({ trafficMaxPendingDays: 1 }, () => now);
  aggregator.recordApi(api);
  now += 86400000;
  expect(aggregator.recordApi(api)).toBe(true);
  expect(aggregator.takePending()[0].dayKey).toBe('2026-11-26');
  const disabled = createTrafficAggregator({}, { now: () => { throw new Error('must not inspect'); } });
  expect(disabled.recordApi(api)).toBe(false);
  expect(disabled.recordVisit({})).toBe(false);
  expect(disabled.takePending()).toEqual([]);
});

test('transaction merge constrains cumulative cardinality across different instances', () => {
  const one = emptyDaily('2026-11-25');
  one.api.asns = { 100: 1, 101: 1 };
  const two = emptyDaily('2026-11-25');
  two.api.asns = { 102: 1, 103: 1 };
  two.api.countries = { TW: 1, US: 1, JP: 1 };
  two.api.classifications = { attacker_supplied_PRIVATE: 9, unknown: -3 };
  two.ip = 'PRIVATE_IP';
  const merged = mergeDailyData(one, two, { trafficMaxAsnBuckets: 2, trafficMaxCountryBuckets: 2 });
  expect(merged.api.asns).toEqual({ unknown: 0, other: 2, 100: 1, 101: 1 });
  expect(merged.api.countries.other).toBe(1);
  expect(merged.api.classifications).toEqual({ unknown: 9 });
  expect(JSON.stringify(merged)).not.toContain('PRIVATE');
});
