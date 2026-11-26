const { randomUUID } = require('node:crypto');
const { mergeDailyData, validDay } = require('./trafficAggregator');

function bounded(value, fallback, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}

function createTrafficPersistence(config = {}, { db, aggregator, logEvent = () => {}, now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const enabled = config.enableTrafficAggregation === true;
  const intervalMs = bounded(config.trafficFlushIntervalMs, 300000, 60000, 3600000);
  const writeBudget = bounded(config.trafficWriteBudgetPerDay, 600, 2, 1000);
  const retentionDays = bounded(config.trafficRetentionDays, 90, 7, 365);
  let budgetDay = '';
  let reservedWrites = 0;
  let lastFlushAt = null;
  let inFlight = null;
  let timer = null;
  let closing = false;
  let shutdownExpired = false;

  const day = () => new Date(now()).toISOString().slice(0, 10);
  function log(level, event, fields) {
    try { logEvent(level, event, fields); } catch (_) { /* optional logging */ }
  }

  function reserveAttempt() {
    const current = day();
    if (budgetDay !== current) { budgetDay = current; reservedWrites = 0; }
    if (reservedWrites + 2 > writeBudget) return false;
    // One SDK transaction attempt reads at most two documents and commits at
    // most two writes. A replay may read only its marker and write nothing.
    reservedWrites += 2;
    return true;
  }

  function recent(snapshot) {
    if (!validDay(snapshot?.dayKey) || snapshot.dayKey > day()) return false;
    const cutoff = new Date(`${day()}T00:00:00Z`).getTime() - (retentionDays - 1) * 86400000;
    return new Date(`${snapshot.dayKey}T00:00:00Z`).getTime() >= cutoff;
  }

  async function persist(snapshot, id) {
    const markerRef = db.collection('traffic_flushes').doc(id);
    const dailyRef = db.collection('traffic_daily').doc(snapshot.dayKey);
    return db.runTransaction(async (tx) => {
      const marker = await tx.get(markerRef);
      if (marker.exists) return 'replayed';
      const existing = await tx.get(dailyRef);
      const data = mergeDailyData(existing.data(), snapshot, config);
      tx.set(dailyRef, { ...data, updatedAt: new Date(now()) });
      tx.set(markerRef, { schemaVersion: 1, dayKey: snapshot.dayKey, createdAt: new Date(now()) });
      return 'written';
    }, { maxAttempts: 1 });
  }

  async function run() {
    const snapshots = aggregator.takePending();
    const result = { written: 0, replayed: 0, dropped: 0, deferred: 0 };
    for (const snapshot of snapshots) {
      if (!recent(snapshot)) { aggregator.ackPending(snapshot); result.dropped++; continue; }
      const id = randomUUID();
      let acknowledged = false;
      let attempted = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (shutdownExpired || !reserveAttempt()) break;
        attempted = true;
        try {
          const outcome = await persist(snapshot, id);
          result[outcome]++;
          acknowledged = true;
          break;
        } catch (_) {
          // The commit may have succeeded. Retrying the same immutable delta
          // and marker ID cannot duplicate increments, even across instances.
          if (attempt < 3 && !closing) await sleep(250 * 2 ** (attempt - 1));
          else break;
        }
      }
      if (acknowledged) aggregator.ackPending(snapshot);
      else if (!attempted) {
        aggregator.restorePending(snapshot);
        result.deferred++;
      } else {
        // Never restore an uncertain delta under a fresh ID: that could count
        // an acknowledged-lost commit twice. Exhaustion conservatively loses it.
        aggregator.ackPending(snapshot);
        result.dropped++;
        log('warn', 'traffic.flush.dropped', { code: 'TRAFFIC_FLUSH_RETRY_EXHAUSTED' });
      }
    }
    if (result.deferred) log('warn', 'traffic.flush.deferred', {
      code: shutdownExpired ? 'TRAFFIC_SHUTDOWN_DEADLINE_REACHED' : 'TRAFFIC_WRITE_BUDGET_EXHAUSTED'
    });
    return result;
  }

  function flush({ force = false } = {}) {
    if (!enabled) return Promise.resolve({ disabled: true });
    if (inFlight) return inFlight;
    if (shutdownExpired) return Promise.resolve({ disabled: true });
    if (!force && lastFlushAt != null && now() - lastFlushAt < intervalMs) return Promise.resolve({ skipped: true });
    lastFlushAt = now();
    inFlight = Promise.resolve().then(run).catch(() => {
      log('warn', 'traffic.flush.failed', { code: 'TRAFFIC_FLUSH_FAILED' });
      return { failed: true };
    }).finally(() => { inFlight = null; });
    return inFlight;
  }

  function stop() { if (timer) clearInterval(timer); timer = null; }

  return {
    flush,
    start() {
      if (!enabled || timer || closing) return;
      timer = setInterval(() => { flush(); }, intervalMs);
      timer.unref?.();
    },
    stop,
    async shutdown(deadlineMs = 2000) {
      stop();
      closing = true;
      const deadline = bounded(deadlineMs, 2000, 1, 10000);
      let timeout;
      try {
        return await Promise.race([flush({ force: true }), new Promise((resolve) => {
          timeout = setTimeout(() => { shutdownExpired = true; resolve({ timedOut: true }); }, deadline);
          timeout.unref?.();
        })]);
      } finally { clearTimeout(timeout); }
    },
    get reservedWrites() { return reservedWrites; }
  };
}

module.exports = { createTrafficPersistence };
