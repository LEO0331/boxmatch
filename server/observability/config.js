function boundedInteger(value, fallback, min, max) {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function readConfig(env = process.env) {
  const secret = typeof env.REQUEST_IP_HMAC_SECRET === 'string' ? env.REQUEST_IP_HMAC_SECRET : '';
  const secretBytes = Buffer.byteLength(secret);
  return Object.freeze({
    enableRequestIntelligence: env.ENABLE_REQUEST_INTELLIGENCE === 'true',
    enableBotVerification: env.ENABLE_BOT_VERIFICATION === 'true',
    ipHmacSecret: secretBytes >= 32 && secretBytes <= 4096 ? secret : null,
    riskWindowMs: boundedInteger(env.REQUEST_RISK_WINDOW_MS, 60000, 1000, 300000),
    riskRateThreshold: boundedInteger(env.REQUEST_RISK_RATE_THRESHOLD, 60, 1, 1000),
    riskAuthFailureThreshold: boundedInteger(env.REQUEST_RISK_AUTH_FAILURE_THRESHOLD, 5, 1, 1000),
    riskNotFoundThreshold: boundedInteger(env.REQUEST_RISK_NOT_FOUND_THRESHOLD, 10, 1, 1000),
    intelligenceMaxEntries: boundedInteger(env.REQUEST_INTELLIGENCE_MAX_ENTRIES, 10000, 1, 10000),
    botVerificationTimeoutMs: boundedInteger(env.BOT_VERIFICATION_TIMEOUT_MS, 2000, 100, 10000),
    botVerificationCacheMaxEntries: boundedInteger(env.BOT_VERIFICATION_CACHE_MAX_ENTRIES, 1000, 1, 10000),
    botVerificationCacheTtlMs: boundedInteger(env.BOT_VERIFICATION_CACHE_TTL_MS, 3600000, 1000, 86400000)
  });
}

module.exports = { readConfig };
