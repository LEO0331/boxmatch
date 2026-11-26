const express = require('express');
const { resolveNetworkIdentity } = require('./clientIp');
const { validateVisit } = require('./visitValidator');

function bounded(value, fallback, maximum) {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

// Mount before the global JSON parser. No authentication, business rate limiter,
// database writes, provider verification, or geo lookup belongs in this router.
function createTelemetryMiddleware(config = {}, dependencies = {}) {
  const router = express.Router();
  const now = dependencies.now || Date.now;
  const resolveNetwork = dependencies.resolveNetworkIdentity || resolveNetworkIdentity;
  const maxBody = bounded(config.telemetryMaxBodyBytes, 2048, 2048);
  const perNetwork = bounded(config.telemetryRateLimitPerMinute, 20, 100);
  const globalLimit = bounded(config.telemetryGlobalRateLimitPerMinute, 300, 1000);
  const maxEntries = Math.min(bounded(config.intelligenceMaxEntries, 10000, 10000), globalLimit);
  const parseJson = express.json({ limit: maxBody, strict: true, inflate: false, type: 'application/json' });
  let windowStart = null;
  let globalCount = 0;
  const networks = new Map();

  router.use((req, res, next) => {
    if (req.path !== '/') return res.sendStatus(404);
    next();
  });
  if (dependencies.corsMiddleware) router.use(dependencies.corsMiddleware);
  router.use((req, res, next) => {
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!config.enableFrontendTelemetry) return res.status(404).end();
    if (req.method !== 'POST') return res.set('Allow', 'POST, OPTIONS').status(405).end();
    const timestamp = now();
    if (windowStart == null || timestamp - windowStart >= 60000) {
      windowStart = timestamp;
      globalCount = 0;
      networks.clear();
    }
    // Invalid events consume the budget too; validation cannot be used to bypass it.
    if (globalCount >= globalLimit) return res.status(429).end();
    globalCount++;
    let network;
    try { network = resolveNetwork(req, config.ipHmacSecret); } catch (_) { /* shared unknown budget */ }
    const key = network?.identityConfidence === 'trusted' && /^hmac:[a-f0-9]{64}$/.test(network.ipFingerprint)
      ? network.ipFingerprint : 'unknown';
    if (!networks.has(key) && networks.size >= maxEntries) return res.status(429).end();
    const count = networks.get(key) || 0;
    if (count >= perNetwork) return res.status(429).end();
    networks.set(key, count + 1);
    if (!req.is('application/json')) return res.status(415).end();
    const advertisedBytes = req.headers['content-length'];
    if (advertisedBytes && Number(advertisedBytes) > maxBody) return res.status(413).end();
    next();
  });
  router.use(parseJson);
  router.use((req, res) => {
    const result = validateVisit(req.body, { ownHosts: dependencies.ownHosts });
    if (result.error) return res.status(400).end();
    try {
      // Async hooks are best effort too; they must not hold this HTTP response open.
      Promise.resolve(dependencies.onVisit?.(result.visit, req)).catch(() => {});
    } catch (_) { /* analytics failure must not fail an accepted event */ }
    return res.status(204).end();
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status === 413 ? 413 : error.status === 415 ? 415 : 400;
    return res.status(status).end();
  });
  return router;
}

module.exports = { createTelemetryMiddleware };
