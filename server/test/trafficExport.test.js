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

test('exports only schema-approved counters and dimensions without per-visitor metadata', async () => {
  admin.__seed('traffic_daily', '2026-11-25', {
    schemaVersion: 1, dayKey: '2026-11-25', ipFingerprint: 'hmac:PRIVATE', rawIp: '8.8.8.8',
    organization: '=PRIVATE_FORMULA', firebaseUid: 'PRIVATE_UID',
    api: { totalRequests: 4, success: 2, clientErrors: 1, serverErrors: 1, aborted: 0,
      classifications: { likely_human: 3, unknown: 1, PRIVATE_CLASS: 4 },
      riskLevels: { low: 2, high: 2 }, verificationStatuses: { unverified: 3, verification_unavailable: 1 },
      countries: { TW: 2, unknown: 1, other: 1, PRIVATE_COUNTRY: 1 },
      asns: { 3462: 2, other: 1, unknown: 1, '-123': 9, '=PRIVATE': 1 },
      identityConfidence: { trusted: 3, unresolved: 1 }, geoStatuses: { resolved: 2, unavailable: 2 } },
    website: { pageViews: 2, pages: { home: 2 }, channels: { organic_search: 1, ai_referral: 1 },
      campaignSources: { google: 1, other: 1 }, campaignMediums: { organic: 1, unknown: 1 },
      browsers: { Chrome: 1, unknown: 1 }, operatingSystems: { 'Chrome OS': 1, unknown: 1 } }
  });
  const result = await exportTrafficCsv(admin.firestore(), { days: 1, now: '2026-11-25T12:00:00Z' });
  expect(result.csv).toContain('dayKey,stream,dimension,key,count\n');
  expect(result.csv).toContain('2026-11-25,api,totals,totalRequests,4\n');
  expect(result.csv).toContain('2026-11-25,website,totals,pageViews,2\n');
  expect(result.csv).toContain('2026-11-25,website,channels,ai_referral,1\n');
  expect(result.csv).toContain('2026-11-25,api,asns,3462,2\n');
  expect(result.csv).toContain('2026-11-25,api,countries,unknown,1\n');
  expect(result.csv).toContain('2026-11-25,api,countries,other,1\n');
  expect(result.csv).toContain('2026-11-25,api,verificationStatuses,verification_unavailable,1\n');
  expect(result.csv).not.toMatch(/PRIVATE|8\.8\.8\.8|organization|firebaseUid|ipFingerprint/);
});

test('missing documents yield zero daily totals and exactly one read per selected day', async () => {
  const collection = jest.spyOn(admin.firestore(), 'collection');
  const result = await exportTrafficCsv(admin.firestore(), { days: 3, now: '2026-11-25T12:00:00Z' });
  expect(result.startKey).toBe('2026-11-23');
  expect(result.endKey).toBe('2026-11-25');
  expect(collection).toHaveBeenCalledTimes(3);
  expect(result.rows).toBe(21);
  expect(result.csv).toContain('2026-11-23,website,totals,pageViews,0\n');
  collection.mockRestore();
});

test('malformed counters cannot produce negative or nonfinite analytics', () => {
  const rows = dailyRows('2026-11-25', { api: { totalRequests: -1, success: Infinity,
    countries: { TW: -4, unknown: '10' } }, website: { pageViews: 1.5 } });
  expect(rows.every((row) => Number.isSafeInteger(row[4]) && row[4] >= 0)).toBe(true);
  expect(rows.find((row) => row[3] === 'totalRequests')[4]).toBe(0);
});
