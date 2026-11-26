const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { collection, doc, getDocs, getDoc, query, where, setDoc, updateDoc, deleteDoc } = require('firebase/firestore');

const projectId = 'demo-boxmatch-reservations';
let env;
const reservation = (uid, code) => ({
  claimerUid: uid, listingId: 'listing-one', pickupCode: code,
  qty: 1, status: 'reserved', createdAt: new Date(), expiresAt: new Date()
});
const ownQuery = (db, uid) => query(collection(db, 'reservations'), where('claimerUid', '==', uid));

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Tests must run against the local emulator');
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') }
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await Promise.all([
      setDoc(doc(db, 'reservations', 'a'), reservation('alice', 'alice-code')),
      setDoc(doc(db, 'reservations', 'b'), reservation('bob', 'bob-code')),
      setDoc(doc(db, 'listings', 'listing-one'), { itemType: 'Lunchbox' }),
      setDoc(doc(db, 'schema_migrations', 'listing_privacy_v1'), { completed: true, version: 1 }),
      setDoc(doc(db, 'traffic_daily', '2026-11-26'), { schemaVersion: 1 }),
      setDoc(doc(db, 'traffic_flushes', 'marker'), { schemaVersion: 1 })
    ]);
  });
});
after(async () => { if (env) await env.cleanup(); });

test('owner query with claimerUid equality returns only that authenticated owner', async () => {
  const db = env.authenticatedContext('alice', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
  const result = await assertSucceeds(getDocs(ownQuery(db, 'alice')));
  assert.deepEqual(result.docs.map((d) => d.id), ['a']);
  assert.equal(result.docs[0].data().pickupCode, 'alice-code');
  await assertSucceeds(getDoc(doc(db, 'reservations', 'a')));
  const empty = await assertSucceeds(getDocs(ownQuery(env.authenticatedContext('empty').firestore(), 'empty')));
  assert.equal(empty.size, 0);
});
test('unauthenticated, foreign, unfiltered and mixed-owner reads fail', async () => {
  const anon = env.unauthenticatedContext().firestore();
  const bob = env.authenticatedContext('bob').firestore();
  await assertFails(getDocs(ownQuery(anon, 'alice')));
  await assertFails(getDoc(doc(anon, 'reservations', 'a')));
  await assertFails(getDocs(ownQuery(bob, 'alice')));
  await assertFails(getDoc(doc(bob, 'reservations', 'a')));
  await assertFails(getDocs(collection(bob, 'reservations')));
  await assertFails(getDocs(query(collection(bob, 'reservations'), where('claimerUid', 'in', ['alice', 'bob']))));
});
test('owner cannot create, change ownership, update status, or delete reservations', async () => {
  const db = env.authenticatedContext('alice').firestore();
  await assertFails(setDoc(doc(db, 'reservations', 'new'), reservation('alice', 'new')));
  await assertFails(updateDoc(doc(db, 'reservations', 'a'), { status: 'cancelled' }));
  await assertFails(updateDoc(doc(db, 'reservations', 'a'), { claimerUid: 'bob' }));
  await assertFails(deleteDoc(doc(db, 'reservations', 'a')));
});
test('migration markers and traffic data remain server-only even with admin claim', async () => {
  const db = env.authenticatedContext('operator', { trafficAdmin: true }).firestore();
  for (const [name, id] of [['schema_migrations', 'listing_privacy_v1'], ['traffic_daily', '2026-11-26'], ['traffic_flushes', 'marker']]) {
    await assertFails(getDoc(doc(db, name, id)));
    await assertFails(setDoc(doc(db, name, id), { completed: true }));
  }
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'listings', 'listing-one')));
});
