const express = require('express');
const { createTrafficAuth } = require('./trafficAuth');
const { safeCsvCell, dailyRows } = require('../../scripts/export_traffic_csv');
const MAX_EXPORT_BYTES = 8 * 1024 * 1024;

function snapshotCsv(snapshot) {
  const rows = [['dayKey', 'stream', 'dimension', 'key', 'count', 'status']];
  for (const day of snapshot.days) {
    if (day.status !== 'available' || !day.data) {
      rows.push([day.date, '', 'coverage', 'observation', '', day.status]);
    } else {
      for (const row of dailyRows(day.date, day.data)) rows.push([...row, 'available']);
    }
  }
  return `${rows.map((row) => row.map(safeCsvCell).join(',')).join('\n')}\n`;
}

function createTrafficRoutes(config = {}, { auth, queryService, logEvent = () => {}, now } = {}) {
  const router = express.Router();
  const authenticate = createTrafficAuth(config, { auth, logEvent, now });
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('X-Content-Type-Options', 'nosniff');
    res.vary('Authorization');
    if (!config.enableTrafficAdmin) return res.status(404).end();
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  router.use(authenticate);
  router.use(async (req, res) => {
    if (!['/overview', '/export'].includes(req.path)) return res.status(404).end();
    if (req.method !== 'GET') return res.set('Allow', 'GET, OPTIONS').status(405).end();
    try {
      // Normalize before declaring a recognized admin operation. Malformed
      // probes remain visible to ordinary API aggregate/security observation.
      queryService.normalizeQuery(req.query);
      res.locals.trafficAdminOperation = true;
      const exporting = req.path === '/export';
      const snapshot = exporting ? await queryService.getSnapshot(req.query) : null;
      const overview = snapshot ? snapshot.overview : await queryService.getOverview(req.query);
      try { logEvent('info', exporting ? 'admin.traffic.export' : 'admin.traffic.access', {
        requestId: req.requestId || null, days: overview.coverage.requestedDays
      }); } catch (_) { /* optional structured logging */ }
      if (!exporting) return res.json(overview);
      const csv = snapshotCsv(snapshot);
      if (Buffer.byteLength(csv, 'utf8') > MAX_EXPORT_BYTES) {
        throw Object.assign(new Error('Export size limit'), { code: 'TRAFFIC_ADMIN_RESPONSE_TOO_LARGE' });
      }
      const { startDate, endDate } = overview.period;
      res.set('Content-Disposition', `attachment; filename="traffic-${startDate}-to-${endDate}.csv"`);
      return res.type('text/csv').send(csv);
    } catch (error) {
      const allowedCodes = new Set(['TRAFFIC_ADMIN_QUERY_INVALID', 'TRAFFIC_ADMIN_READ_BUDGET_EXHAUSTED',
        'TRAFFIC_ADMIN_QUERY_CAPACITY', 'TRAFFIC_ADMIN_QUERY_TIMEOUT', 'TRAFFIC_ADMIN_QUERY_UNAVAILABLE',
        'TRAFFIC_ADMIN_RESPONSE_TOO_LARGE']);
      const code = allowedCodes.has(error?.code) ? error.code : 'TRAFFIC_ADMIN_QUERY_UNAVAILABLE';
      const status = code === 'TRAFFIC_ADMIN_QUERY_INVALID' ? 400 :
        ['TRAFFIC_ADMIN_READ_BUDGET_EXHAUSTED', 'TRAFFIC_ADMIN_QUERY_CAPACITY'].includes(code) ? 429 : 503;
      return res.status(status).json({ error: status === 400 ? 'Invalid analytics period.' :
        status === 429 ? 'Analytics resource limit reached.' : 'Analytics temporarily unavailable.', code });
    }
  });
  return router;
}

module.exports = { createTrafficRoutes, snapshotCsv };
