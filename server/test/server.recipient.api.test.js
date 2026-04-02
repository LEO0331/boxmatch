jest.mock('firebase-admin', () => require('./firebaseAdminMock'));

const request = require('supertest');
const admin = require('firebase-admin');
const { app } = require('../index');

function makeCreatePayload(overrides = {}) {
  const now = Date.now();
  return {
    data: {
      venueId: 'taipei-nangang-exhibition-center-hall-1',
      pickupPointText: 'Booth B2',
      itemType: 'Drink',
      description: 'Recipient flow listing',
      quantityTotal: 2,
      pickupStartAt: new Date(now + 30 * 60 * 1000).toISOString(),
      pickupEndAt: new Date(now + 90 * 60 * 1000).toISOString(),
      expiresAt: new Date(now + 150 * 60 * 1000).toISOString(),
      displayNameOptional: 'Recipient Flow Co',
      visibility: 'minimal',
      ...overrides
    }
  };
}

async function createListing(overrides = {}) {
  const created = await request(app)
    .post('/enterprise/listings/create')
    .send(makeCreatePayload(overrides));

  return {
    listingId: created.body.listingId,
    token: created.body.token
  };
}

describe('recipient api', () => {
  beforeEach(() => {
    admin.__reset();
  });

  test('reserve supports idempotency key replay', async () => {
    const { listingId } = await createListing({ quantityTotal: 2 });

    const payload = {
      claimerUid: 'recipient_1',
      qty: 1,
      disclaimerAccepted: true,
      idempotencyKey: 'idem_1'
    };

    const first = await request(app)
      .post(`/recipient/listings/${listingId}/reserve`)
      .send(payload);
    expect(first.status).toBe(200);
    expect(first.body.code).toBe('RESERVE_SUCCESS');

    const replay = await request(app)
      .post(`/recipient/listings/${listingId}/reserve`)
      .send(payload);
    expect(replay.status).toBe(200);
    expect(replay.body.code).toBe('RESERVE_SUCCESS_IDEMPOTENT_REPLAY');
    expect(replay.body.reservation.id).toBe(first.body.reservation.id);
  });

  test('reserve prevents overbooking', async () => {
    const { listingId } = await createListing({ quantityTotal: 1 });

    const first = await request(app)
      .post(`/recipient/listings/${listingId}/reserve`)
      .send({
        claimerUid: 'recipient_a',
        qty: 1,
        disclaimerAccepted: true,
        idempotencyKey: 'idem_a'
      });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/recipient/listings/${listingId}/reserve`)
      .send({
        claimerUid: 'recipient_b',
        qty: 1,
        disclaimerAccepted: true,
        idempotencyKey: 'idem_b'
      });

    expect(second.status).toBe(400);
    expect(second.body.code).toBe('RESERVE_FAILED_BUSINESS_RULE');
    expect(second.body.error).toBe('This listing is no longer available.');
  });

  test('reserve enforces recipient daily limit', async () => {
    const { listingId } = await createListing({ quantityTotal: 10 });
    const now = new Date();

    for (let i = 0; i < 5; i += 1) {
      admin.__seed('reservations', `existing_r_${i}`, {
        listingId,
        claimerUid: 'recipient_daily_limit',
        qty: 1,
        status: 'reserved',
        createdAt: now
      });
    }

    const res = await request(app)
      .post(`/recipient/listings/${listingId}/reserve`)
      .send({
        claimerUid: 'recipient_daily_limit',
        qty: 1,
        disclaimerAccepted: true,
        idempotencyKey: 'idem_limit'
      });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RECIPIENT_DAILY_LIMIT_REACHED');
  });

  test('cancel reservation success and idempotent replay', async () => {
    const { listingId } = await createListing({ quantityTotal: 2 });

    const reserve = await request(app)
      .post(`/recipient/listings/${listingId}/reserve`)
      .send({
        claimerUid: 'recipient_cancel_1',
        qty: 1,
        disclaimerAccepted: true,
        idempotencyKey: 'idem_cancel_1'
      });

    const reservationId = reserve.body.reservation.id;

    const cancel = await request(app)
      .post(`/recipient/reservations/${reservationId}/cancel`)
      .send({ claimerUid: 'recipient_cancel_1' });

    expect(cancel.status).toBe(200);
    expect(cancel.body.code).toBe('CANCEL_RESERVATION_SUCCESS');

    const cancelAgain = await request(app)
      .post(`/recipient/reservations/${reservationId}/cancel`)
      .send({ claimerUid: 'recipient_cancel_1' });

    expect(cancelAgain.status).toBe(200);
    expect(cancelAgain.body.code).toBe('CANCEL_RESERVATION_IDEMPOTENT');
  });

  test('list reservations only returns caller records', async () => {
    const { listingId } = await createListing({ quantityTotal: 3 });

    await request(app)
      .post(`/recipient/listings/${listingId}/reserve`)
      .send({
        claimerUid: 'recipient_list_me',
        qty: 1,
        disclaimerAccepted: true,
        idempotencyKey: 'idem_list_me'
      });

    await request(app)
      .post(`/recipient/listings/${listingId}/reserve`)
      .send({
        claimerUid: 'recipient_other',
        qty: 1,
        disclaimerAccepted: true,
        idempotencyKey: 'idem_list_other'
      });

    const list = await request(app)
      .post('/recipient/reservations/list')
      .send({ claimerUid: 'recipient_list_me' });

    expect(list.status).toBe(200);
    expect(list.body.code).toBe('LIST_RECIPIENT_RESERVATIONS_SUCCESS');
    expect(list.body.reservations).toHaveLength(1);
    expect(list.body.reservations[0].claimerUid).toBe('recipient_list_me');
  });

  test('auth middleware rejects uid mismatch between bearer token and claimerUid', async () => {
    const { listingId } = await createListing({ quantityTotal: 2 });

    const res = await request(app)
      .post(`/recipient/listings/${listingId}/reserve`)
      .set('Authorization', 'Bearer valid:uid_token_1')
      .send({
        claimerUid: 'uid_other',
        qty: 1,
        disclaimerAccepted: true,
        idempotencyKey: 'idem_uid_mismatch'
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AUTH_UID_MISMATCH');
  });

  test('legacy mode requires claimerUid', async () => {
    const { listingId } = await createListing({ quantityTotal: 2 });

    const res = await request(app)
      .post(`/recipient/listings/${listingId}/reserve`)
      .send({
        qty: 1,
        disclaimerAccepted: true,
        idempotencyKey: 'idem_missing_uid'
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_CLAIMER_UID_REQUIRED');
  });
});
