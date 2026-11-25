jest.mock('firebase-admin', () => require('./firebaseAdminMock'));

const request = require('supertest');
const admin = require('firebase-admin');
const { app, startServer, __test } = require('../index');

function payload(overrides = {}) {
  const now = Date.now();
  return { data: {
    venueId: 'venue-1', pickupPointText: 'Booth A1', itemType: 'Lunchbox',
    description: 'Surplus meals', quantityTotal: 3,
    pickupStartAt: new Date(now + 30 * 60000).toISOString(),
    pickupEndAt: new Date(now + 90 * 60000).toISOString(),
    expiresAt: new Date(now + 150 * 60000).toISOString(),
    displayNameOptional: 'Trusted Enterprise', visibility: 'minimal', ...overrides
  } };
}

async function create(overrides = {}, uid) {
  const call = request(app).post('/enterprise/listings/create');
  if (uid) call.set('Authorization', `Bearer valid:${uid}`);
  const response = await call.send(payload(overrides));
  expect(response.status).toBe(200);
  return response.body;
}

function listing(id) {
  return admin.__dump('listings').find((entry) => entry.id === id).data;
}

async function reserve(id, qty = 1, key = 'reserve-1') {
  return request(app).post(`/recipient/listings/${id}/reserve`)
    .set('Authorization', 'Bearer valid:recipient-1')
    .send({ qty, disclaimerAccepted: true, idempotencyKey: key });
}

describe('security review hardening regressions', () => {
  beforeEach(() => {
    admin.__reset();
    __test.resetRequestLimits?.();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('a copied public alias and venue do not grant verification', async () => {
    admin.__seed('verified_enterprises', 'trusted', {
      aliasNormalized: 'trusted enterprise', venueId: 'venue-1',
      ownerUid: 'trusted-owner', active: true
    });
    const anonymous = await create();
    const impersonator = await create({}, 'attacker');
    for (const id of [anonymous.listingId, impersonator.listingId]) {
      expect(listing(id).enterpriseVerified).toBe(false);
      expect(listing(id).enterpriseBadges).not.toContain('verified');
    }
    const edited = await request(app)
      .post(`/enterprise/listings/${impersonator.listingId}/update`)
      .send({ token: impersonator.token, data: { displayNameOptional: 'Trusted Enterprise' } });
    expect(edited.status).toBe(200);
    expect(listing(impersonator.listingId).enterpriseVerified).toBe(false);
  });

  test('verification belongs to the authenticated registry principal and venue', async () => {
    admin.__seed('verified_enterprises', 'trusted', {
      ownerUid: 'trusted-owner', venueId: 'venue-1', active: true
    });
    const own = await create({}, 'trusted-owner');
    expect(listing(own.listingId).enterpriseVerified).toBe(true);
    expect(listing(own.listingId).enterpriseBadges).toContain('verified');
    const moved = await request(app).post(`/enterprise/listings/${own.listingId}/update`)
      .send({ token: own.token, data: { venueId: 'other-venue' } });
    expect(moved.status).toBe(200);
    expect(listing(own.listingId).enterpriseVerified).toBe(false);
  });

  test('invalid supplied enterprise ID tokens fail closed', async () => {
    const denied = await request(app).post('/enterprise/listings/create')
      .set('Authorization', 'Bearer invalid').send(payload());
    expect(denied.status).toBe(401);
    expect(admin.__dump('listings')).toHaveLength(0);
    expect(admin.__dump('listing_private')).toHaveLength(0);
  });

  test('alias changes and anonymous account cycling share a network posting budget', async () => {
    for (let i = 0; i < 5; i++) await create({ displayNameOptional: `Alias ${i}` }, `user-${i}`);
    const denied = await request(app).post('/enterprise/listings/create')
      .set('Authorization', 'Bearer valid:new-account')
      .send(payload({ displayNameOptional: 'Fresh alias' }));
    expect(denied.status).toBe(429);
    expect(admin.__dump('listings')).toHaveLength(5);
  });

  test('concurrent creates atomically admit no more than the daily limit', async () => {
    const responses = await Promise.all(Array.from({ length: 9 }, (_, i) =>
      request(app).post('/enterprise/listings/create')
        .send(payload({ displayNameOptional: `Concurrent ${i}` }))));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(5);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(4);
    expect(admin.__dump('listings')).toHaveLength(5);
    expect(admin.__dump('listing_private')).toHaveLength(5);
  });

  test('public listing documents exclude credential and identity metadata', async () => {
    const created = await create({}, 'owner-1');
    const publicData = listing(created.listingId);
    expect(publicData).not.toHaveProperty('editTokenHash');
    expect(publicData).not.toHaveProperty('enterpriseKey');
    expect(publicData).not.toHaveProperty('ownerUid');
    const metadata = admin.__dump('listing_private').find((entry) => entry.id === created.listingId).data;
    expect(metadata.editTokenHash).toBe(__test.sha256(created.token));
    expect(metadata.ownerUid).toBe('owner-1');
    expect(metadata.enterpriseKey).toBe('uid:owner-1');
    const valid = await request(app).post(`/enterprise/listings/${created.listingId}/validate-token`)
      .send({ token: created.token });
    expect(valid.status).toBe(200);
  });

  test('metadata update rereads inventory after a reservation races token verification', async () => {
    const created = await create({ quantityTotal: 1 });
    const db = admin.firestore();
    const collection = db.collection.bind(db);
    let intercepted = false;
    let reservation;
    jest.spyOn(db, 'collection').mockImplementation((name) => {
      const result = collection(name);
      if (name !== 'listings') return result;
      const doc = result.doc.bind(result);
      result.doc = (id) => {
        const ref = doc(id);
        const get = ref.get.bind(ref);
        ref.get = async () => {
          const snapshot = await get();
          if (id === created.listingId && !intercepted) {
            intercepted = true;
            reservation = await reserve(created.listingId);
          }
          return snapshot;
        };
        return ref;
      };
      return result;
    });
    const edited = await request(app).post(`/enterprise/listings/${created.listingId}/update`)
      .send({ token: created.token, data: { description: 'Updated details' } });
    expect(intercepted).toBe(true);
    expect(reservation.status).toBe(200);
    expect(edited.status).toBe(200);
    expect(listing(created.listingId).quantityRemaining).toBe(0);
    expect(listing(created.listingId).status).toBe('reserved');
    expect(edited.body.updatedFields).not.toContain('quantityRemaining');
    expect((await reserve(created.listingId, 1, 'second-reserve')).status).toBe(400);
  });

  test('quantity changes preserve allocated stock and reject totals below reservations', async () => {
    const created = await create({ quantityTotal: 3 });
    expect((await reserve(created.listingId, 2)).status).toBe(200);
    const denied = await request(app).post(`/enterprise/listings/${created.listingId}/update`)
      .send({ token: created.token, data: { quantityTotal: 1 } });
    expect(denied.status).toBe(400);
    expect(listing(created.listingId).quantityRemaining).toBe(1);
    const increased = await request(app).post(`/enterprise/listings/${created.listingId}/update`)
      .send({ token: created.token, data: { quantityTotal: 4 } });
    expect(increased.status).toBe(200);
    expect(listing(created.listingId).quantityRemaining).toBe(2);
  });

  test('an edit token revoked after initial verification cannot commit an update', async () => {
    const created = await create();
    const db = admin.firestore();
    const collection = db.collection.bind(db);
    let intercepted = false;
    jest.spyOn(db, 'collection').mockImplementation((name) => {
      const result = collection(name);
      if (name !== 'listing_private') return result;
      const doc = result.doc.bind(result);
      result.doc = (id) => {
        const ref = doc(id);
        const get = ref.get.bind(ref);
        ref.get = async () => {
          const snapshot = await get();
          if (id === created.listingId && !intercepted) {
            intercepted = true;
            await ref.update({ editTokenHash: '' });
          }
          return snapshot;
        };
        return ref;
      };
      return result;
    });
    const edited = await request(app).post(`/enterprise/listings/${created.listingId}/update`)
      .send({ token: created.token, data: { description: 'Unauthorized update' } });
    expect(intercepted).toBe(true);
    expect(edited.status).toBe(403);
    expect(listing(created.listingId).description).toBe('Surplus meals');
  });

  test('invalid token signals deduplicate and stop writing after a network budget is exhausted', async () => {
    for (let i = 0; i < 23; i++) {
      admin.__seed('listings', `target-${i}`, { status: 'active' });
      admin.__seed('listing_private', `target-${i}`, { editTokenHash: __test.sha256('correct-token') });
    }
    for (let i = 0; i < 3; i++) {
      expect((await request(app).post('/enterprise/listings/target-0/validate-token')
        .send({ token: 'incorrect-token' })).status).toBe(403);
    }
    expect(admin.__dump('abuse_signals')).toHaveLength(1);
    for (let i = 1; i < 23; i++) {
      expect((await request(app).post(`/enterprise/listings/target-${i}/validate-token`)
        .send({ token: 'incorrect-token' })).status).toBe(403);
    }
    expect(admin.__dump('abuse_signals')).toHaveLength(20);
    expect(admin.__dump('security_budgets').map((entry) => entry.data.count)).toEqual([20]);
  });

  test('report budgets and deduplication survive request limiter resets', async () => {
    for (let i = 0; i < 20; i++) {
      const response = await request(app).post('/recipient/listings/listing-1/report-abuse')
        .set('Authorization', 'Bearer valid:reporter')
        .send({ reason: `Report ${i}` });
      expect(response.status).toBe(200);
    }
    __test.resetRequestLimits?.();
    const duplicate = await request(app).post('/recipient/listings/listing-1/report-abuse')
      .set('Authorization', 'Bearer valid:reporter').send({ reason: 'Report 0' });
    expect(duplicate.status).toBe(200);
    const denied = await request(app).post('/recipient/listings/listing-1/report-abuse')
      .set('Authorization', 'Bearer valid:another-account').send({ reason: 'Report 21' });
    expect(denied.status).toBe(429);
    expect(admin.__dump('abuse_signals')).toHaveLength(20);
  });

  test('unavailable reservation signals persist outside rolled-back transactions', async () => {
    const created = await create({ quantityTotal: 1 });
    expect((await reserve(created.listingId)).status).toBe(200);
    const failed = await reserve(created.listingId, 1, 'unavailable-reserve');
    expect(failed.status).toBe(400);
    expect(admin.__dump('reservations')).toHaveLength(1);
    expect(listing(created.listingId).quantityRemaining).toBe(0);
    expect(admin.__dump('abuse_signals').map((entry) => entry.data.reason))
      .toContain('reserve_failed_unavailable');
  });

  test('wrong pickup codes preserve the active reservation and persist a failure signal', async () => {
    const created = await create({ quantityTotal: 1 });
    const reserved = await reserve(created.listingId);
    const reservation = reserved.body.reservation;
    const failed = await request(app).post(`/enterprise/listings/${created.listingId}/confirm-pickup`)
      .send({ token: created.token, reservationId: reservation.id, pickupCode: 'definitely-wrong' });
    expect(failed.status).toBe(400);
    expect(admin.__dump('reservations')[0].data.status).toBe('reserved');
    expect(admin.__dump('abuse_signals').map((entry) => entry.data.reason)).toContain('pickup_code_mismatch');
  });

  test.each(['rotate-token', 'revoke-token'])('concurrent %s calls cannot reuse the same credential', async (operation) => {
    const created = await create();
    const responses = await Promise.all(Array.from({ length: 2 }, () =>
      request(app).post(`/enterprise/listings/${created.listingId}/${operation}`)
        .send({ token: created.token })));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 403)).toHaveLength(1);
    const metadata = admin.__dump('listing_private')[0].data;
    if (operation === 'rotate-token') {
      const winner = responses.find((response) => response.status === 200);
      expect(metadata.editTokenHash).toBe(__test.sha256(winner.body.token));
    } else {
      expect(metadata.editTokenHash).toBe('');
    }
  });

  test('startup sanitizes legacy public listings before listening and preserves rotated credentials', async () => {
    admin.__seed('listings', 'legacy-1', {
      editTokenHash: __test.sha256('old-token'), enterpriseKey: 'ip:192.0.2.1',
      enterpriseVerified: true, enterpriseBadges: ['verified', 'quality_trusted', 'high_impact'],
      createdAt: new Date()
    });
    admin.__seed('listings', 'legacy-rotated', {
      editTokenHash: __test.sha256('stale-token'), enterpriseKey: 'alias:legacy',
      enterpriseVerified: true
    });
    admin.__seed('listing_private', 'legacy-rotated', {
      editTokenHash: __test.sha256('rotated-token'), enterpriseKey: 'uid:owner', ownerUid: 'owner'
    });
    const server = { close: jest.fn() };
    const listen = jest.spyOn(app, 'listen').mockImplementation(() => {
      for (const entry of admin.__dump('listings')) {
        expect(entry.data).not.toHaveProperty('editTokenHash');
        expect(entry.data).not.toHaveProperty('enterpriseKey');
      }
      expect(listing('legacy-1').enterpriseVerified).toBe(false);
      expect(listing('legacy-1').enterpriseBadges).toEqual(['high_impact']);
      return server;
    });
    expect(await startServer(0)).toBe(server);
    expect(listen).toHaveBeenCalledTimes(1);
    const metadata = admin.__dump('listing_private');
    expect(metadata.find((entry) => entry.id === 'legacy-1').data.editTokenHash)
      .toBe(__test.sha256('old-token'));
    expect(metadata.find((entry) => entry.id === 'legacy-1').data.enterpriseKey).toMatch(/^legacy:[a-f0-9]{64}$/);
    expect(metadata.find((entry) => entry.id === 'legacy-rotated').data.editTokenHash)
      .toBe(__test.sha256('rotated-token'));
  });

  test('startup fails closed without opening a listener when privacy migration fails', async () => {
    admin.__seed('listings', 'legacy-1', { editTokenHash: 'legacy-hash' });
    jest.spyOn(admin.firestore(), 'runTransaction').mockRejectedValueOnce(new Error('Migration unavailable'));
    const listen = jest.spyOn(app, 'listen').mockImplementation(() => ({ close: jest.fn() }));
    await expect(startServer(0)).rejects.toThrow('Migration unavailable');
    expect(listen).not.toHaveBeenCalled();
  });
});
