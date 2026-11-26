const express = require('express');
const cors = require('cors');
const request = require('supertest');
const { createTelemetryMiddleware } = require('../observability/telemetryEndpoint');

const event = { schemaVersion: 1, eventType: 'page_view', page: 'home' };
const secret = 'test-only-telemetry-secret-at-least-32-bytes';
function setup(config = {}, dependencies = {}) {
  const onVisit = jest.fn();
  const app = express();
  let globalParserCalls = 0;
  const corsMiddleware = cors({ origin(origin, callback) {
    callback(null, !origin || origin === 'https://leo0331.github.io');
  } });
  app.use('/telemetry/visit', createTelemetryMiddleware({
    enableFrontendTelemetry: true, ipHmacSecret: secret, ...config
  }, { onVisit, corsMiddleware, ownHosts: ['leo0331.github.io'], ...dependencies }));
  app.use((req, res, next) => { globalParserCalls++; next(); });
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res) => res.sendStatus(404));
  return { app, onVisit, globalParserCalls: () => globalParserCalls };
}

test('valid unauthenticated visit accepts a sanitized semantic event with 204', async () => {
  const { app, onVisit } = setup();
  const response = await request(app).post('/telemetry/visit').set('Origin', 'https://leo0331.github.io')
    .send({ ...event, referrerDomain: 'google.com' });
  expect(response.status).toBe(204);
  expect(response.text).toBe('');
  expect(response.headers['access-control-allow-origin']).toBe('https://leo0331.github.io');
  expect(onVisit).toHaveBeenCalledTimes(1);
  expect(onVisit.mock.calls[0][0]).toMatchObject({ page: 'home', acquisitionChannel: 'organic_search', referrerDomain: 'google.com' });
});

test('Origin never replaces acquisition metadata or authenticates a fabricated visit', async () => {
  const { app, onVisit } = setup();
  const response = await request(app).post('/telemetry/visit').set('Origin', 'https://attacker.example')
    .send(event);
  expect(response.status).toBe(204);
  expect(response.headers['access-control-allow-origin']).toBeUndefined();
  expect(onVisit.mock.calls[0][0].acquisitionChannel).toBe('direct_or_unknown');
});

test('disabled endpoint, unintended methods, types and nested paths do not ingest', async () => {
  const disabled = setup({ enableFrontendTelemetry: false });
  expect((await request(disabled.app).post('/telemetry/visit').send(event)).status).toBe(404);
  const { app, onVisit } = setup();
  expect((await request(app).get('/telemetry/visit')).status).toBe(405);
  expect((await request(app).post('/telemetry/visit').type('text').send(JSON.stringify(event))).status).toBe(415);
  expect((await request(app).post('/telemetry/visit/extra').send(event)).status).toBe(404);
  expect(onVisit).not.toHaveBeenCalled();
  expect(disabled.onVisit).not.toHaveBeenCalled();
});

test('small body limit rejects before global JSON parsing or analytics work', async () => {
  const { app, onVisit, globalParserCalls } = setup();
  const oversized = await request(app).post('/telemetry/visit').send({ ...event, secret: 'x'.repeat(2050) });
  expect(oversized.status).toBe(413);
  const malformed = await request(app).post('/telemetry/visit').type('json').send('{"secret":"PRIVATE",invalid');
  expect(malformed.status).toBe(400);
  expect(malformed.text).toBe('');
  expect(globalParserCalls()).toBe(0);
  expect(onVisit).not.toHaveBeenCalled();
});

test('unknown fields and unsupported schema are rejected without exposing payloads', async () => {
  const { app, onVisit } = setup();
  for (const value of [{ ...event, token: 'PRIVATE' }, { ...event, schemaVersion: 2 }, []]) {
    const response = await request(app).post('/telemetry/visit').send(value);
    expect(response.status).toBe(400);
    expect(response.text).not.toContain('PRIVATE');
  }
  expect(onVisit).not.toHaveBeenCalled();
});

test('preflight does not consume ingestion budgets', async () => {
  const { app, onVisit } = setup({ telemetryRateLimitPerMinute: 1, telemetryGlobalRateLimitPerMinute: 1 });
  const preflight = await request(app).options('/telemetry/visit')
    .set('Origin', 'https://leo0331.github.io').set('Access-Control-Request-Method', 'POST');
  expect(preflight.status).toBe(204);
  expect((await request(app).post('/telemetry/visit').send(event)).status).toBe(204);
  expect(onVisit).toHaveBeenCalledTimes(1);
});

test('missing and unreliable identities share a conservative limit despite spoofed forwarding', async () => {
  let timestamp = 0;
  const { app, onVisit } = setup({ telemetryRateLimitPerMinute: 2 }, { now: () => timestamp });
  for (let i = 0; i < 2; i++) {
    expect((await request(app).post('/telemetry/visit').set('X-Forwarded-For', `8.8.8.${i + 1}`).send(event)).status).toBe(204);
  }
  expect((await request(app).post('/telemetry/visit').set('X-Forwarded-For', '1.1.1.1').send(event)).status).toBe(429);
  timestamp = 60000;
  expect((await request(app).post('/telemetry/visit').send(event)).status).toBe(204);
  expect(onVisit).toHaveBeenCalledTimes(3);
});

test('trusted identities are independently limited but global capacity is bounded', async () => {
  let key = 'a';
  const resolveNetworkIdentity = jest.fn(() => ({ identityConfidence: 'trusted', ipFingerprint: `hmac:${key.repeat(64)}` }));
  const { app, onVisit } = setup({ telemetryRateLimitPerMinute: 1, telemetryGlobalRateLimitPerMinute: 3 }, { resolveNetworkIdentity });
  expect((await request(app).post('/telemetry/visit').send(event)).status).toBe(204);
  expect((await request(app).post('/telemetry/visit').send(event)).status).toBe(429);
  key = 'b';
  expect((await request(app).post('/telemetry/visit').send(event)).status).toBe(204);
  key = 'c';
  expect((await request(app).post('/telemetry/visit').send(event)).status).toBe(429);
  expect(resolveNetworkIdentity).toHaveBeenCalledTimes(3);
  expect(onVisit).toHaveBeenCalledTimes(2);
});

test('identity-map capacity sheds new sources without retaining arbitrary keys', async () => {
  let key = 'a';
  const { app, onVisit } = setup({ intelligenceMaxEntries: 1 }, {
    resolveNetworkIdentity: () => ({ identityConfidence: 'trusted', ipFingerprint: `hmac:${key.repeat(64)}` })
  });
  expect((await request(app).post('/telemetry/visit').send(event)).status).toBe(204);
  key = 'b';
  expect((await request(app).post('/telemetry/visit').send(event)).status).toBe(429);
  expect(onVisit).toHaveBeenCalledTimes(1);
});

test.each(['synchronous', 'asynchronous'])('analytics %s failure never breaks accepted transport', async (kind) => {
  const { app } = setup({}, { onVisit: () => {
    if (kind === 'synchronous') throw new Error('PRIVATE_BACKEND_ERROR');
    return Promise.reject(new Error('PRIVATE_BACKEND_ERROR'));
  } });
  const response = await request(app).post('/telemetry/visit').send(event);
  expect(response.status).toBe(204);
  expect(response.text).toBe('');
});

test('resolver failure uses the shared unknown budget and no external work', async () => {
  const { app, onVisit } = setup({ telemetryRateLimitPerMinute: 1 }, {
    resolveNetworkIdentity: () => { throw new Error('PRIVATE_IP_RESOLUTION_ERROR'); }
  });
  expect((await request(app).post('/telemetry/visit').send(event)).status).toBe(204);
  expect((await request(app).post('/telemetry/visit').send(event)).status).toBe(429);
  expect(onVisit).toHaveBeenCalledTimes(1);
});
