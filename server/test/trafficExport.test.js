const admin = require('./firebaseAdminMock');
const { validateDays, dayRange, safeCsvCell, dailyRows, exportTrafficCsv } = require('../../scripts/export_traffic_csv');

beforeEach(() => admin.__reset());

test.each([0, -1, 91, 1.5, NaN, Infinity, '', '1e1', '0x10', [], {}, 'abc'])('rejects invalid export range %j', (value) => {
  expect(() => validateDays(value)).toThrow();
});

test('date range uses complete UTC daily keys with an explicit maximum', () => {
  expect(dayRange('3', '2026-11-25T23:59:59-08:00'))
    .toEqual(['2026-11-24', '2026-11-25', '2026-11-26']);
  expect(dayRange(90)).toHaveLength(90);
  expect(() => dayRange(1, 'invalid')).toThrow('Invalid export date.');
});

test.each(['=HYPERLINK("https://attacker")', '+cmd', '-1+2', '@SUM(A1)', '\t =SUM(A1)', '\n@cmd'])('neutralizes spreadsheet formula %j', (value) => {
  expect(safeCsvCell(value).replace(/^"/, '')).toMatch(/^'/);
});

test('CSV quoting handles commas, quotes and controls independently of formula protection', () => {
  expect(safeCsvCell('Telecom, "Network"')).toBe('"Telecom, ""Network"""');
  expect(safeCsvCell('value\nnext')).toBe('"value\nnext"');
  expect(safeCsvCell('safe\x00name')).toBe('safename');
  expect(safeCsvCell(null)).toBe('');
});

test('exports valid allowlisted aggregates without per-visitor metadata', async () => {
  const { createTrafficAggregator } = require('../observability/trafficAggregator');
  const aggregator = createTrafficAggregator({ enableTrafficAggregation: true }, { now: () => Date.parse('2026-11-25T12:00:00Z') });
  aggregator.recordApi({ method: 'GET', path: '/listings', status: 200, network: { identityConfidence: 'trusted', geoStatus: 'resolved', country: 'TW', asn: 3462 } });
  aggregator.recordVisit({ page: 'home', acquisitionChannel: 'ai_referral' });
  const [data] = aggregator.takePending();
  admin.__seed('traffic_daily', '2026-11-25', { ...data, rawIp: '8.8.8.8', firebaseUid: 'PRIVATE_UID' });
  const result = await exportTrafficCsv(admin.firestore(), { days: 1, now: '2026-11-25T12:00:00Z' });
  expect(result.csv).toContain('dayKey,stream,dimension,key,count,status\n');
  expect(result.csv).toContain('2026-11-25,api,totals,totalRequests,1,available');
  expect(result.csv).toContain('2026-11-25,website,channels,ai_referral,1,available');
  expect(result.csv).toContain('2026-11-25,api,asns,3462,1,available');
  expect(result.csv).not.toMatch(/PRIVATE|8\.8\.8\.8|firebaseUid|rawIp/);
});

test('missing, malformed and unsupported documents are not exported as observed zeros', async () => {
  admin.__seed('traffic_daily', '2026-11-24', { schemaVersion: 1, dayKey: '2026-11-24', api: { totalRequests: -1 } });
  admin.__seed('traffic_daily', '2026-11-25', { schemaVersion: 2, dayKey: '2026-11-25' });
  const collection = jest.spyOn(admin.firestore(), 'collection');
  const result = await exportTrafficCsv(admin.firestore(), { days: 3, now: '2026-11-25T12:00:00Z' });
  expect(result.startKey).toBe('2026-11-23');
  expect(result.endKey).toBe('2026-11-25');
  expect(collection).toHaveBeenCalledTimes(3);
  expect(result.rows).toBe(3);
  expect(result.csv).toContain('2026-11-23,,coverage,observation,,missing');
  expect(result.csv).toContain('2026-11-24,,coverage,observation,,invalid');
  expect(result.csv).toContain('2026-11-25,,coverage,observation,,unsupported');
  collection.mockRestore();
});

test('malformed counters cannot produce negative or nonfinite analytics', () => {
  const rows = dailyRows('2026-11-25', { api: { totalRequests: -1, success: Infinity,
    countries: { TW: -4, unknown: '10' } }, website: { pageViews: 1.5 } });
  expect(rows.every((row) => Number.isSafeInteger(row[4]) && row[4] >= 0)).toBe(true);
  expect(rows.find((row) => row[3] === 'totalRequests')[4]).toBe(0);
});
