const { isIP } = require('node:net');
const { resolveNetworkIdentity } = require('./clientIp');
const { classifyTraffic } = require('./trafficClassifier');
const { classifySuspiciousPath, createRiskScorer } = require('./riskScorer');
const { createBotVerifier } = require('./botVerifier');

function headerValue(value, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength || /[\x00-\x1f\x7f]/.test(value)) return '';
  return value.trim();
}

function parseSource(value) {
  const text = headerValue(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostname || hostname.length > 253 || isIP(hostname.replace(/^\[|\]$/g, '')) ||
        !/^[a-z0-9.-]+$/.test(hostname) || !hostname.includes('.') ||
        hostname.split('.').some((label) => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) return null;
    return { hostname, origin: url.origin };
  } catch (_) {
    return null;
  }
}

function belongsTo(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function extractSource(req) {
  const referrer = parseSource(req.headers?.referer);
  const origin = parseSource(req.headers?.origin);
  const own = parseSource(`${req.protocol}://${headerValue(req.headers?.host, 253)}`);
  const source = referrer || origin;
  let channel = 'direct_or_unknown';
  if (source) {
    const host = source.hostname;
    if (own && source.origin === own.origin) channel = 'same_origin';
    else if (['google.com', 'google.com.tw', 'google.co.uk', 'bing.com', 'duckduckgo.com', 'search.yahoo.com', 'baidu.com', 'yandex.com', 'yandex.ru'].some((domain) => belongsTo(host, domain))) channel = 'search_referral';
    else if (['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 't.co', 'linkedin.com', 'reddit.com', 'bsky.app', 'threads.net'].some((domain) => belongsTo(host, domain))) channel = 'social_referral';
    else if (belongsTo(host, 'github.com')) channel = 'github_referral';
    else channel = 'external_referral';
  }
  return {
    referrerDomain: referrer?.hostname || null,
    originDomain: origin?.hostname || null,
    channel
  };
}

// Produces enrichment only. The host application owns IDs, lifecycle logging,
// route templates, authorization, and all enforcement decisions.
function createRequestIntelligence(config, dependencies = {}) {
  if (!config.enableRequestIntelligence) return { capture: () => null, close() {} };
  const resolveNetwork = dependencies.resolveNetworkIdentity || resolveNetworkIdentity;
  const scorer = dependencies.scorer || createRiskScorer(config);
  const verifier = dependencies.verifier || createBotVerifier(config);
  return {
    capture(req, options = {}) {
      const network = resolveNetwork(req, config.ipHmacSecret);
      const rawAgent = headerValue(req.headers?.['user-agent'], 1024);
      const suspiciousPath = classifySuspiciousPath(req.originalUrl || req.url || '');
      const client = classifyTraffic(rawAgent, { suspiciousPath });
      const source = extractSource(req);
      const preflight = req.method === 'OPTIONS' && Boolean(
        headerValue(req.headers?.origin, 2048) && headerValue(req.headers?.['access-control-request-method'], 32)
      );
      // Schedule verification immediately, but never await it on the API path.
      if (!options.skipVerification) verifier.check(client.claimedBot, network);
      return ({ route, method, status }) => {
        const verificationStatus = options.skipVerification
          ? (client.claimedBot ? 'unverified' : 'not_applicable')
          : verifier.check(client.claimedBot, network);
        const risk = scorer.evaluate({
          fingerprint: network.ipFingerprint,
          identityConfidence: network.identityConfidence,
          method, route, status, userAgentPresent: Boolean(rawAgent),
          suspiciousPath, verificationStatus, preflight: preflight || options.skipBehavior,
          healthCheck: route === '/health'
        });
        let location = {};
        if (!options.skipGeo && config.enableGeoEnrichment && dependencies.geoResolver) {
          try { location = dependencies.geoResolver.lookup(network); }
          catch (_) { location = { geoStatus: 'unavailable' }; }
        }
        return {
          network: {
            ipFingerprint: network.ipFingerprint,
            identityConfidence: network.identityConfidence,
            ...location
          },
          source,
          client: {
            type: client.type, browser: client.browser, os: client.os,
            claimedBot: client.claimedBot, purpose: client.botPurpose
          },
          security: { classification: client.classification, verificationStatus, ...risk }
        };
      };
    },
    close() { verifier.close(); }
  };
}

module.exports = { createRequestIntelligence, extractSource, headerValue };
