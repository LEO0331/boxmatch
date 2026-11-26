#!/usr/bin/env node

const { adminDatabase } = require('./export_traffic_csv');

function boundedInteger(value, fallback, min, max) {
  if (value == null) return fallback;
  if ((typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) ||
      !Number.isInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    throw new Error(`Expected an integer between ${min} and ${max}.`);
  }
  return Number(value);
}

function parseOptions(args = [], env = process.env) {
  const options = { dryRun: true,
    retentionDays: boundedInteger(env.TRAFFIC_RETENTION_DAYS, 90, 7, 365), limit: 100 };
  let mode;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--apply' || arg === '--dry-run') {
      if (mode && mode !== arg) throw new Error('Choose either --apply or --dry-run.');
      mode = arg;
      options.dryRun = arg !== '--apply';
    } else if (arg === '--days' || arg === '--limit') {
      if (index + 1 >= args.length) throw new Error('Missing cleanup option value.');
      if (arg === '--days') options.retentionDays = boundedInteger(args[++index], 90, 7, 365);
      else options.limit = boundedInteger(args[++index], 100, 1, 500);
    } else {
      throw new Error('Usage: cleanup_traffic.js [--dry-run|--apply] [--days 7..365] [--limit 1..500]');
    }
  }
  return options;
}

async function cleanupTraffic(db, { dryRun = true, retentionDays = 90, limit = 100, now = new Date() } = {}) {
  retentionDays = boundedInteger(retentionDays, 90, 7, 365);
  limit = boundedInteger(limit, 100, 1, 500);
  if (typeof dryRun !== 'boolean') throw new Error('dryRun must be a boolean.');
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid cleanup date.');
  const cutoff = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
    retentionDays * 86400000).toISOString().slice(0, 10);
  const result = { dryRun, cutoff, candidates: 0, deleted: 0, collections: {} };
  for (const collection of ['traffic_daily', 'traffic_flushes']) {
    const remaining = limit - result.candidates;
    if (!remaining) break;
    const snapshot = await db.collection(collection).where('dayKey', '<', cutoff)
      .orderBy('dayKey', 'asc').limit(remaining).get();
    result.collections[collection] = snapshot.docs.length;
    result.candidates += snapshot.docs.length;
    if (!dryRun) {
      for (const doc of snapshot.docs) {
        await db.collection(collection).doc(doc.id).delete();
        result.deleted++;
      }
    }
  }
  return result;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  console.log(JSON.stringify(await cleanupTraffic(adminDatabase(), options)));
}

if (require.main === module) main().catch(() => {
  console.error('Traffic cleanup failed. Check options and Firebase Admin access; rerun dry-run before applying.');
  process.exitCode = 1;
});

module.exports = { parseOptions, cleanupTraffic };
