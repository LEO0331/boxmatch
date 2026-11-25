const request = require('supertest');
const { EventEmitter } = require('node:events');

const browser = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';

function loadApp(overrides = {}, contextFactory) {
  jest.resetModules();
  jest.doMock('firebase-admin', () => require('./firebaseAdminMock'));
  jest.dontMock('../observability/requestContext');
  if (contextFactory) jest.doMock('../observability/requestContext', () => ({ createRequestIntelligence: contextFactory }));
  const values = {
    ENABLE_REQUEST_INTELLIGENCE: 'true', ENABLE_BOT_VERIFICATION: 'false',
    REQUEST_IP_HMAC_SECRET: 'test-only-hmac-key-with-at-least-32-bytes',
    REQUIRE_ID_TOKEN: 'true', TRUST_PROXY_CIDRS: '',
    CORS_ALLOWED_ORIGINS: 'https://app.example.com', ...overrides
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    const api = require('../index');
    return { ...api, admin: require('firebase-admin') };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function loggedEvents() {
  return [...console.log.mock.calls, ...console.error.mock.calls].flat()
    .filter((value) => typeof value === 'string' && value.startsWith('{'))
    .map((value) => JSON.parse(value));
}

function completions() {
  return loggedEvents().filter((entry) => entry.event === 'http.request.completed');
}

describe('request intelligence integration and privacy', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('normal browser requests enrich the existing completion event without a second log', async () => {
    const { app } = loadApp();
    const response = await request(app).get('/health').set('User-Agent', browser)
      .set('Referer', 'https://www.google.com/search?q=private-search');
    expect(response.status).toBe(200);
    const entries = completions();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      requestId: response.body.requestId, method: 'GET', path: '/health', status: 200,
      source: { referrerDomain: 'www.google.com', channel: 'search_referral' },
      client: { type: 'browser', browser: 'Chrome', os: 'Windows' },
      security: { classification: 'likely_human', riskScore: 0, signals: [] }
    });
    expect(entries[0].network.ipFingerprint).toMatch(/^hmac:[a-f0-9]{64}$/);
    expect(entries[0].ts).toEqual(expect.any(String));
    expect(entries[0].latencyMs).toEqual(expect.any(Number));
  });

  test('disabled intelligence preserves the existing event fields without enrichment', async () => {
    const { app } = loadApp({ ENABLE_REQUEST_INTELLIGENCE: 'false' });
    const response = await request(app).get('/health').set('User-Agent', browser);
    expect(response.status).toBe(200);
    expect(completions()).toHaveLength(1);
    expect(completions()[0]).toMatchObject({ path: '/health', status: 200, recipientAuthMode: null });
    for (const field of ['network', 'source', 'client', 'security']) {
      expect(completions()[0]).not.toHaveProperty(field);
    }
  });

  test('disabled intelligence retains the existing malformed-body response', async () => {
    const { app } = loadApp({ ENABLE_REQUEST_INTELLIGENCE: 'false' });
    const response = await request(app).post('/enterprise/listings/create')
      .set('Content-Type', 'application/json').send('{invalid');
    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toContain('text/html');
    expect(completions()).toHaveLength(1);
    expect(completions()[0]).not.toHaveProperty('security');
  });

  test('matched and unmatched route logs exclude sensitive request data and raw headers', async () => {
    const { app } = loadApp();
    const secrets = ['QUERY_SECRET', 'PATH_SECRET', 'TOKEN_SECRET', 'COOKIE_SECRET',
      'BODY_SECRET', 'PICKUP_SECRET', 'UA_SECRET', 'REFERRER_SECRET'];
    const missing = await request(app).post('/enterprise/listings/PATH_SECRET/validate-token?token=QUERY_SECRET')
      .set('Authorization', 'Bearer TOKEN_SECRET').set('Cookie', 'session=COOKIE_SECRET')
      .set('User-Agent', `${browser} UA_SECRET`)
      .set('Referer', 'https://www.google.com/REFERRER_SECRET?token=TOKEN_SECRET')
      .set('X-Forwarded-For', '8.8.4.4')
      .send({ token: 'BODY_SECRET', pickupCode: 'PICKUP_SECRET' });
    expect(missing.status).toBe(404);
    await request(app).get('/unmatched/PATH_SECRET?token=QUERY_SECRET').set('User-Agent', browser);
    const entries = completions();
    expect(entries).toHaveLength(2);
    expect(entries[0].path).toBe('/enterprise/listings/:listingId/validate-token');
    expect(entries[1].path).toBe('[pre-route-or-unmatched]');
    const text = JSON.stringify(loggedEvents());
    for (const secret of [...secrets, '8.8.4.4', '127.0.0.1', '::ffff:', 'Mozilla/5.0']) {
      expect(text).not.toContain(secret);
    }
  });

  test('malformed JSON returns a generic error and exactly one sanitized completion', async () => {
    const { app } = loadApp();
    const response = await request(app).post('/enterprise/listings/create?token=QUERY_SECRET')
      .set('Content-Type', 'application/json').send('{"token":"BODY_SECRET",invalid');
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('REQUEST_BODY_INVALID');
    expect(response.body.error).toBe('Invalid request body.');
    expect(completions()).toHaveLength(1);
    expect(completions()[0]).toMatchObject({ path: '[pre-route-or-unmatched]', status: 400 });
    expect(JSON.stringify(loggedEvents())).not.toMatch(/BODY_SECRET|QUERY_SECRET|SyntaxError|stack/);
  });

  test('CORS preflight is observed once and has no risk or behavioral signals', async () => {
    const { app } = loadApp();
    const response = await request(app).options('/recipient/listings/listing-1/reserve')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(completions()).toHaveLength(1);
    expect(completions()[0]).toMatchObject({
      method: 'OPTIONS', status: 204, security: { riskScore: 0, signals: [] }
    });
  });

  test('missing HMAC secret disables network correlation without weakening authentication', async () => {
    const { app } = loadApp({ REQUEST_IP_HMAC_SECRET: '' });
    const denied = await request(app).post('/recipient/reservations/list').send({ claimerUid: 'victim' });
    expect(denied.status).toBe(401);
    expect(denied.body.code).toBe('AUTH_ID_TOKEN_REQUIRED');
    expect(completions()[0].network.ipFingerprint).toBeNull();
    expect(completions()[0].security.signals).not.toContain('REPEATED_AUTH_FAILURE');
  });

  test('observation of auth failures, unknown routes, and health checks adds no Firestore writes', async () => {
    const { app, admin } = loadApp();
    const collection = jest.spyOn(admin.firestore(), 'collection');
    await request(app).get('/health');
    await request(app).get('/unknown');
    const response = await request(app).post('/recipient/reservations/list').send({ claimerUid: 'victim' });
    expect(response.status).toBe(401);
    expect(collection).not.toHaveBeenCalled();
    expect(admin.__dump('abuse_signals')).toEqual([]);
    expect(admin.__dump('security_budgets')).toEqual([]);
    expect(completions()).toHaveLength(3);
  });

  test('high heuristic risk does not change auth responses or the existing 300-request limit', async () => {
    const { app } = loadApp({ TRUST_PROXY_CIDRS: 'loopback', REQUEST_RISK_RATE_THRESHOLD: '1' });
    for (let i = 0; i < 300; i++) {
      const denied = await request(app).post('/recipient/reservations/list')
        .set('X-Forwarded-For', '8.8.8.8').send({ claimerUid: 'victim' });
      expect(denied.status).toBe(401);
    }
    const limited = await request(app).post('/recipient/reservations/list')
      .set('X-Forwarded-For', '8.8.8.8').send({ claimerUid: 'victim' });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('REQUEST_LIMIT_REACHED');
    expect(completions()).toHaveLength(301);
    expect(completions()[299].security.signals).toContain('HIGH_REQUEST_FREQUENCY');
    expect(completions()[299].security.signals).toContain('REPEATED_AUTH_FAILURE');
  });

  test('invalid enterprise credentials retain their existing 403 policy', async () => {
    const { app, admin } = loadApp();
    admin.__seed('listings', 'listing-1', { status: 'active' });
    admin.__seed('listing_private', 'listing-1', { editTokenHash: 'wrong-hash' });
    const denied = await request(app).post('/enterprise/listings/listing-1/validate-token')
      .send({ token: 'untrusted-token' });
    expect(denied.status).toBe(403);
    expect(completions()).toHaveLength(1);
    expect(completions()[0].status).toBe(403);
    // This is the pre-existing abuse mechanism, not a per-request telemetry write.
    expect(admin.__dump('abuse_signals')).toHaveLength(1);
  });

  test.each(['capture', 'completion', 'initialization'])('telemetry %s failures cannot break business operations', async (stage) => {
    const failure = () => { throw new Error('TELEMETRY_SECRET'); };
    const factory = stage === 'initialization' ? failure : () => ({
      capture: stage === 'capture' ? failure : () => failure
    });
    const { app } = loadApp({}, factory);
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
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
    const reserve = async (key) => request(app).post(`/recipient/listings/${listingId}/reserve`)
      .set('Authorization', 'Bearer valid:recipient-1')
      .send({ qty: 1, disclaimerAccepted: true, idempotencyKey: key });
    const first = await reserve('cancel-reservation');
    expect(first.status).toBe(200);
    const cancelled = await request(app).post(`/recipient/reservations/${first.body.reservation.id}/cancel`)
      .set('Authorization', 'Bearer valid:recipient-1').send({});
    expect(cancelled.status).toBe(200);
    const second = await reserve('confirm-reservation');
    expect(second.status).toBe(200);
    const confirmed = await request(app).post(`/enterprise/listings/${listingId}/confirm-pickup`)
      .send({ token, reservationId: second.body.reservation.id, pickupCode: second.body.reservation.pickupCode });
    expect(confirmed.status).toBe(200);
    expect(completions()).toHaveLength(6);
    expect(JSON.stringify(loggedEvents())).not.toContain('TELEMETRY_SECRET');
  });

  test('an aborted connection followed by finish emits only one completion event', () => {
    const { app } = loadApp();
    const response = new EventEmitter();
    Object.assign(response, { locals: {}, json: jest.fn(), statusCode: 200, writableFinished: false });
    const req = { method: 'GET', headers: {}, url: '/aborted?token=ABORT_SECRET',
      originalUrl: '/aborted?token=ABORT_SECRET', socket: { remoteAddress: '127.0.0.1' },
      ip: '127.0.0.1', app, protocol: 'http' };
    const lifecycle = app._router.stack.find((layer) => layer.handle.toString().includes('req.requestId = crypto.randomUUID'));
    expect(lifecycle).toBeDefined();
    const next = jest.fn();
    lifecycle.handle(req, response, next);
    expect(next).toHaveBeenCalledTimes(1);
    response.emit('close');
    response.writableFinished = true;
    response.emit('finish');
    expect(completions()).toHaveLength(1);
    expect(completions()[0]).toMatchObject({ status: 499, aborted: true });
    expect(JSON.stringify(loggedEvents())).not.toContain('ABORT_SECRET');
  });
});
