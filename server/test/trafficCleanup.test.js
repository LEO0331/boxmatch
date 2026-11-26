const { parseOptions, cleanupTraffic } = require('../../scripts/cleanup_traffic');

function database(seed) {
  const data = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, new Map(rows.map((row) => [row.id, row]))]));
  const reads = [];
  const deleted = [];
  return {
    reads, deleted, data,
    collection(name) {
      return {
        where(field, op, cutoff) {
          expect(field).toBe('dayKey');
          expect(op).toBe('<');
          return { orderBy(orderField, order) {
            expect(orderField).toBe('dayKey');
            expect(order).toBe('asc');
            return { limit(limit) { return { async get() {
              reads.push({ name, cutoff, limit });
              return { docs: [...(data[name]?.values() || [])].filter((row) => row.dayKey < cutoff)
                .sort((a, b) => a.dayKey.localeCompare(b.dayKey)).slice(0, limit) };
            } }; } };
          } };
        },
        doc(id) { return { async delete() { deleted.push({ name, id }); data[name].delete(id); } }; }
      };
    }
  };
}

test('cleanup is a dry-run by default and validates a bounded retention and deletion limit', () => {
  expect(parseOptions([], {})).toEqual({ dryRun: true, retentionDays: 90, limit: 100 });
  expect(parseOptions(['--apply', '--days', '30', '--limit', '25'], {}))
    .toEqual({ dryRun: false, retentionDays: 30, limit: 25 });
  expect(parseOptions([], { TRAFFIC_RETENTION_DAYS: '120' }).retentionDays).toBe(120);
  for (const args of [['--days', '6'], ['--days', '366'], ['--limit', '501'], ['--limit', '0'],
    ['--apply', '--dry-run'], ['--unknown'], ['--days']]) expect(() => parseOptions(args, {})).toThrow();
});

test('dry-run issues bounded old-day queries without deleting aggregate or dedup records', async () => {
  const db = database({ traffic_daily: [{ id: 'old', dayKey: '2026-08-26' }, { id: 'keep', dayKey: '2026-08-27' }],
    traffic_flushes: [{ id: 'old-marker', dayKey: '2026-08-26' }, { id: 'pending-day-marker', dayKey: '2026-11-24' }] });
  const result = await cleanupTraffic(db, { now: '2026-11-25T18:00:00Z' });
  expect(result).toEqual({ dryRun: true, cutoff: '2026-08-27', candidates: 2, deleted: 0,
    collections: { traffic_daily: 1, traffic_flushes: 1 } });
  expect(db.deleted).toEqual([]);
  expect(db.reads).toHaveLength(2);
  expect(db.reads.every((read) => read.limit <= 100)).toBe(true);
});

test('apply deletes only expired data, including expired markers, within a combined limit', async () => {
  const db = database({ traffic_daily: [{ id: 'daily-old', dayKey: '2026-08-01' }, { id: 'daily-keep', dayKey: '2026-11-24' }],
    traffic_flushes: [{ id: 'flush-old1', dayKey: '2026-08-01' }, { id: 'flush-old2', dayKey: '2026-08-02' },
      { id: 'flush-keep', dayKey: '2026-11-24' }] });
  const result = await cleanupTraffic(db, { dryRun: false, limit: 2, now: '2026-11-25T18:00:00Z' });
  expect(result.deleted).toBe(2);
  expect(db.deleted).toEqual([{ name: 'traffic_daily', id: 'daily-old' }, { name: 'traffic_flushes', id: 'flush-old1' }]);
  expect(db.reads.map((read) => read.limit)).toEqual([2, 1]);
  expect(db.data.traffic_daily.has('daily-keep')).toBe(true);
  expect(db.data.traffic_flushes.has('flush-keep')).toBe(true);
});

test('a full aggregate batch does not start an additional marker query', async () => {
  const db = database({ traffic_daily: [{ id: 'old', dayKey: '2026-08-01' }], traffic_flushes: [] });
  await cleanupTraffic(db, { limit: 1, now: '2026-11-25T18:00:00Z' });
  expect(db.reads).toHaveLength(1);
});

test('cleanup options reject unsafe direct invocations before reads', async () => {
  const db = database({});
  await expect(cleanupTraffic(db, { retentionDays: 0 })).rejects.toThrow();
  await expect(cleanupTraffic(db, { limit: 1000 })).rejects.toThrow();
  await expect(cleanupTraffic(db, { dryRun: 'false' })).rejects.toThrow();
  await expect(cleanupTraffic(db, { now: 'invalid' })).rejects.toThrow();
  expect(db.reads).toEqual([]);
});
