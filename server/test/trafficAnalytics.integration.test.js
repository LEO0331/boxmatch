const request = require('supertest');

const view = { schemaVersion: 1, eventType: 'page_view', page: 'home', referrerDomain: 'google.com' };
const browser = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';

function loadApp(flags = {}, { analyticsFailure, geoLookup, verificationCheck } = {}) {
  jest.resetModules();
  jest.doMock('firebase-admin', () => require('./firebaseAdminMock'));
  for (const module of ['trafficAnalytics', 'geoResolver', 'botVerifier', 'trafficPersistence']) {
    jest.dontMock(`../observability/${module}`);
  }
  if (geoLookup) jest.doMock('../observability/geoResolver', () => ({
    createGeoResolver: () => ({ lookup: geoLookup, close() {} })
  }));
  if (verificationCheck) jest.doMock('../observability/botVerifier', () => ({
    createBotVerifier: () => ({ check: verificationCheck, close() {} })
  }));
  if (analyticsFailure) jest.doMock('../observability/trafficAnalytics', () => {
    const actual = jest.requireActual('../observability/trafficAnalytics');
    const fail = () => { throw new Error('ANALYTICS_PRIVATE_ERROR'); };
    return { ...actual, createTrafficAnalytics: analyticsFailure === 'initialization' ? fail : () => ({
      recordApi: fail, acceptVisit: fail, start() {}, shutdown: async () => {},
      flush: async () => { throw new Error('ANALYTICS_PRIVATE_ERROR'); },
      geoResolver: { lookup: fail, close() {} }
    }) };
  });
  const values = {
    ENABLE_REQUEST_INTELLIGENCE: 'true', ENABLE_BOT_VERIFICATION: 'false',
    ENABLE_FRONTEND_TELEMETRY: 'true', ENABLE_TRAFFIC_AGGREGATION: 'true', ENABLE_GEO_ENRICHMENT: 'false',
    REQUEST_IP_HMAC_SECRET: 'integration-test-hmac-secret-at-least-32-bytes',
    REQUIRE_ID_TOKEN: 'true', TRUST_PROXY_CIDRS: '', CORS_ALLOWED_ORIGINS: 'https://leo0331.github.io', ...flags
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return { ...require('../index'), admin: require('firebase-admin') };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function events(name) {
  return [...console.log.mock.calls, ...console.error.mock.calls].flat()
    .filter((value) => typeof value === 'string' && value.startsWith('{'))
    .map((value) => JSON.parse(value)).filter((entry) => !name || entry.event === name);
}

async function businessFlow(app) {
  const now = Date.now();
  const created = await request(app).post('/enterprise/listings/create').send({ data: {
    venueId: 'venue-1', pickupPointText: 'Booth A1', itemType: 'Lunchbox',
    description: 'Surplus meals', quantityTotal: 2, visibility: 'minimal',
    pickupStartAt: new Date(now + 30 * 60000).toISOString(),
    pickupEndAt: new Date(now + 90 * 60000).toISOString(),
    expiresAt: new Date(now + 150 * 60000).toISOString()
  } });
  expect(created.status).toBe(200);
  const { listingId, token } = created.body;
  const reserve = (idempotencyKey) => request(app).post(`/recipient/listings/${listingId}/reserve`)
    .set('Authorization', 'Bearer valid:recipient-1').send({ qty: 1, disclaimerAccepted: true, idempotencyKey });
  const first = await reserve('cancel-first');
  expect(first.status).toBe(200);
  const cancelled = await request(app).post(`/recipient/reservations/${first.body.reservation.id}/cancel`)
    .set('Authorization', 'Bearer valid:recipient-1').send({});
  expect(cancelled.status).toBe(200);
  const second = await reserve('confirm-second');
  expect(second.status).toBe(200);
  const confirmed = await request(app).post(`/enterprise/listings/${listingId}/confirm-pickup`)
    .send({ token, reservationId: second.body.reservation.id, pickupCode: second.body.reservation.pickupCode });
  expect(confirmed.status).toBe(200);
}

describe('Phase 2 API integration and operational isolation', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('one website view and three API calls keep separate denominators without request-level writes', async () => {
    const { app, admin, __test } = loadApp();
    const transaction = jest.spyOn(admin.firestore(), 'runTransaction');
    expect((await request(app).post('/telemetry/visit').set('Origin', 'https://leo0331.github.io')
      .set('User-Agent', browser).send(view)).status).toBe(204);
    expect((await request(app).get('/api-unknown-one').set('User-Agent', browser)).status).toBe(404);
    expect((await request(app).post('/recipient/reservations/list').send({})).status).toBe(401);
    expect((await request(app).get('/api-unknown-two')).status).toBe(404);
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).options('/recipient/reservations/list')
      .set('Origin', 'https://leo0331.github.io').set('Access-Control-Request-Method', 'POST')).status).toBe(204);
    expect(transaction).not.toHaveBeenCalled();
    expect(admin.__dump('traffic_daily')).toEqual([]);
    await __test.trafficAnalytics.flush({ force: true });
    const daily = admin.__dump('traffic_daily');
    expect(daily).toHaveLength(1);
    expect(daily[0].data.api).toMatchObject({ totalRequests: 3, success: 0, clientErrors: 3, serverErrors: 0 });
    expect(daily[0].data.website).toMatchObject({ pageViews: 1, channels: { organic_search: 1 }, pages: { home: 1 } });
    expect(daily[0].data.website.browsers.Chrome).toBe(1);
    expect(daily[0].data.website.operatingSystems.Windows).toBe(1);
    expect(events('traffic.visit.accepted')).toHaveLength(1);
    expect(events('http.request.completed')).toHaveLength(6);
  });

  test('HTTP origin attribution stays separate from user-supplied website acquisition', async () => {
    const { app } = loadApp();
    const response = await request(app).post('/telemetry/visit').set('Origin', 'https://leo0331.github.io')
      .set('User-Agent', browser).send(view);
    expect(response.status).toBe(204);
    expect(events('http.request.completed')[0].source)
      .toMatchObject({ originDomain: 'leo0331.github.io', referrerDomain: null, channel: 'external_referral' });
    expect(events('traffic.visit.accepted')[0])
      .toMatchObject({ referrerDomain: 'google.com', acquisitionChannel: 'organic_search' });
  });

  test('invalid and oversized telemetry never trigger bot verification, geo enrichment, or API counting', async () => {
    const geoLookup = jest.fn(() => ({ geoStatus: 'unavailable' }));
    const verificationCheck = jest.fn(() => 'unverified');
    const { app, admin, __test } = loadApp({ ENABLE_GEO_ENRICHMENT: 'true', ENABLE_BOT_VERIFICATION: 'true' }, { geoLookup, verificationCheck });
    for (const payload of [{ ...view, rawUrl: '/listing/PRIVATE' }, { ...view, secret: 'x'.repeat(3000) }]) {
      const response = await request(app).post('/telemetry/visit').set('User-Agent', 'GPTBot/1.0').send(payload);
      expect([400, 413]).toContain(response.status);
    }
    expect(geoLookup).not.toHaveBeenCalled();
    expect(verificationCheck).not.toHaveBeenCalled();
    await __test.trafficAnalytics.flush({ force: true });
    expect(admin.__dump('traffic_daily')).toEqual([]);
    expect(events('traffic.visit.accepted')).toEqual([]);
  });

  test('untrusted forwarding cannot fabricate geographic origin and accepted views expose no identifiers', async () => {
    const { app, admin, __test } = loadApp({ ENABLE_GEO_ENRICHMENT: 'true' });
    const response = await request(app).post('/telemetry/visit?token=PRIVATE_QUERY')
      .set('X-Forwarded-For', '8.8.8.8').set('Authorization', 'Bearer PRIVATE_TOKEN')
      .set('User-Agent', `${browser} PRIVATE_UA`).set('Cookie', 'visitor=PRIVATE_COOKIE')
      .send({ ...view, campaignSource: 'PRIVATE_CAMPAIGN', campaignMedium: 'PRIVATE_MEDIUM' });
    expect(response.status).toBe(204);
    const accepted = events('traffic.visit.accepted')[0];
    expect(accepted.network).toMatchObject({ identityConfidence: 'proxy', geoStatus: 'unavailable' });
    expect(accepted).toMatchObject({ campaignSource: 'other', campaignMedium: 'other' });
    expect(JSON.stringify(events())).not.toMatch(/PRIVATE_|8\.8\.8\.8|127\.0\.0\.1|::ffff|Mozilla/);
    await __test.trafficAnalytics.flush({ force: true });
    expect(JSON.stringify(admin.__dump('traffic_daily'))).not.toMatch(/PRIVATE_|8\.8\.8\.8|ipFingerprint|claimerUid|visitor|requestId/);
  });

  test('Phase 2 flags off preserve Phase 1 event shape and require no analytics database activity', async () => {
    const { app, admin, __test } = loadApp({ ENABLE_FRONTEND_TELEMETRY: 'false',
      ENABLE_TRAFFIC_AGGREGATION: 'false', ENABLE_GEO_ENRICHMENT: 'false' });
    const transaction = jest.spyOn(admin.firestore(), 'runTransaction');
    expect((await request(app).get('/health').set('User-Agent', browser)).status).toBe(200);
    const event = events('http.request.completed')[0];
    expect(event).toHaveProperty('security.classification', 'likely_human');
    expect(event.network).not.toHaveProperty('geoStatus');
    expect((await request(app).post('/telemetry/visit').send(view)).status).toBe(404);
    await __test.trafficAnalytics.flush({ force: true });
    expect(transaction).not.toHaveBeenCalled();
    expect(admin.__dump('traffic_daily')).toEqual([]);
    expect(events('traffic.visit.accepted')).toEqual([]);
  });

  test('Phase 2 without Phase 1 still counts API status and sanitizes malformed-body errors', async () => {
    const { app, admin, __test } = loadApp({ ENABLE_REQUEST_INTELLIGENCE: 'false' });
    const malformed = await request(app).post('/enterprise/listings/create?token=PRIVATE_QUERY')
      .type('json').send('{"token":"PRIVATE_BODY",invalid');
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('REQUEST_BODY_INVALID');
    expect((await request(app).get('/PRIVATE_PATH?token=PRIVATE_QUERY')).status).toBe(404);
    expect(JSON.stringify(events())).not.toMatch(/PRIVATE_|SyntaxError|stack/);
    await __test.trafficAnalytics.flush({ force: true });
    expect(admin.__dump('traffic_daily')[0].data.api.totalRequests).toBe(2);
  });

  test.each([false, true])('namespace probes retain Phase 1 scoring when telemetry acceptance is %s', async (enabled) => {
    const { app, admin, __test } = loadApp({
      ENABLE_FRONTEND_TELEMETRY: String(enabled), ENABLE_TRAFFIC_AGGREGATION: String(enabled),
      ENABLE_GEO_ENRICHMENT: 'false'
    });
    expect((await request(app).get('/telemetry/.env')).status).toBe(404);
    const event = events('http.request.completed')[0];
    expect(event.security.riskScore).toBe(35);
    expect(event.security.signals).toContain('SUSPICIOUS_PATH');
    expect(event.security.classification).toBe('suspected_security_scanner');
    await __test.trafficAnalytics.flush({ force: true });
    if (enabled) expect(admin.__dump('traffic_daily')[0].data.api.totalRequests).toBe(1);
    else expect(admin.__dump('traffic_daily')).toEqual([]);
  });

  test.each(['initialization', 'recording'])('analytics %s failure preserves complete business workflows', async (analyticsFailure) => {
    const { app, __test } = loadApp({ ENABLE_GEO_ENRICHMENT: 'true' }, { analyticsFailure });
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).post('/telemetry/visit').send(view)).status).toBe(204);
    if (analyticsFailure === 'recording') await expect(__test.trafficAnalytics.flush({ force: true })).rejects.toThrow();
    await businessFlow(app);
    expect(JSON.stringify(events())).not.toContain('ANALYTICS_PRIVATE_ERROR');
  });
});
