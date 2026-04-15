jest.mock('firebase-admin', () => require('./firebaseAdminMock'));

const request = require('supertest');
const admin = require('firebase-admin');
const { app } = require('../index');

function makeCreatePayload(overrides = {}) {
  const now = Date.now();
  return {
    data: {
      venueId: 'taipei-nangang-exhibition-center-hall-1',
      pickupPointText: 'Booth A1',
      itemType: 'Lunchbox',
      description: 'Seed listing',
      quantityTotal: 3,
      pickupStartAt: new Date(now + 30 * 60 * 1000).toISOString(),
      pickupEndAt: new Date(now + 90 * 60 * 1000).toISOString(),
      expiresAt: new Date(now + 150 * 60 * 1000).toISOString(),
      displayNameOptional: 'Token Flow Co',
      visibility: 'minimal',
      ...overrides
    }
  };
}

describe('enterprise api', () => {
  beforeEach(() => {
    admin.__reset();
  });

  test('create listing success and validation failure', async () => {
    const invalidRes = await request(app)
      .post('/enterprise/listings/create')
      .send({ data: { venueId: 'v1' } });
    expect(invalidRes.status).toBe(400);
    expect(invalidRes.body.code).toBe('VALIDATION_CREATE_LISTING_FAILED');

    const okRes = await request(app)
      .post('/enterprise/listings/create')
      .send(makeCreatePayload());
    expect(okRes.status).toBe(200);
    expect(okRes.body.code).toBe('CREATE_LISTING_SUCCESS');
    expect(okRes.body.listingId).toBeTruthy();
    expect(okRes.body.token).toBeTruthy();
  });

  test('enforces unverified daily limit', async () => {
    const enterpriseKey = 'alias:token flow co';
    const now = new Date();

    for (let i = 0; i < 5; i += 1) {
      admin.__seed('listings', `existing_${i}`, {
        enterpriseKey,
        createdAt: now,
        status: 'active'
      });
    }

    const res = await request(app)
      .post('/enterprise/listings/create')
      .send(makeCreatePayload({ displayNameOptional: 'Token Flow Co' }));

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('UNVERIFIED_DAILY_LIMIT_REACHED');
  });

  test('validate/update/rotate/revoke token flow', async () => {
    const created = await request(app)
      .post('/enterprise/listings/create')
      .send(makeCreatePayload());

    const listingId = created.body.listingId;
    const token = created.body.token;

    const valid = await request(app)
      .post(`/enterprise/listings/${listingId}/validate-token`)
      .send({ token });
    expect(valid.status).toBe(200);
    expect(valid.body.code).toBe('VALIDATE_TOKEN_SUCCESS');

    const updateDenied = await request(app)
      .post(`/enterprise/listings/${listingId}/update`)
      .send({ token: 'bad_token', data: { description: 'x' } });
    expect(updateDenied.status).toBe(403);
    expect(updateDenied.body.code).toBe('UPDATE_LISTING_FORBIDDEN');

    const rotate = await request(app)
      .post(`/enterprise/listings/${listingId}/rotate-token`)
      .send({ token });
    expect(rotate.status).toBe(200);
    expect(rotate.body.code).toBe('ROTATE_TOKEN_SUCCESS');
    expect(rotate.body.token).toBeTruthy();
    expect(rotate.body.token).not.toBe(token);

    const oldTokenRejected = await request(app)
      .post(`/enterprise/listings/${listingId}/validate-token`)
      .send({ token });
    expect(oldTokenRejected.status).toBe(403);

    const newToken = rotate.body.token;
    const newTokenValid = await request(app)
      .post(`/enterprise/listings/${listingId}/validate-token`)
      .send({ token: newToken });
    expect(newTokenValid.status).toBe(200);

    const revoke = await request(app)
      .post(`/enterprise/listings/${listingId}/revoke-token`)
      .send({ token: newToken });
    expect(revoke.status).toBe(200);
    expect(revoke.body.code).toBe('REVOKE_TOKEN_SUCCESS');

    const afterRevoke = await request(app)
      .post(`/enterprise/listings/${listingId}/validate-token`)
      .send({ token: newToken });
    expect(afterRevoke.status).toBe(403);
    expect(afterRevoke.body.code).toBe('VALIDATE_TOKEN_FAILED');
  });

  test('confirm pickup transitions reservation to completed', async () => {
    const created = await request(app)
      .post('/enterprise/listings/create')
      .send(makeCreatePayload({ quantityTotal: 1 }));

    const listingId = created.body.listingId;
    const token = created.body.token;

    const reserve = await request(app)
      .post(`/recipient/listings/${listingId}/reserve`)
      .send({
        claimerUid: 'user_confirm_1',
        qty: 1,
        disclaimerAccepted: true,
        idempotencyKey: 'idem_confirm_1'
      });

    const reservationId = reserve.body.reservation.id;
    const pickupCode = reserve.body.reservation.pickupCode;

    const confirm = await request(app)
      .post(`/enterprise/listings/${listingId}/confirm-pickup`)
      .send({ token, reservationId, pickupCode });

    expect(confirm.status).toBe(200);
    expect(confirm.body.code).toBe('CONFIRM_PICKUP_SUCCESS');

    const reservations = admin.__dump('reservations');
    const savedReservation = reservations.find((x) => x.id === reservationId);
    expect(savedReservation.data.status).toBe('completed');
  });
});
