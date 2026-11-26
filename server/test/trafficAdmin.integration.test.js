const request = require('supertest');

function loadApp(flags = {}) {
  jest.resetModules();
  jest.doMock('firebase-admin', () => require('./firebaseAdminMock'));
  const values = {
    ENABLE_TRAFFIC_ADMIN: 'true', ENABLE_REQUEST_INTELLIGENCE: 'true',
    ENABLE_TRAFFIC_AGGREGATION: 'true', ENABLE_FRONTEND_TELEMETRY: 'false',
    ENABLE_GEO_ENRICHMENT: 'false', ENABLE_BOT_VERIFICATION: 'false',
    REQUIRE_ID_TOKEN: 'true', CORS_ALLOWED_ORIGINS: 'https://leo0331.github.io',
    TRAFFIC_ADMIN_RATE_LIMIT_PER_MINUTE: '30', ...flags
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    const api = require('../index');
    const admin = require('firebase-admin');
    const verify = jest.fn(async (token) => {
      if (token === 'admin-fixture') return { uid: 'PRIVATE_ADMIN_UID', trafficAdmin: true,
        firebase: { sign_in_provider: 'password' } };
      if (token === 'ordinary-fixture') return { uid: 'PRIVATE_RECIPIENT_UID',
        firebase: { sign_in_provider: 'password' } };
      if (token === 'anonymous-fixture') return { uid: 'PRIVATE_ANON_UID', trafficAdmin: true,
        firebase: { sign_in_provider: 'anonymous' } };
      throw Object.assign(new Error('PRIVATE_AUTH_ERROR'), { code: 'auth/id-token-revoked' });
    });
    admin.__setVerifyIdTokenImpl(verify);
    const day = new Date().toISOString().slice(0, 10);
    const data = require('../observability/trafficAggregator').emptyDaily(day);
    admin.__seed('traffic_daily', day, { ...data, updatedAt: new Date(),
      PRIVATE_FIELD: 'PRIVATE_SNAPSHOT_TOKEN', ownerUid: 'PRIVATE_OWNER_UID' });
    return { ...api, admin, verify };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

function events() {
  return [...console.log.mock.calls, ...console.error.mock.calls].flat()
    .filter((value) => typeof value === 'string' && value.startsWith('{'))
    .map((value) => JSON.parse(value));
}

describe('protected dashboard integration with existing observability', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('authorized cached overview/export reauthorize, avoid writes and preserve privacy', async () => {
    const { app, admin, verify } = loadApp();
    const transaction = jest.spyOn(admin.firestore(), 'runTransaction');
    const first = await request(app).get('/admin/traffic/overview?days=7')
      .set('Authorization', 'Bearer admin-fixture');
    expect(first.status).toBe(200);
    expect(first.body.coverage).toMatchObject({ requestedDays: 7, availableDays: 1, missingDays: 6 });
    expect(first.headers['cache-control']).toContain('no-store');
    expect(first.headers['x-robots-tag']).toContain('noindex');
    const exported = await request(app).get('/admin/traffic/export?days=7')
      .set('Authorization', 'Bearer admin-fixture');
    expect(exported.status).toBe(200);
    expect(exported.text).toContain('status');
    expect(exported.text).toContain('missing');
    expect(verify).toHaveBeenCalledTimes(2);
    for (const call of verify.mock.calls) expect(call[1]).toBe(true);
    expect(transaction).not.toHaveBeenCalled();
    const serialized = JSON.stringify([first.body, exported.text, events()]);
    expect(serialized).not.toMatch(/PRIVATE_|Bearer|admin-fixture/);
    expect(events().filter((event) => event.event === 'http.request.completed')).toHaveLength(2);
    expect(events().map((event) => event.event)).toContain('admin.traffic.export');
  });

  test('only authorized normalized operations are excluded from API aggregates', async () => {
    const { app, admin, __test } = loadApp();
    expect((await request(app).get('/admin/traffic/overview?days=7')
      .set('Authorization', 'Bearer admin-fixture')).status).toBe(200);
    expect((await request(app).get('/admin/traffic/overview')).status).toBe(401);
    expect((await request(app).get('/admin/traffic/overview?collection=reservations')
      .set('Authorization', 'Bearer admin-fixture')).status).toBe(400);
    expect((await request(app).get('/admin/traffic/.env')
      .set('Authorization', 'Bearer admin-fixture')).status).toBe(404);
    const completions = events().filter((event) => event.event === 'http.request.completed');
    expect(completions).toHaveLength(4);
    expect(completions[3].security.signals).toContain('SUSPICIOUS_PATH');
    await __test.trafficAnalytics.flush({ force: true });
    expect(admin.__dump('traffic_daily')[0].data.api.totalRequests).toBe(3);
  });

  test('revoked authentication cannot retrieve an already-cached snapshot', async () => {
    const { app, verify } = loadApp();
    expect((await request(app).get('/admin/traffic/overview')
      .set('Authorization', 'Bearer admin-fixture')).status).toBe(200);
    verify.mockRejectedValueOnce(Object.assign(new Error('PRIVATE_REVOKED_TOKEN'), { code: 'auth/id-token-revoked' }));
    const revoked = await request(app).get('/admin/traffic/overview')
      .set('Authorization', 'Bearer admin-fixture');
    expect(revoked.status).toBe(401);
    expect(revoked.body).not.toHaveProperty('summary');
    expect(JSON.stringify(events())).not.toContain('PRIVATE_');
  });

  test.each(['ordinary-fixture', 'anonymous-fixture'])('does not authorize %s', async (token) => {
    const { app } = loadApp();
    const response = await request(app).get('/admin/traffic/export').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
    expect(response.body).not.toHaveProperty('api');
  });

  test('claim grants no enterprise token privilege and leaves health and recipient auth unchanged', async () => {
    const { app } = loadApp();
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).post('/recipient/reservations/list').send({ claimerUid: 'victim' })).status).toBe(401);
    expect((await request(app).post('/enterprise/listings/missing/update')
      .set('Authorization', 'Bearer admin-fixture').send({ data: { description: 'Not allowed' } })).status).toBe(400);
  });

  test('disabled administration adds no authentication or analytics reads', async () => {
    const { app, admin, verify } = loadApp({ ENABLE_TRAFFIC_ADMIN: 'false', ENABLE_TRAFFIC_AGGREGATION: 'false' });
    const collection = jest.spyOn(admin.firestore(), 'collection');
    const response = await request(app).get('/admin/traffic/overview').set('Authorization', 'Bearer admin-fixture');
    expect(response.status).toBe(404);
    expect(verify).not.toHaveBeenCalled();
    expect(collection).not.toHaveBeenCalled();
    expect((await request(app).get('/health')).status).toBe(200);
  });
});
