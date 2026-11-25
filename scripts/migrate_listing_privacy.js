#!/usr/bin/env node

const crypto = require('crypto');

function privateEnterpriseKey(value) {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('ip:') && !value.startsWith('alias:')) return value;
  return `legacy:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

// Startup runs this before opening the HTTP listener; a standalone CLI is also available.
// Each listing moves atomically and can safely be processed again after a retry.
async function migrateListingPrivacy(db, FieldValue) {
  const listings = await db.collection('listings').get();
  let migrated = 0;
  for (const listing of listings.docs) {
    const publicRef = db.collection('listings').doc(listing.id);
    const privateRef = db.collection('listing_private').doc(listing.id);
    const changed = await db.runTransaction(async (tx) => {
      const publicSnapshot = await tx.get(publicRef);
      const privateSnapshot = await tx.get(privateRef);
      if (!publicSnapshot.exists) return false;
      const publicData = publicSnapshot.data();
      const privateData = privateSnapshot.exists ? privateSnapshot.data() : {};
      const publicPatch = {};
      const privatePatch = {};
      const hasLegacyFields = Object.hasOwn(publicData, 'editTokenHash') ||
        Object.hasOwn(publicData, 'enterpriseKey');

      for (const field of ['editTokenHash', 'enterpriseKey']) {
        if (Object.hasOwn(publicData, field)) {
          publicPatch[field] = FieldValue.delete();
          // A rotated/revoked private credential always wins over an old copy.
          if (!Object.hasOwn(privateData, field)) {
            privatePatch[field] = field === 'enterpriseKey'
              ? privateEnterpriseKey(publicData[field]) : publicData[field];
          }
        }
      }
      if (Object.hasOwn(privateData, 'enterpriseKey')) {
        const sanitized = privateEnterpriseKey(privateData.enterpriseKey);
        if (sanitized !== privateData.enterpriseKey) privatePatch.enterpriseKey = sanitized;
      }
      if (hasLegacyFields && !privateSnapshot.exists) {
        privatePatch.ownerUid = null;
        if (publicData.createdAt != null) privatePatch.createdAt = publicData.createdAt;
      }

      if (!privateData.ownerUid) {
        if (publicData.enterpriseVerified === true) publicPatch.enterpriseVerified = false;
        if (Array.isArray(publicData.enterpriseBadges)) {
          const badges = publicData.enterpriseBadges.filter(
            badge => badge !== 'verified' && badge !== 'quality_trusted'
          );
          if (badges.length !== publicData.enterpriseBadges.length) {
            publicPatch.enterpriseBadges = badges;
          }
        }
      }

      if (Object.keys(privatePatch).length) tx.set(privateRef, privatePatch, { merge: true });
      if (Object.keys(publicPatch).length) tx.update(publicRef, publicPatch);
      return Boolean(Object.keys(privatePatch).length || Object.keys(publicPatch).length);
    });
    if (changed) migrated += 1;
  }
  return { scanned: listings.docs.length, migrated };
}

async function main() {
  const admin = require('../server/firebaseAdmin');
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY.');
  }
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert({
      projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n')
    }) });
  }
  const result = await migrateListingPrivacy(admin.firestore(), admin.firestore.FieldValue);
  console.log(JSON.stringify({ ok: true, ...result }));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { migrateListingPrivacy };
