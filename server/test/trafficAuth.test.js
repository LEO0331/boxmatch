const express = require('express');
const request = require('supertest');
const { createTrafficAuth } = require('../admin/trafficAuth');

const administrator = { uid: 'private-admin-uid', trafficAdmin: true,
  firebase: { sign_in_provider: 'google.com' } };

function setup(config = {}, dependencies = {}) {
  const auth = { verifyIdToken: jest.fn(async () => administrator) };
  const logEvent = jest.fn();
  const app = express();
  app.use(createTrafficAuth(config, { auth, logEvent, ...dependencies }));
  app.use((req, res) => res.json({ ok: true }));
  return { app, auth, logEvent };
}

test.each([undefined, '', 'Basic secret', 'Bearer', 'Bearer token extra', ['Bearer a', 'Bearer b'], 'Bearer ' + 'x'.repeat(8200)])(
  'missing or malformed authorization is rejected without SDK work: %j', async (value) => {
    const { app, auth } = setup();
    const call = request(app).get('/');
    if (value !== undefined) call.set('Authorization', value);
    expect((await call).status).toBe(401);
    expect(auth.verifyIdToken).not.toHaveBeenCalled();
  }
);

test('the SDK verifies revocation on every token and only the signed claim authorizes', async () => {
  const { app, auth, logEvent } = setup();
  const response = await request(app).get('/').set('Authorization', 'Bearer signed-token');
  expect(response.status).toBe(200);
  expect(auth.verifyIdToken).toHaveBeenCalledWith('signed-token', true);
  expect(response.body).toEqual({ ok: true });
  expect(JSON.stringify(logEvent.mock.calls)).not.toMatch(/signed-token|private-admin-uid/);
});

test.each([
  { ...administrator, trafficAdmin: false }, { ...administrator, trafficAdmin: 'true' },
  { ...administrator, trafficAdmin: 1 }, { ...administrator, trafficAdmin: undefined },
  { ...administrator, firebase: { sign_in_provider: 'anonymous' } },
  { ...administrator, firebase: {} }, { ...administrator, firebase: undefined },
  { ...administrator, uid: '' }, { ...administrator, uid: null }
])('authenticated but unprivileged/anonymous identities are forbidden: %j', async (decoded) => {
  const { app, auth } = setup();
  auth.verifyIdToken.mockResolvedValue(decoded);
  const response = await request(app).get('/?uid=private-admin-uid&trafficAdmin=true')
    .set('Authorization', 'Bearer signed-token');
  expect(response.status).toBe(403);
  expect(response.body.code).toBe('TRAFFIC_ADMIN_FORBIDDEN');
});

test.each(['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired',
  'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found', 'auth/tenant-id-mismatch'])
('invalid, expired, revoked, disabled, or wrong-project tokens reject as 401: %s', async (code) => {
  const { app, auth, logEvent } = setup();
  auth.verifyIdToken.mockRejectedValue(Object.assign(new Error('PRIVATE_SDK_DETAIL'), { code }));
  const response = await request(app).get('/').set('Authorization', 'Bearer PRIVATE_TOKEN');
  expect(response.status).toBe(401);
  expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
  expect(JSON.stringify(logEvent.mock.calls)).not.toContain('PRIVATE');
});

test('provider failures fail closed without exposing exceptions', async () => {
  const { app, auth } = setup();
  auth.verifyIdToken.mockRejectedValue(Object.assign(new Error('PRIVATE_CREDENTIAL_PATH'), { code: 'auth/internal-error' }));
  const response = await request(app).get('/').set('Authorization', 'Bearer token');
  expect(response.status).toBe(503);
  expect(response.body.error).toBe('Authentication temporarily unavailable.');
});

test('per-admin and global budgets expire and are separate', async () => {
  let timestamp = 0;
  const { app, auth } = setup({ trafficAdminRateLimitPerMinute: 1,
    trafficAdminGlobalRateLimitPerMinute: 3 }, { now: () => timestamp });
  expect((await request(app).get('/').set('Authorization', 'Bearer one')).status).toBe(200);
  expect((await request(app).get('/').set('Authorization', 'Bearer two')).status).toBe(429);
  auth.verifyIdToken.mockResolvedValue({ ...administrator, uid: 'another-admin' });
  expect((await request(app).get('/').set('Authorization', 'Bearer three')).status).toBe(200);
  expect((await request(app).get('/').set('Authorization', 'Bearer four')).status).toBe(429);
  expect(auth.verifyIdToken).toHaveBeenCalledTimes(4);
  timestamp = 60000;
  expect((await request(app).get('/').set('Authorization', 'Bearer five')).status).toBe(200);
});

test('timed-out SDK calls retain concurrency slots until their underlying work settles', async () => {
  let finish;
  const verifyIdToken = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
  const { app } = setup({ trafficAdminAuthConcurrency: 1, trafficAdminAuthTimeoutMs: 50 },
    { auth: { verifyIdToken } });
  const timedOut = await request(app).get('/').set('Authorization', 'Bearer token');
  expect(timedOut.status).toBe(503);
  expect((await request(app).get('/').set('Authorization', 'Bearer token')).status).toBe(429);
  expect(verifyIdToken).toHaveBeenCalledTimes(1);
  finish(administrator);
  await new Promise((resolve) => setImmediate(resolve));
  verifyIdToken.mockResolvedValue(administrator);
  expect((await request(app).get('/').set('Authorization', 'Bearer token')).status).toBe(200);
});

test('broken security-log sinks cannot grant access or fail valid administrators', async () => {
  const { app } = setup({}, { logEvent: () => { throw new Error('log unavailable'); } });
  expect((await request(app).get('/')).status).toBe(401);
  expect((await request(app).get('/').set('Authorization', 'Bearer token')).status).toBe(200);
});

test('missing or invalid credentials cannot consume authenticated operation allowance', async () => {
  const { app, auth } = setup({ trafficAdminGlobalRateLimitPerMinute: 2 });
  for (let i = 0; i < 5; i++) expect((await request(app).get('/')).status).toBe(401);
  auth.verifyIdToken.mockRejectedValueOnce(Object.assign(new Error('invalid'), { code: 'auth/invalid-id-token' }));
  expect((await request(app).get('/').set('Authorization', 'Bearer invalid')).status).toBe(401);
  for (let i = 0; i < 2; i++) expect((await request(app).get('/').set('Authorization', 'Bearer valid')).status).toBe(200);
  expect((await request(app).get('/').set('Authorization', 'Bearer valid')).body.code).toBe('TRAFFIC_ADMIN_GLOBAL_LIMIT');
});

test('untrusted bearer verification work has its own bounded admission window', async () => {
  const { app, auth } = setup({ trafficAdminGlobalRateLimitPerMinute: 1 });
  auth.verifyIdToken.mockRejectedValue(Object.assign(new Error('invalid'), { code: 'auth/invalid-id-token' }));
  for (let i = 0; i < 10; i++) expect((await request(app).get('/').set('Authorization', 'Bearer invalid')).status).toBe(401);
  expect((await request(app).get('/').set('Authorization', 'Bearer invalid')).body.code).toBe('TRAFFIC_ADMIN_VERIFICATION_LIMIT');
  expect(auth.verifyIdToken).toHaveBeenCalledTimes(10);
});
