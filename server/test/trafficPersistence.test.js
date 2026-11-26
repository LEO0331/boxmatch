const admin = require('./firebaseAdminMock');
const { createTrafficAggregator } = require('../observability/trafficAggregator');
const { createTrafficPersistence } = require('../observability/trafficPersistence');

const start = Date.parse('2026-11-25T12:00:00Z');
const event = { method: 'GET', path: '/listings', status: 200 };

function fixture(config = {}) {
  let now = start;
  const settings = { enableTrafficAggregation: true, ...config };
  const aggregator = createTrafficAggregator(settings, { now: () => now });
  const db = admin.firestore();
  const sleep = jest.fn(async () => {});
  const logEvent = jest.fn();
  const persistence = createTrafficPersistence(settings, { db, aggregator, now: () => now, sleep, logEvent });
  return { aggregator, db, sleep, logEvent, persistence, advance: (ms) => { now += ms; } };
}

beforeEach(() => admin.__reset());
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('does not read/write Firestore per request and skips empty flushes', async () => {
  const { aggregator, persistence, db } = fixture();
  const transaction = jest.spyOn(db, 'runTransaction');
  await persistence.flush();
  expect(transaction).not.toHaveBeenCalled();
  for (let i = 0; i < 300; i++) aggregator.recordApi(event);
  expect(transaction).not.toHaveBeenCalled();
  expect(await persistence.flush({ force: true })).toMatchObject({ written: 1 });
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(transaction.mock.calls[0][1]).toEqual({ maxAttempts: 1 });
  expect(admin.__dump('traffic_daily')[0].data.api.totalRequests).toBe(300);
  expect(admin.__dump('traffic_flushes')).toHaveLength(1);
  expect(aggregator.size).toBe(0);
});

test('same immutable delta and marker ID prevent duplication after an ambiguous successful commit', async () => {
  const { aggregator, persistence, db, sleep } = fixture();
  aggregator.recordApi(event);
  const original = db.runTransaction.bind(db);
  let first = true;
  jest.spyOn(db, 'runTransaction').mockImplementation(async (...args) => {
    const value = await original(...args);
    if (first) { first = false; throw new Error('PRIVATE_AMBIGUOUS_COMMIT'); }
    return value;
  });
  expect(await persistence.flush()).toMatchObject({ replayed: 1, dropped: 0 });
  expect(admin.__dump('traffic_daily')[0].data.api.totalRequests).toBe(1);
  expect(admin.__dump('traffic_flushes')).toHaveLength(1);
  expect(sleep).toHaveBeenCalledWith(250);
  expect(persistence.reservedWrites).toBe(4);
});

test('retries a rejected write with bounded exponential delays and recovers', async () => {
  const { aggregator, persistence, db, sleep, logEvent } = fixture();
  aggregator.recordApi(event);
  const original = db.runTransaction.bind(db);
  jest.spyOn(db, 'runTransaction')
    .mockRejectedValueOnce(new Error('PRIVATE_FIREBASE_SECRET'))
    .mockRejectedValueOnce(new Error('PRIVATE_FIREBASE_SECRET'))
    .mockImplementation(original);
  expect(await persistence.flush()).toMatchObject({ written: 1 });
  expect(sleep.mock.calls).toEqual([[250], [500]]);
  expect(db.runTransaction).toHaveBeenCalledTimes(3);
  expect(persistence.reservedWrites).toBe(6);
  expect(JSON.stringify(logEvent.mock.calls)).not.toContain('PRIVATE');
});

test('exhausted ambiguous deltas drop conservatively rather than being retried under fresh IDs', async () => {
  const { aggregator, persistence, db, advance } = fixture();
  aggregator.recordApi(event);
  jest.spyOn(db, 'runTransaction').mockRejectedValue(new Error('PRIVATE_NETWORK_FAILURE'));
  expect(await persistence.flush()).toMatchObject({ dropped: 1 });
  expect(db.runTransaction).toHaveBeenCalledTimes(3);
  expect(aggregator.size).toBe(0);
  advance(300000);
  await persistence.flush();
  expect(db.runTransaction).toHaveBeenCalledTimes(3);
});

test('parallel flush requests share one operation and interval bounds normal writes', async () => {
  const { aggregator, persistence, db, advance } = fixture();
  aggregator.recordApi(event);
  const transaction = jest.spyOn(db, 'runTransaction');
  const one = persistence.flush();
  const two = persistence.flush();
  expect(two).toBe(one);
  await Promise.all([one, two]);
  aggregator.recordApi(event);
  expect(await persistence.flush()).toEqual({ skipped: true });
  expect(transaction).toHaveBeenCalledTimes(1);
  advance(300000);
  await persistence.flush();
  expect(transaction).toHaveBeenCalledTimes(2);
  expect(admin.__dump('traffic_daily')[0].data.api.totalRequests).toBe(2);
});

test('budget exhaustion retains untouched pending data, and UTC budget reset recovers the original day', async () => {
  const { aggregator, persistence, advance, db } = fixture({ trafficWriteBudgetPerDay: 2 });
  const transaction = jest.spyOn(db, 'runTransaction');
  aggregator.recordApi(event);
  await persistence.flush();
  aggregator.recordApi(event);
  advance(300000);
  expect(await persistence.flush()).toMatchObject({ deferred: 1 });
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(aggregator.size).toBe(1);
  advance(86400000);
  expect(await persistence.flush()).toMatchObject({ written: 1 });
  expect(admin.__dump('traffic_daily')).toHaveLength(1);
  expect(admin.__dump('traffic_daily')[0].id).toBe('2026-11-25');
  expect(admin.__dump('traffic_daily')[0].data.api.totalRequests).toBe(2);
});

test('budget exhaustion after an ambiguous commit never restores its already-written delta', async () => {
  const { aggregator, persistence, db, advance } = fixture({ trafficWriteBudgetPerDay: 2 });
  const original = db.runTransaction.bind(db);
  const transaction = jest.spyOn(db, 'runTransaction').mockImplementationOnce(async (...args) => {
    await original(...args);
    throw new Error('Acknowledgment lost');
  });
  aggregator.recordApi(event);
  expect(await persistence.flush()).toMatchObject({ dropped: 1 });
  expect(aggregator.size).toBe(0);
  advance(86400000);
  aggregator.recordApi({ ...event, ts: '2026-11-25T23:00:00Z' });
  await persistence.flush();
  expect(transaction).toHaveBeenCalledTimes(2);
  expect(admin.__dump('traffic_daily')[0].data.api.totalRequests).toBe(2);
});

test('concurrent instances merge daily counters and enforce shared ASN cardinality', async () => {
  const one = fixture({ trafficMaxAsnBuckets: 1 });
  const two = fixture({ trafficMaxAsnBuckets: 1 });
  one.aggregator.recordApi({ ...event, network: { identityConfidence: 'trusted', geoStatus: 'resolved', country: 'TW', asn: 3462 } });
  two.aggregator.recordApi({ ...event, network: { identityConfidence: 'trusted', geoStatus: 'resolved', country: 'US', asn: 15169 } });
  await Promise.all([one.persistence.flush(), two.persistence.flush()]);
  const daily = admin.__dump('traffic_daily')[0].data;
  expect(daily.api.totalRequests).toBe(2);
  expect(daily.api.asns).toEqual({ unknown: 0, other: 1, 3462: 1 });
  expect(admin.__dump('traffic_flushes')).toHaveLength(2);
});

test('marker metadata contains only server-generated operational data', async () => {
  const { aggregator, persistence } = fixture();
  aggregator.recordVisit({ page: 'home', ipFingerprint: 'PRIVATE_HASH', uid: 'PRIVATE_UID', token: 'PRIVATE_TOKEN' });
  await persistence.flush();
  const marker = admin.__dump('traffic_flushes')[0];
  expect(marker.id).toMatch(/^[a-f0-9-]{36}$/);
  expect(marker.data).toEqual({ schemaVersion: 1, dayKey: '2026-11-25', createdAt: new Date(start) });
  expect(JSON.stringify(admin.__dump('traffic_daily'))).not.toContain('PRIVATE');
});

test('timer observes minimum interval and does not write idle buckets', async () => {
  jest.useFakeTimers();
  const { aggregator, persistence, db, advance } = fixture({ trafficFlushIntervalMs: 1 });
  const transaction = jest.spyOn(db, 'runTransaction');
  persistence.start();
  persistence.start();
  advance(300000);
  await jest.advanceTimersByTimeAsync(300000);
  expect(transaction).not.toHaveBeenCalled();
  aggregator.recordApi(event);
  advance(300000);
  await jest.advanceTimersByTimeAsync(300000);
  expect(transaction).toHaveBeenCalledTimes(1);
  persistence.stop();
});

test('shutdown has a bounded deadline and never overlaps a hung transaction', async () => {
  jest.useFakeTimers();
  const { aggregator, persistence, db } = fixture();
  aggregator.recordApi(event);
  const transaction = jest.spyOn(db, 'runTransaction').mockReturnValue(new Promise(() => {}));
  const running = persistence.flush();
  await Promise.resolve();
  const closing = persistence.shutdown(20);
  await jest.advanceTimersByTimeAsync(21);
  expect(await closing).toEqual({ timedOut: true });
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(persistence.flush()).toBe(running);
});

test('disabled persistence performs no database work or timer scheduling', async () => {
  jest.useFakeTimers();
  const db = { collection: jest.fn(), runTransaction: jest.fn() };
  const aggregator = { takePending: jest.fn() };
  const persistence = createTrafficPersistence({}, { db, aggregator });
  persistence.start();
  expect(await persistence.flush()).toEqual({ disabled: true });
  expect(await persistence.shutdown()).toEqual({ disabled: true });
  expect(db.collection).not.toHaveBeenCalled();
  expect(aggregator.takePending).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('flush deadline is observable, retains the in-flight slot and recovers after settlement', async () => {
  jest.useFakeTimers();
  const { aggregator, persistence, db, logEvent, advance } = fixture({ trafficFlushTimeoutMs: 1000 });
  aggregator.recordApi(event);
  const original = db.runTransaction.bind(db);
  let settle;
  const transaction = jest.spyOn(db, 'runTransaction').mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
  const running = persistence.flush();
  await jest.advanceTimersByTimeAsync(1001);
  expect(await running).toEqual({ timedOut: true });
  expect(persistence.flush({ force: true })).toBe(running);
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(logEvent).toHaveBeenCalledWith('warn', 'traffic.flush.timeout', { code: 'TRAFFIC_FLUSH_DEADLINE_REACHED' });
  settle('written');
  await jest.advanceTimersByTimeAsync(0);
  transaction.mockImplementation(original);
  advance(300000);
  aggregator.recordApi(event);
  expect(await persistence.flush()).toMatchObject({ written: 1 });
  expect(transaction).toHaveBeenCalledTimes(2);
});
