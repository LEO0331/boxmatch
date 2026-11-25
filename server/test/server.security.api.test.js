jest.mock('firebase-admin', () => require('./firebaseAdminMock'));

const request = require('supertest');
const admin = require('firebase-admin');

// Exercise the deployed token-only policy without changing legacy-mode fixtures.
const previousTokenPolicy = process.env.REQUIRE_ID_TOKEN;
const previousCorsOrigins = process.env.CORS_ALLOWED_ORIGINS;
process.env.REQUIRE_ID_TOKEN = 'true';
process.env.CORS_ALLOWED_ORIGINS = 'https://leo0331.github.io';
const { app, __test } = require('../index');
if (previousTokenPolicy === undefined) delete process.env.REQUIRE_ID_TOKEN;
else process.env.REQUIRE_ID_TOKEN = previousTokenPolicy;
if (previousCorsOrigins === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
else process.env.CORS_ALLOWED_ORIGINS = previousCorsOrigins;

describe('production security regression tests', () => {
  beforeEach(() => admin.__reset());
  afterEach(() => jest.restoreAllMocks());

  test.each([
    { toString: null, valueOf: null },
    { toString: 'not callable' },
    [],
    123,
    true
  ])('rejects non-string claimerUid before authentication without crashing (%j)', async (claimerUid) => {
    const response = await request(app)
      .post('/recipient/reservations/list')
      .send({ claimerUid });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_CLAIMER_UID_INVALID');
    expect(admin.__dump('reservations')).toEqual([]);

    const healthy = await request(app).get('/health');
    expect(healthy.status).toBe(200);
  });

  test('missing bearer token cannot read or cancel another recipient reservation', async () => {
    admin.__seed('reservations', 'reservation_secret', {
      claimerUid: 'victim', listingId: 'listing_1', pickupCode: '1234',
      qty: 1, status: 'reserved', createdAt: new Date()
    });

    const list = await request(app)
      .post('/recipient/reservations/list')
      .send({ claimerUid: 'victim' });
    expect(list.status).toBe(401);
    expect(list.body.code).toBe('AUTH_ID_TOKEN_REQUIRED');
    expect(list.body).not.toHaveProperty('reservations');

    const cancel = await request(app)
      .post('/recipient/reservations/reservation_secret/cancel')
      .send({ claimerUid: 'victim' });
    expect(cancel.status).toBe(401);
    expect(admin.__dump('reservations')[0].data.status).toBe('reserved');
  });

  test('verified ID token determines identity; claimed body UID cannot override it', async () => {
    admin.__seed('reservations', 'reservation_secret', {
      claimerUid: 'victim', listingId: 'listing_1', pickupCode: '1234',
      qty: 1, status: 'reserved', createdAt: new Date()
    });

    const spoofed = await request(app)
      .post('/recipient/reservations/list')
      .set('Authorization', 'Bearer valid:attacker')
      .send({ claimerUid: 'victim' });
    expect(spoofed.status).toBe(400);
    expect(spoofed.body.code).toBe('AUTH_UID_MISMATCH');

    const caller = await request(app)
      .post('/recipient/reservations/list')
      .set('Authorization', 'Bearer valid:attacker')
      .send({});
    expect(caller.status).toBe(200);
    expect(caller.body.reservations).toEqual([]);
  });

  test('production policy defaults secure and ignores malformed opt-out settings', () => {
    expect(__test.recipientIdTokenRequired({ NODE_ENV: 'production' })).toBe(true);
    expect(__test.recipientIdTokenRequired({ NODE_ENV: 'production', REQUIRE_ID_TOKEN: 'typo' })).toBe(true);
    expect(__test.recipientIdTokenRequired({ NODE_ENV: 'production', REQUIRE_ID_TOKEN: 'false' })).toBe(false);
    expect(__test.recipientIdTokenRequired({ NODE_ENV: 'test' })).toBe(false);
  });

  test('CORS only grants configured browser origin; native requests need no Origin', async () => {
    const trusted = await request(app).get('/health').set('Origin', 'https://leo0331.github.io');
    expect(trusted.headers['access-control-allow-origin']).toBe('https://leo0331.github.io');

    const untrusted = await request(app).get('/health').set('Origin', 'https://attacker.example');
    expect(untrusted.headers['access-control-allow-origin']).toBeUndefined();

    expect(__test.isAllowedCorsOrigin(undefined, ['https://leo0331.github.io'])).toBe(true);
    expect(__test.isAllowedCorsOrigin('https://attacker.example', ['https://leo0331.github.io'])).toBe(false);
  });

  test('never logs query-string tokens or user-controlled path text', async () => {
    const logs = jest.spyOn(console, 'log').mockImplementation(() => {});
    await request(app).get('/health?token=SECRET_QUERY_TOKEN');
    await request(app).get('/not-found/SECRET_PATH_TOKEN');
    const serialized = logs.mock.calls.flat().join(' ');
    expect(serialized).not.toContain('SECRET_QUERY_TOKEN');
    expect(serialized).not.toContain('SECRET_PATH_TOKEN');
    expect(serialized).toContain('"path":"/health"');
  });

  test('runtime database failures do not expose backend details in response or logs', async () => {
    jest.spyOn(admin.firestore(), 'runTransaction').mockRejectedValueOnce(
      new Error('INTERNAL_FIRESTORE_CREDENTIAL_SECRET')
    );
    const logs = jest.spyOn(console, 'error').mockImplementation(() => {});
    const response = await request(app)
      .post('/recipient/listings/listing_1/reserve')
      .set('Authorization', 'Bearer valid:attacker')
      .send({ qty: 1, disclaimerAccepted: true, idempotencyKey: 'request-1' });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Internal server error.');
    expect(JSON.stringify(response.body)).not.toContain('INTERNAL_FIRESTORE_CREDENTIAL_SECRET');
    expect(logs.mock.calls.flat().join(' ')).not.toContain('INTERNAL_FIRESTORE_CREDENTIAL_SECRET');
  });

  test('invalid edit tokens and oversized abuse reports fail before database writes', async () => {
    const edit = await request(app)
      .post('/enterprise/listings/missing/validate-token')
      .send({ token: { untrusted: true } });
    expect(edit.status).toBe(400);

    const report = await request(app)
      .post('/recipient/listings/listing_1/report-abuse')
      .set('Authorization', 'Bearer valid:attacker')
      .send({ reason: 'x'.repeat(241) });
    expect(report.status).toBe(400);
    expect(report.body.code).toBe('VALIDATION_ABUSE_REPORT_INVALID');
    expect(admin.__dump('abuse_signals')).toEqual([]);
  });

  test('IP fallback does not trust a caller-supplied forwarding header', () => {
    expect(__test.resolveClientIp({
      ip: '192.0.2.10',
      headers: { 'x-forwarded-for': '203.0.113.99' }
    })).toBe('192.0.2.10');
  });
});
