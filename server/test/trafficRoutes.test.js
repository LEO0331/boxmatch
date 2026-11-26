const express = require('express');
const request = require('supertest');
const { createTrafficRoutes, snapshotCsv } = require('../admin/trafficRoutes');

const administrator = { uid: 'PRIVATE_UID', trafficAdmin: true, firebase: { sign_in_provider: 'password' } };
const overview = { schemaVersion: 1, period: { startDate: '2026-11-20', endDate: '2026-11-26', timezone: 'UTC' },
  coverage: { requestedDays: 7, availableDays: 1, missingDays: 6 }, summary: { websitePageViews: 4 } };
const snapshot = { overview, days: [
  { date: '2026-11-20', status: 'available', data: { api: { totalRequests: 2 }, website: { pageViews: 4 }, uid: 'PRIVATE_STORED_UID' } },
  { date: '2026-11-21', status: 'missing', data: null }
] };

function setup(config = {}, dependencies = {}) {
  const queryService = { normalizeQuery: jest.fn(() => ({})),
    getOverview: jest.fn(async () => overview), getSnapshot: jest.fn(async () => snapshot) };
  const auth = { verifyIdToken: jest.fn(async () => administrator) };
  const logEvent = jest.fn();
  const observed = [];
  const app = express();
  app.use((req, res, next) => { res.on('finish', () => observed.push(Boolean(res.locals.trafficAdminOperation))); next(); });
  app.use('/admin/traffic', createTrafficRoutes({ enableTrafficAdmin: true, ...config },
    { queryService, auth, logEvent, ...dependencies }));
  return { app, queryService, auth, logEvent, observed };
}

test('disabled admin API is unavailable without authentication or data work', async () => {
  const { app, auth, queryService } = setup({ enableTrafficAdmin: false });
  const response = await request(app).get('/admin/traffic/overview');
  expect(response.status).toBe(404);
  expect(auth.verifyIdToken).not.toHaveBeenCalled();
  expect(queryService.getOverview).not.toHaveBeenCalled();
  expect(response.headers['cache-control']).toContain('no-store');
});

test('overview authenticates every request before cache/service access', async () => {
  const { app, auth, queryService, observed } = setup();
  const allowed = await request(app).get('/admin/traffic/overview?days=7').set('Authorization', 'Bearer PRIVATE_TOKEN');
  expect(allowed.status).toBe(200);
  expect(allowed.body).toEqual(overview);
  expect(allowed.headers['cache-control']).toBe('private, no-store, max-age=0');
  expect(allowed.headers.vary).toContain('Authorization');
  auth.verifyIdToken.mockResolvedValue({ ...administrator, trafficAdmin: false });
  const revoked = await request(app).get('/admin/traffic/overview?days=7').set('Authorization', 'Bearer PRIVATE_TOKEN');
  expect(revoked.status).toBe(403);
  expect(queryService.getOverview).toHaveBeenCalledTimes(1);
  expect(auth.verifyIdToken).toHaveBeenCalledTimes(2);
  expect(observed).toEqual([true, false]);
});

test('export is protected and uses one sanitized shared snapshot without extra overview reads', async () => {
  const { app, queryService, logEvent } = setup();
  expect((await request(app).get('/admin/traffic/export?days=7')).status).toBe(401);
  const response = await request(app).get('/admin/traffic/export?days=7').set('Authorization', 'Bearer PRIVATE_TOKEN');
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toContain('text/csv');
  expect(response.headers['content-disposition']).toBe('attachment; filename="traffic-2026-11-20-to-2026-11-26.csv"');
  expect(response.text).toContain('2026-11-21,,coverage,observation,,missing');
  expect(response.text).toContain('2026-11-20,website,totals,pageViews,4,available');
  expect(response.text).not.toContain('PRIVATE');
  expect(queryService.getSnapshot).toHaveBeenCalledTimes(1);
  expect(queryService.getOverview).not.toHaveBeenCalled();
  expect(JSON.stringify(logEvent.mock.calls)).not.toMatch(/PRIVATE_UID|PRIVATE_TOKEN/);
});

test('CSV escapes formulas and distinguishes unavailable dates from actual zeroes', () => {
  const csv = snapshotCsv({ days: [
    { date: '=HYPERLINK("PRIVATE")', status: 'missing', data: null },
    { date: '2026-11-21', status: 'available', data: { api: { totalRequests: 0 }, website: { pageViews: 0 } } }
  ] });
  expect(csv).toContain('"\'=HYPERLINK(""PRIVATE"")"');
  expect(csv).toContain('2026-11-21,website,totals,pageViews,0,available');
});

test('protected CSV refuses an oversized internal snapshot without sending a partial attachment', async () => {
  const { app, queryService } = setup();
  queryService.getSnapshot.mockResolvedValue({ overview,
    days: [{ date: 'x'.repeat(8 * 1024 * 1024), status: 'missing', data: null }] });
  const response = await request(app).get('/admin/traffic/export').set('Authorization', 'Bearer token');
  expect(response.status).toBe(503);
  expect(response.body.code).toBe('TRAFFIC_ADMIN_RESPONSE_TOO_LARGE');
  expect(response.headers['content-disposition']).toBeUndefined();
  expect(response.headers['cache-control']).toContain('no-store');
});

test.each([
  ['TRAFFIC_ADMIN_QUERY_INVALID', 400], ['TRAFFIC_ADMIN_READ_BUDGET_EXHAUSTED', 429],
  ['TRAFFIC_ADMIN_QUERY_CAPACITY', 429], ['TRAFFIC_ADMIN_QUERY_TIMEOUT', 503],
  ['TRAFFIC_ADMIN_RESPONSE_TOO_LARGE', 503],
  ['TRAFFIC_ADMIN_QUERY_UNAVAILABLE', 503], ['PRIVATE_UNKNOWN_ERROR', 503]
])('service failure %s returns safe status %d', async (code, status) => {
  const { app, queryService } = setup();
  queryService.getOverview.mockRejectedValue(Object.assign(new Error('PRIVATE_EXCEPTION'), { code }));
  const response = await request(app).get('/admin/traffic/overview').set('Authorization', 'Bearer token');
  expect(response.status).toBe(status);
  expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
});

test('malformed queries and unknown/method probes do not gain aggregate exclusions', async () => {
  const { app, queryService, observed } = setup();
  queryService.normalizeQuery.mockImplementation(() => { throw Object.assign(new Error('bad query'), { code: 'TRAFFIC_ADMIN_QUERY_INVALID' }); });
  expect((await request(app).get('/admin/traffic/overview?days[]=7').set('Authorization', 'Bearer token')).status).toBe(400);
  expect((await request(app).get('/admin/traffic/.env').set('Authorization', 'Bearer token')).status).toBe(404);
  expect((await request(app).post('/admin/traffic/overview').set('Authorization', 'Bearer token').send({ trafficAdmin: true })).status).toBe(405);
  expect((await request(app).options('/admin/traffic/overview')).status).toBe(204);
  expect(queryService.getOverview).not.toHaveBeenCalled();
  expect(observed).toEqual([false, false, false, false]);
});
