const { createGeoResolver } = require('./geoResolver');
const { createTrafficAggregator } = require('./trafficAggregator');
const { createTrafficPersistence } = require('./trafficPersistence');
const { resolveNetworkIdentity } = require('./clientIp');
const { classifyTraffic } = require('./trafficClassifier');

function isTelemetryTransport(req) {
  return /^\/telemetry\/visit\/?(?:[?#]|$)/i.test(req.originalUrl || req.url || '');
}

function createTrafficAnalytics(config, { db, logEvent, geoResolver, aggregator, persistence } = {}) {
  const geo = geoResolver || (config.enableGeoEnrichment ? createGeoResolver(config) : null);
  const counters = aggregator || (config.enableTrafficAggregation ? createTrafficAggregator(config) : null);
  const writer = persistence || (counters ? createTrafficPersistence(config, { db, aggregator: counters, logEvent }) : null);
  let closing;
  return {
    geoResolver: geo,
    recordApi(event) {
      try { counters?.recordApi(event); } catch (_) { /* analytics never affect API delivery */ }
    },
    acceptVisit(visit, req) {
      try {
        const identity = resolveNetworkIdentity(req, config.ipHmacSecret);
        let location = {};
        try { location = geo?.lookup(identity) || {}; } catch (_) { location = { geoStatus: 'unavailable' }; }
        const classified = classifyTraffic(req.headers?.['user-agent']);
        const event = {
          ...visit,
          ts: new Date().toISOString(),
          client: { browser: classified.browser, os: classified.os, type: classified.type },
          network: { identityConfidence: identity.identityConfidence, ...location }
        };
        counters?.recordVisit(event);
        logEvent?.('info', 'traffic.visit.accepted', { requestId: req.requestId, ...event });
      } catch (_) { /* public telemetry remains best effort */ }
    },
    start() { writer?.start(); },
    shutdown(deadlineMs = 2000) {
      if (!closing) closing = (async () => {
        try { await writer?.shutdown(deadlineMs); } catch (_) { /* bounded best effort */ }
        counters?.close?.();
        geo?.close();
      })();
      return closing;
    },
    async flush(options) { return writer?.flush(options); }
  };
}

module.exports = { createTrafficAnalytics, isTelemetryTransport };
