function positiveInteger(value, fallback, max) {
  return Number.isSafeInteger(value) && value > 0 && value <= max ? value : fallback;
}

function classifySuspiciousPath(value) {
  if (typeof value !== 'string') return false;
  // The bounded path is used transiently; neither it nor decoded components are retained.
  let path = value.slice(0, 4096).split(/[?#]/, 1)[0];
  for (let i = 0; i < 2; i++) {
    try { path = decodeURIComponent(path); } catch (_) { break; }
  }
  path = path.replace(/\\/g, '/').toLowerCase();
  return /(?:^|\/)\.\.(?:\/|$)/.test(path) ||
    /(?:^|\/)(?:wp-admin|wp-login\.php|xmlrpc\.php|\.env(?:\.[^/]*)?|\.git|phpmyadmin|phpinfo\.php|adminer(?:\.php)?|wp-config\.php|web\.config|\.htaccess|\.htpasswd|config\.(?:php|ya?ml|json)|appsettings\.json|application\.(?:properties|ya?ml)|database\.ya?ml|docker-compose\.ya?ml|credentials(?:\.json)?|id_rsa)(?:\/|$)/.test(path);
}

// Retain only the newest timestamps needed to determine whether a threshold is met.
// A ring caps memory even if one network produces arbitrarily many observations.
function timestampWindow(capacity) {
  const timestamps = new Float64Array(capacity);
  let head = 0;
  let size = 0;
  return {
    add(timestamp) {
      if (size === capacity) {
        timestamps[head] = timestamp;
        head = (head + 1) % capacity;
      } else {
        timestamps[(head + size) % capacity] = timestamp;
        size++;
      }
    },
    countSince(cutoff) {
      while (size && timestamps[head] <= cutoff) {
        head = (head + 1) % capacity;
        size--;
      }
      return size;
    }
  };
}

function createRiskScorer(config = {}, { now = Date.now } = {}) {
  const windowMs = positiveInteger(config.riskWindowMs, 60000, 300000);
  const rateThreshold = positiveInteger(config.riskRateThreshold, 60, 1000);
  const authThreshold = positiveInteger(config.riskAuthFailureThreshold, 5, 1000);
  const notFoundThreshold = positiveInteger(config.riskNotFoundThreshold, 10, 1000);
  // Keep even the largest supported thresholds inside a 16 MiB timestamp budget.
  const bytesPerEntry = 8 * (rateThreshold + 1 + authThreshold + notFoundThreshold) + 256;
  const maxEntries = Math.min(positiveInteger(config.intelligenceMaxEntries, 10000, 10000),
    Math.max(1, Math.floor(16 * 1024 * 1024 / bytesPerEntry)));
  const observations = new Map();

  function evaluate(input = {}) {
    if (input.preflight || input.healthCheck ||
        (input.route === '/health' && /^(?:GET|HEAD)$/.test(input.method))) {
      return { riskScore: 0, riskLevel: 'low', signals: [] };
    }
    const signals = [];
    let score = 0;
    const add = (signal, points) => { signals.push(signal); score += points; };
    if (!input.userAgentPresent) add('MISSING_USER_AGENT', 10);
    if (input.suspiciousPath) add('SUSPICIOUS_PATH', 25);
    if (input.verificationStatus === 'verification_failed') add('BOT_IDENTITY_MISMATCH', 30);

    const timestamp = now();
    const cutoff = timestamp - windowMs;
    // LRU insertion order also orders last observations. Reap at most 32 stale
    // identities per evaluation; capacity eviction handles an expired backlog.
    for (let i = 0; i < 32 && observations.size; i++) {
      const first = observations.entries().next().value;
      if (first[1].lastObserved > cutoff) break;
      observations.delete(first[0]);
    }
    const key = input.fingerprint;
    if (input.identityConfidence === 'trusted' && typeof key === 'string' && /^hmac:[a-f0-9]{64}$/.test(key)) {
      let entry = observations.get(key);
      if (!entry) {
        if (observations.size >= maxEntries) observations.delete(observations.keys().next().value);
        entry = {
          requests: timestampWindow(rateThreshold + 1),
          auth: timestampWindow(authThreshold),
          notFound: timestampWindow(notFoundThreshold)
        };
      }
      entry.requests.add(timestamp);
      if (input.status === 401 || input.status === 403) entry.auth.add(timestamp);
      if (input.status === 404) entry.notFound.add(timestamp);
      if (entry.requests.countSince(cutoff) > rateThreshold) add('HIGH_REQUEST_FREQUENCY', 20);
      if (entry.auth.countSince(cutoff) >= authThreshold) add('REPEATED_AUTH_FAILURE', 20);
      if (entry.notFound.countSince(cutoff) >= notFoundThreshold) add('REPEATED_NOT_FOUND', 15);
      entry.lastObserved = timestamp;
      observations.delete(key);
      observations.set(key, entry);
    }
    const riskScore = Math.min(100, score);
    return { riskScore, riskLevel: riskScore >= 60 ? 'high' : riskScore >= 30 ? 'suspicious' : 'low', signals };
  }

  return { evaluate, get size() { return observations.size; } };
}

module.exports = { createRiskScorer, classifySuspiciousPath };
