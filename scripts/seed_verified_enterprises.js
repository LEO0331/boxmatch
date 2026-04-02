#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizeAlias(value) {
  return String(value || '').trim().toLowerCase();
}

function initAdminFromEnv() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    fail(
      'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY in environment.'
    );
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n')
      })
    });
  }
}

async function main() {
  const inputPath =
    process.argv[2] ||
    path.resolve(process.cwd(), 'docs/ops/verified_enterprises.seed.json');

  if (!fs.existsSync(inputPath)) {
    fail(`Seed file not found: ${inputPath}`);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`Invalid JSON in ${inputPath}: ${error.message}`);
  }
  const records = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.verifiedEnterprises)
    ? parsed.verifiedEnterprises
    : null;
  const badgeRules = Array.isArray(parsed) ? null : parsed?.badgeRules;
  if (!Array.isArray(records) || records.length === 0) {
    fail(
      'Seed data must be a non-empty JSON array, or an object with verifiedEnterprises[].'
    );
  }

  initAdminFromEnv();
  const db = admin.firestore();
  const collection = db.collection('verified_enterprises');
  const badgeRulesRef = db.collection('badge_rules').doc('default');
  const now = new Date();

  let upserted = 0;
  for (const entry of records) {
    const aliasNormalized = normalizeAlias(entry.aliasNormalized);
    const venueId = String(entry.venueId || '').trim();
    const active = entry.active !== false;
    const reviewedBy = String(entry.reviewedBy || 'ops').trim();
    const notes = String(entry.notes || '').trim();
    const reviewedAtInput = entry.reviewedAt;
    const reviewedAt = reviewedAtInput ? new Date(reviewedAtInput) : now;

    if (!aliasNormalized) {
      fail('Every record must include non-empty aliasNormalized.');
    }
    if (!venueId) {
      fail('Every record must include non-empty venueId.');
    }
    if (Number.isNaN(reviewedAt.getTime())) {
      fail(`Invalid reviewedAt datetime for alias: ${aliasNormalized}`);
    }

    const docId = `${aliasNormalized}__${venueId}`.replace(/[^a-z0-9_\-:.]/g, '_');
    await collection.doc(docId).set(
      {
        aliasNormalized,
        venueId,
        active,
        reviewedBy,
        reviewedAt,
        notes,
        updatedAt: now,
        createdAt: now
      },
      { merge: true }
    );
    upserted += 1;
  }

  let badgeRulesUpdated = false;
  if (badgeRules && typeof badgeRules === 'object') {
    const mergedBadgeRules = {
      enabled: badgeRules.enabled !== false,
      rules: badgeRules.rules && typeof badgeRules.rules === 'object'
        ? badgeRules.rules
        : {}
    };
    await badgeRulesRef.set(
      {
        ...mergedBadgeRules,
        updatedAt: now
      },
      { merge: true }
    );
    badgeRulesUpdated = true;
  }

  console.log(
    JSON.stringify({
      ok: true,
      collection: 'verified_enterprises',
      upserted,
      badgeRulesUpdated,
      source: inputPath
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
