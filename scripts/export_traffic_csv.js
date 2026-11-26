#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const API_COUNTERS = ['totalRequests', 'success', 'clientErrors', 'serverErrors', 'aborted', 'rateLimited'];
const DIMENSIONS = {
  api: ['classifications', 'riskLevels', 'verificationStatuses', 'sourceChannels', 'countries', 'asns', 'identityConfidence', 'geoStatuses'],
  website: ['pages', 'channels', 'campaignSources', 'campaignMediums', 'browsers', 'operatingSystems', 'countries', 'asns', 'identityConfidence', 'geoStatuses']
};
const KNOWN_KEYS = {
  classifications: ['likely_human', 'search_engine_crawler', 'ai_crawler', 'social_media_crawler', 'automated_api_client', 'suspected_scraper', 'suspected_security_scanner', 'unknown'],
  riskLevels: ['low', 'suspicious', 'high', 'unknown'],
  verificationStatuses: ['verified', 'unverified', 'verification_failed', 'verification_unavailable', 'not_applicable', 'unknown'],
  sourceChannels: ['search_referral', 'social_referral', 'github_referral', 'same_origin', 'external_referral', 'direct_or_unknown', 'unknown'],
  pages: ['home', 'listing_feed', 'map', 'listing_detail', 'enterprise_post', 'enterprise_edit', 'reservation', 'my_reservations', 'unknown'],
  channels: ['organic_search', 'social_referral', 'github_referral', 'ai_referral', 'campaign_referral', 'external_referral', 'internal_navigation', 'direct_or_unknown', 'unknown'],
  campaignSources: ['google', 'bing', 'duckduckgo', 'facebook', 'instagram', 'linkedin', 'reddit', 'github', 'chatgpt', 'perplexity', 'claude', 'other', 'unknown'],
  campaignMediums: ['organic', 'social', 'referral', 'email', 'cpc', 'paid_social', 'other', 'unknown'],
  browsers: ['Chrome', 'Edge', 'Firefox', 'Safari', 'Opera', 'unknown'],
  operatingSystems: ['Windows', 'macOS', 'Linux', 'Android', 'iOS', 'Chrome OS', 'unknown'],
  identityConfidence: ['trusted', 'proxy', 'unresolved', 'unknown'],
  geoStatuses: ['disabled', 'unavailable', 'resolved', 'not_found', 'unknown']
};

function validateDays(value = 7) {
  if ((typeof value !== 'number' && (typeof value !== 'string' || !/^\d{1,2}$/.test(value))) ||
      !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 90) {
    throw new Error('Traffic export days must be an integer from 1 to 90.');
  }
  return Number(value);
}

function dayRange(days, now = new Date()) {
  days = validateDays(days);
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid export date.');
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Array.from({ length: days }, (_, index) =>
    new Date(today - (days - index - 1) * 86400000).toISOString().slice(0, 10));
}

function safeCsvCell(value) {
  let text = String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  if (/^\s*[=+@-]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function counter(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function isKnownKey(dimension, key) {
  if (key === 'unknown' || key === 'other') return true;
  if (dimension === 'countries') return /^[A-Z]{2}$/.test(key);
  if (dimension === 'asns') return /^\d{1,10}$/.test(key) && Number(key) > 0 && Number(key) <= 4294967295;
  return KNOWN_KEYS[dimension]?.includes(key) || false;
}

function dailyRows(dayKey, data = {}) {
  const rows = [];
  for (const stream of ['api', 'website']) {
    const values = data?.[stream] || {};
    for (const metric of stream === 'api' ? API_COUNTERS : ['pageViews']) {
      rows.push([dayKey, stream, 'totals', metric, counter(values[metric])]);
    }
    for (const dimension of DIMENSIONS[stream]) {
      const buckets = values[dimension];
      if (!buckets || typeof buckets !== 'object' || Array.isArray(buckets)) continue;
      // Persisted maps are bounded; cap operator processing if a malformed document is supplied.
      for (const key of Object.keys(buckets).sort().slice(0, 512)) {
        if (isKnownKey(dimension, key)) rows.push([dayKey, stream, dimension, key, counter(buckets[key])]);
      }
    }
  }
  return rows;
}

async function exportTrafficCsv(db, { days = 7, now = new Date() } = {}) {
  const keys = dayRange(days, now);
  const rows = [['dayKey', 'stream', 'dimension', 'key', 'count']];
  // Direct daily document reads make the maximum read cost explicit (<=90).
  for (const key of keys) {
    const snapshot = await db.collection('traffic_daily').doc(key).get();
    const data = snapshot.exists ? snapshot.data() : {};
    rows.push(...dailyRows(key, data));
  }
  return { csv: `${rows.map((row) => row.map(safeCsvCell).join(',')).join('\n')}\n`,
    startKey: keys[0], endKey: keys[keys.length - 1], rows: rows.length - 1 };
}

function adminDatabase(env = process.env) {
  const admin = require('../server/firebaseAdmin');
  if (!admin.apps.length) {
    const projectId = env.FIREBASE_PROJECT_ID;
    const clientEmail = env.FIREBASE_CLIENT_EMAIL;
    const privateKey = env.FIREBASE_PRIVATE_KEY;
    if (projectId && clientEmail && privateKey) {
      admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n') }) });
    } else if (projectId || clientEmail || privateKey) {
      throw new Error('All Firebase Admin credential variables must be supplied together.');
    } else {
      admin.initializeApp();
    }
  }
  return admin.firestore();
}

async function main() {
  const days = validateDays(process.argv[2] || 7);
  if (process.argv.length > 3) throw new Error('Usage: node scripts/export_traffic_csv.js [days:1..90]');
  const result = await exportTrafficCsv(adminDatabase(), { days });
  const outputDir = path.join(process.cwd(), 'reports');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `traffic-daily-${result.startKey}-to-${result.endKey}.csv`);
  fs.writeFileSync(outputPath, result.csv, 'utf8');
  console.log(`Traffic CSV exported: ${outputPath} (${result.rows} rows)`);
}

if (require.main === module) main().catch(() => {
  console.error('Traffic export failed. Check the date range and Firebase Admin credentials/access.');
  process.exitCode = 1;
});

module.exports = { validateDays, dayRange, safeCsvCell, dailyRows, exportTrafficCsv, adminDatabase };
