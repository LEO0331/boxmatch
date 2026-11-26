'use strict';

const { createTrafficQueryService, normalizePeriod } = require('../admin/trafficQueryService');
const { emptyDaily } = require('../observability/trafficAggregator');

const NOW = Date.parse('2026-11-26T12:00:00Z');
const today = '2026-11-26';

function daily(date = today, { total = 10, views = 20, clientErrors = 2, serverErrors = 1, aborted = 1 } = {}) {
  const data = emptyDaily(date);
  Object.assign(data.api, { totalRequests: total, success: total - clientErrors - serverErrors - aborted,
    clientErrors, serverErrors, aborted, rateLimited: Math.min(clientErrors, 1) });
  for (const value of Object.values(data.api)) if (typeof value === 'object') value.unknown = total;
  data.api.riskLevels = { low: total - 3, suspicious: 2, high: 1, unknown: 0 };
  data.api.verificationStatuses = { verified: 2, unverified: total - 2, unknown: 0 };
  data.api.countries = { TW: total - 2, other: 1, unknown: 1 };
  data.website.pageViews = views;
  for (const value of Object.values(data.website)) if (typeof value === 'object') value.unknown = views;
  data.website.countries = { TW: Math.max(0, views - 5), unknown: Math.min(5, views), other: 0 };
  data.updatedAt = new Date(NOW - 60000);
  return data;
}

function zeroDaily(date = today) {
  const result = emptyDaily(date);
  result.updatedAt = new Date(NOW);
  return result;
}

function database(records = {}) {
  const reads = [];
  const get = jest.fn(async (date) => ({ exists: Object.hasOwn(records, date), data: () => records[date] }));
  return { reads, get, collection: jest.fn((name) => {
    expect(name).toBe('traffic_daily');
    return { doc(date) { reads.push(date); return { id: date, get: () => get(date) }; } };
  }) };
}

function service(records, config = {}, clock = () => NOW) {
  const db = database(records);
  return { db, query: createTrafficQueryService(config, { db, now: clock }) };
}

describe('bounded, sanitized traffic analytics snapshots', () => {
  test.each([7, 30, 90])('reads exactly %i fixed daily IDs, including missing documents', async (days) => {
    const { db, query } = service({ [today]: daily() });
    const response = await query.getOverview({ days: String(days) });
    expect(db.reads).toHaveLength(days);
    expect(new Set(db.reads).size).toBe(days);
    expect(db.reads[days - 1]).toBe(today);
    expect(response.period).toMatchObject({ endDate: today, timezone: 'UTC' });
    expect(response.coverage).toMatchObject({ requestedDays: days, availableDays: 1, missingDays: days - 1 });
    expect(response.dailyTrends[0]).toMatchObject({ available: false, status: 'missing', pageViews: null, apiRequests: null });
  });

  test.each([null, [], { days: [] }, { days: {} }, { days: '0' }, { days: '-1' }, { days: '91' },
    { days: '1.5' }, { days: '7&uid=PRIVATE' }, { collection: 'reservations' }, { days: '7', fields: '*' },
    { startDate: '2026-11-27', endDate: '2026-11-26' }, { days: 'Infinity' }])('rejects invalid queries before reads: %j', async (input) => {
    const { db, query } = service({});
    await expect(query.getOverview(input)).rejects.toMatchObject({ status: 400, code: 'TRAFFIC_ADMIN_QUERY_INVALID' });
    expect(db.collection).not.toHaveBeenCalled();
  });

  test('normalizes equivalent periods and respects configured query maximum', async () => {
    const { db, query } = service({ [today]: daily() }, { trafficAdminMaxQueryDays: 30 });
    expect(query.normalizeQuery({ days: '07' })).toEqual(query.normalizeQuery({ days: 7 }));
    await query.getOverview({ days: 7 });
    await query.getOverview({ days: '07' });
    expect(db.reads).toHaveLength(7);
    expect((await query.getOverview({ days: 7 })).dataQuality.supportedPeriods).toEqual([7, 30]);
    await expect(query.getOverview({ days: 31 })).rejects.toMatchObject({ status: 400 });
  });

  test('uses UTC calendar boundaries rather than the host timezone', () => {
    expect(normalizePeriod({ days: '2' }, {}, Date.parse('2026-11-26T23:59:59Z'))).toMatchObject({ startDate: '2026-11-25', endDate: '2026-11-26' });
    expect(normalizePeriod({ days: '2' }, {}, Date.parse('2026-11-27T00:00:00Z'))).toMatchObject({ startDate: '2026-11-26', endDate: '2026-11-27' });
  });

  test('keeps denominators separate, success semantics, aborted requests and rate-limited subsets', async () => {
    const { query } = service({ [today]: daily() });
    const response = await query.getOverview({ days: 1 });
    expect(response.summary).toEqual({ websitePageViews: 20, apiRequests: 10, apiSuccess: 6,
      apiSuccessRate: 60, apiErrors: 3, apiErrorRate: 30, suspiciousRequests: 2,
      highRiskRequests: 1, verifiedBotRequests: 2, apiKnownCountryRate: 90, websiteKnownCountryRate: 75 });
    expect(response.api.rateLimited).toBe(1);
    expect(response.api.aborted).toBe(1);
    expect(response.dailyTrends[0]).toMatchObject({ pageViews: 20, apiRequests: 10, apiSuccess: 6, aborted: 1 });
    expect(response.dataQuality).toMatchObject({ stale: false, currentDayPartial: true });
  });

  test('distinguishes no persisted data from a real zero-observation day', async () => {
    const missing = await service({}).query.getOverview({ days: 1 });
    expect(missing.summary.websitePageViews).toBeNull();
    expect(missing.summary.apiRequests).toBeNull();
    expect(missing.dataQuality.stale).toBeNull();
    const zero = await service({ [today]: zeroDaily() }).query.getOverview({ days: 1 });
    expect(zero.coverage.availableDays).toBe(1);
    expect(zero.summary.apiRequests).toBe(0);
    expect(zero.summary.apiErrorRate).toBeNull();
    expect(zero.dailyTrends[0].apiRequests).toBe(0);
  });

  test.each([
    (data) => { data.api.success = -1; },
    (data) => { data.api.success = '6'; },
    (data) => { data.api.success = NaN; },
    (data) => { data.api.rateLimited = 3; },
    (data) => { data.api.totalRequests = 11; },
    (data) => { data.api.riskLevels.high = 5; },
    (data) => { delete data.website.browsers; },
    (data) => { data.website.asns = { 'PRIVATE_ASN': 20 }; },
    (data) => { data.api.countries = Object.fromEntries(Array.from({ length: 513 }, (_, i) => [`X${i}`, 0])); },
    (data) => { data.api.countries = { ZZ: 10 }; },
    (data) => { data.api.asns = Object.fromEntries(Array.from({ length: 103 }, (_, i) => [String(i + 1), i === 0 ? 10 : 0])); },
    (data) => { data.dayKey = '2020-01-01'; }
  ])('flags malformed persisted data instead of fabricating observations', async (mutate) => {
    const data = daily(); mutate(data);
    const response = await service({ [today]: data }).query.getOverview({ days: 1 });
    expect(response.coverage).toMatchObject({ availableDays: 0, invalidDays: 1 });
    expect(response.dailyTrends[0]).toMatchObject({ status: 'invalid', pageViews: null });
    expect(response.summary.apiRequests).toBeNull();
    expect(JSON.stringify(response)).not.toContain('PRIVATE_ASN');
  });

  test('flags unsupported versions separately and allows valid dates in partial coverage', async () => {
    const old = daily('2026-11-25'); old.schemaVersion = 999;
    const response = await service({ [today]: daily(), '2026-11-25': old }).query.getOverview({ days: 7 });
    expect(response.coverage).toMatchObject({ availableDays: 1, unsupportedDays: 1, missingDays: 5 });
    expect(response.dataQuality.issues).toEqual(expect.arrayContaining(['MISSING_DAYS', 'UNSUPPORTED_SCHEMA']));
    expect(response.summary.apiRequests).toBe(10);
  });

  test('returns allowlisted metrics and flags only, never persisted identities or config secrets', async () => {
    const data = daily();
    Object.assign(data, { rawIp: 'PRIVATE_IP', uid: 'PRIVATE_UID', flushId: 'PRIVATE_FLUSH', requestBody: { token: 'PRIVATE_TOKEN' } });
    data.api.identifiers = { 'PRIVATE_FINGERPRINT': 1 };
    const response = await service({ [today]: data }, { enableRequestIntelligence: true,
      enableGeoEnrichment: true, geoCountryDbPath: 'PRIVATE_PATH', ipHmacSecret: 'PRIVATE_SECRET' }).query.getOverview({ days: 1 });
    expect(JSON.stringify(response)).not.toContain('PRIVATE_');
    expect(response.dataQuality.flags).toEqual({ requestIntelligence: true, botVerification: false, trafficAdmin: false,
      frontendTelemetry: false, geoEnrichment: true, trafficAggregation: false });
  });

  test('groups excess ASN categories accurately, retains unknown/other, and sorts ties stably', async () => {
    const first = daily(today, { total: 60 });
    first.api.asns = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [String(i + 1), 1]));
    const response = await service({ [today]: first }).query.getOverview({ days: 1 });
    expect(Object.keys(response.api.asns)).toHaveLength(52);
    expect(response.api.asns.other).toBe(10);
    expect(response.api.asns.unknown).toBe(0);
    expect(Object.values(response.api.asns).reduce((a, b) => a + b, 0)).toBe(60);
    const keys = Object.keys(response.api.asns).filter((key) => !['unknown', 'other'].includes(key));
    // Integer-looking object keys enumerate numerically, while membership is
    // selected using a stable lexicographic tie break before serialization.
    expect(keys).toContain('10');
    expect(keys).not.toContain('9');
  });

  test('merges and bounds country distributions while preserving overflow as known coverage', async () => {
    const codes = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM'.split(' ');
    const data = daily(today, { total: codes.length });
    data.api.countries = Object.fromEntries(codes.map((code) => [code, 1]));
    const response = await service({ [today]: data }).query.getOverview({ days: 1 });
    expect(Object.keys(response.api.countries)).toHaveLength(52);
    expect(response.api.countries.other).toBe(codes.length - 50);
    expect(response.api.countries.unknown).toBe(0);
    expect(response.summary.apiKnownCountryRate).toBe(100);
    expect(Object.values(response.api.countries).reduce((a, b) => a + b, 0)).toBe(codes.length);
  });

  test('detects cross-day overflow and excludes the invalid contribution atomically', async () => {
    const large = zeroDaily('2026-11-25');
    large.api.totalRequests = large.api.success = Number.MAX_SAFE_INTEGER;
    for (const value of Object.values(large.api)) if (typeof value === 'object') value.unknown = Number.MAX_SAFE_INTEGER;
    const next = zeroDaily(today); next.api.totalRequests = next.api.success = 1;
    for (const value of Object.values(next.api)) if (typeof value === 'object') value.unknown = 1;
    const response = await service({ '2026-11-25': large, [today]: next }).query.getOverview({ days: 2 });
    expect(response.summary.apiRequests).toBe(Number.MAX_SAFE_INTEGER);
    expect(response.coverage).toMatchObject({ availableDays: 1, invalidDays: 1 });
    expect(response.dataQuality.issues).toContain('COUNTER_OVERFLOW');
  });

  test('stale and unavailable timestamps do not masquerade as healthy live metrics', async () => {
    const stale = daily(); stale.updatedAt = new Date(NOW - 3600000);
    expect((await service({ [today]: stale }).query.getOverview({ days: 1 })).dataQuality.stale).toBe(true);
    for (const value of ['invalid', new Date(NOW + 86400000), { toDate() { throw new Error('PRIVATE'); } }]) {
      const data = daily(); data.updatedAt = value;
      const response = await service({ [today]: data }).query.getOverview({ days: 1 });
      expect(response.coverage.lastPersistedAt).toBeNull();
      expect(response.dataQuality.stale).toBeNull();
      expect(response.coverage.availableDays).toBe(1);
    }
  });
});

describe('cache, read budgets and bounded concurrent database operations', () => {
  afterEach(() => jest.useRealTimers());

  test('real Firestore adapters read ninety fixed IDs in six bounded batch RPCs', async () => {
    const { db, query } = service({ [today]: daily() });
    db.getAll = jest.fn(async (...refs) => Promise.all(refs.map(async (ref) => ({ id: ref.id, ...await db.get(ref.id) }))));
    const response = await query.getOverview({ days: 90 });
    expect(db.getAll).toHaveBeenCalledTimes(6);
    expect(db.getAll.mock.calls.map((refs) => refs.length)).toEqual([15, 15, 15, 15, 15, 15]);
    expect(db.reads).toHaveLength(90);
    expect(query.reservedReads).toBe(90);
    expect(response.coverage).toMatchObject({ availableDays: 1, missingDays: 89 });
    expect(response.dailyTrends[89].date).toBe(today);
  });

  test('batch snapshot order cannot change dates and malformed batches never fall back to extra reads', async () => {
    const { db, query } = service({ [today]: daily() });
    db.getAll = jest.fn(async (...refs) => Promise.all([...refs].reverse().map(async (ref) => ({ id: ref.id, ...await db.get(ref.id) }))));
    const response = await query.getOverview({ days: 7 });
    expect(response.dailyTrends[6]).toMatchObject({ date: today, status: 'available' });
    expect(response.dailyTrends[0].status).toBe('missing');
    db.getAll.mockResolvedValueOnce([{ id: 'PRIVATE_UNEXPECTED_DOCUMENT', exists: false }]);
    await expect(query.getOverview({ days: 2 })).rejects.toMatchObject({ status: 503, code: 'TRAFFIC_ADMIN_QUERY_UNAVAILABLE' });
    expect(db.get).toHaveBeenCalledTimes(7);
  });

  test('timed-out batch reads retain the slot and never begin a second batch', async () => {
    jest.useFakeTimers();
    const { db, query } = service({}, { trafficAdminQueryTimeoutMs: 10 });
    let release;
    let heldRefs;
    db.getAll = jest.fn((...refs) => { heldRefs = refs; return new Promise((resolve) => { release = resolve; }); });
    const result = expect(query.getOverview({ days: 90 })).rejects.toMatchObject({ status: 503, code: 'TRAFFIC_ADMIN_QUERY_TIMEOUT' });
    await jest.advanceTimersByTimeAsync(11);
    await result;
    expect(query.pendingSize).toBe(1);
    release(heldRefs.map((ref) => ({ id: ref.id, exists: false })));
    await jest.advanceTimersByTimeAsync(0);
    expect(db.getAll).toHaveBeenCalledTimes(1);
    expect(query.pendingSize).toBe(0);
    expect(query.cacheSize).toBe(0);
    expect(query.reservedReads).toBe(90);
  });

  test('overview and protected export reuse one immutable snapshot and deduplicate concurrent requests', async () => {
    const { db, query } = service({ [today]: daily() });
    const [overview, snapshot] = await Promise.all([query.getOverview({ days: 7 }), query.getSnapshot({ days: '07' })]);
    expect(db.reads).toHaveLength(7);
    expect(snapshot.overview).toBe(overview);
    expect(() => { snapshot.overview.api.totalRequests = 999; }).toThrow(TypeError);
    expect((await query.getOverview({ days: 7 })).api.totalRequests).toBe(10);
    expect(query.reservedReads).toBe(7);
  });

  test('expires cached snapshots and enforces LRU capacity', async () => {
    let now = NOW;
    const { db, query } = service({}, { trafficAdminCacheTtlMs: 1000, trafficAdminCacheMaxEntries: 1 }, () => now);
    await query.getOverview({ days: 1 }); await query.getOverview({ days: 2 });
    expect(query.cacheSize).toBe(1);
    await query.getOverview({ days: 1 });
    expect(db.reads).toHaveLength(4);
    now += 1000;
    await query.getOverview({ days: 1 });
    expect(db.reads).toHaveLength(5);
  });

  test('reserves missing-document reads before work and resets the budget at UTC rollover', async () => {
    let now = NOW;
    const { db, query } = service({}, { trafficAdminReadBudgetPerDay: 7, trafficAdminCacheTtlMs: 1000 }, () => now);
    await query.getOverview({ days: 7 });
    now += 1001;
    await expect(query.getOverview({ days: 1 })).rejects.toMatchObject({ status: 429, code: 'TRAFFIC_ADMIN_READ_BUDGET_EXHAUSTED' });
    expect(db.reads).toHaveLength(7);
    now = Date.parse('2026-11-27T00:00:00Z');
    await query.getOverview({ days: 1 });
    expect(query.reservedReads).toBe(1);
    expect(db.reads).toHaveLength(8);
  });

  test('database failures remain generic, uncached and counted against the reserved budget', async () => {
    const { db, query } = service({});
    db.get.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_CREDENTIAL'));
    await expect(query.getOverview({ days: 7 })).rejects.toMatchObject({ status: 503, code: 'TRAFFIC_ADMIN_QUERY_UNAVAILABLE', message: 'TRAFFIC_ADMIN_QUERY_UNAVAILABLE' });
    expect(query.reservedReads).toBe(7);
    expect(query.cacheSize).toBe(0);
    await query.getOverview({ days: 1 });
    expect(db.reads).toHaveLength(2);
  });

  test('bounds active queries and does not enqueue excess work', async () => {
    const { db, query } = service({});
    const releases = [];
    db.get.mockImplementation(() => new Promise((resolve) => releases.push(() => resolve({ exists: false }))));
    const first = query.getOverview({ days: 1 });
    const second = query.getOverview({ days: 2 });
    expect(db.reads).toHaveLength(2);
    await expect(query.getOverview({ days: 3 })).rejects.toMatchObject({ status: 429, code: 'TRAFFIC_ADMIN_QUERY_CAPACITY' });
    releases.shift()(); releases.shift()();
    await new Promise((resolve) => setImmediate(resolve));
    releases.shift()();
    await Promise.all([first, second]);
    expect(query.pendingSize).toBe(0);
    expect(db.reads).toHaveLength(3);
  });

  test('timeout holds the load slot until underlying read settles and cannot cache late results', async () => {
    jest.useFakeTimers();
    const { db, query } = service({}, { trafficAdminQueryTimeoutMs: 10, trafficAdminQueryConcurrency: 1 });
    let release;
    db.get.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const result = expect(query.getOverview({ days: 7 })).rejects.toMatchObject({ status: 503, code: 'TRAFFIC_ADMIN_QUERY_TIMEOUT' });
    await jest.advanceTimersByTimeAsync(11);
    await result;
    expect(query.pendingSize).toBe(1);
    await expect(query.getOverview({ days: 1 })).rejects.toMatchObject({ status: 429 });
    expect(db.reads).toHaveLength(1);
    release({ exists: false });
    await jest.advanceTimersByTimeAsync(0);
    expect(query.pendingSize).toBe(0);
    expect(query.cacheSize).toBe(0);
    expect(db.reads).toHaveLength(1);
  });
});
