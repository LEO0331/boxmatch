#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const { validateDays, dayRange, safeCsvCell, dailyRows, snapshotCsv } = require('../server/observability/trafficCsv');
const { sanitizeDay } = require('../server/admin/trafficQueryService');

async function exportTrafficCsv(db, { days = 7, now = new Date() } = {}) {
  const keys = dayRange(days, now);
  const records = [];
  for (const key of keys) {
    const snapshot = await db.collection('traffic_daily').doc(key).get();
    records.push(snapshot.exists ? sanitizeDay(key, snapshot.data(), new Date(now).getTime())
      : { date: key, status: 'missing', data: null });
  }
  const csv = snapshotCsv({ days: records });
  // All exported fields are fixed-schema labels and numbers (no multiline cells).
  const rows = csv.trimEnd().split('\n').length - 1;
  return { csv, startKey: keys[0], endKey: keys[keys.length - 1], rows };
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
