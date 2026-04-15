#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (!admin.apps.length) {
  if (projectId && clientEmail && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n')
      })
    });
  } else {
    admin.initializeApp();
  }
}

const db = admin.firestore();

function toNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function safeCsvCell(value) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

async function main() {
  const days = Number(process.argv[2] || 7);
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error('Usage: node scripts/export_kpi_csv.js <days>, e.g. 7');
  }

  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const startKey = start.toISOString().slice(0, 10);

  const snapshot = await db
    .collection('kpi_daily')
    .where('dayKey', '>=', startKey)
    .orderBy('dayKey', 'asc')
    .get();

  const headers = [
    'dayKey',
    'listing_created_count',
    'listed_qty_total',
    'reservation_created_count',
    'reserved_qty_total',
    'pickup_confirmed_count',
    'pickup_qty_total',
    'estimated_meals_reserved_total',
    'estimated_meals_picked_up_total',
    'estimated_kg_diverted_total'
  ];

  const rows = [headers.join(',')];

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const row = [
      data.dayKey || doc.id,
      toNumber(data.listing_created_count),
      toNumber(data.listed_qty_total),
      toNumber(data.reservation_created_count),
      toNumber(data.reserved_qty_total),
      toNumber(data.pickup_confirmed_count),
      toNumber(data.pickup_qty_total),
      toNumber(data.estimated_meals_reserved_total),
      toNumber(data.estimated_meals_picked_up_total),
      toNumber(data.estimated_kg_diverted_total)
    ];
    rows.push(row.map(safeCsvCell).join(','));
  }

  const outputDir = path.join(process.cwd(), 'reports');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(
    outputDir,
    `kpi-daily-${startKey}-to-${now.toISOString().slice(0, 10)}.csv`
  );

  fs.writeFileSync(outputPath, `${rows.join('\n')}\n`, 'utf8');
  console.log(`CSV exported: ${outputPath}`);
  console.log(`Rows: ${Math.max(0, rows.length - 1)}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
