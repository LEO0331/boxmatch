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
    botVerificationCacheTtlMs: boundedInteger(env.BOT_VERIFICATION_CACHE_TTL_MS, 3600000, 1000, 86400000),
    enableFrontendTelemetry: env.ENABLE_FRONTEND_TELEMETRY === 'true',
    enableGeoEnrichment: env.ENABLE_GEO_ENRICHMENT === 'true',
    enableTrafficAggregation: env.ENABLE_TRAFFIC_AGGREGATION === 'true',
    trafficFlushIntervalMs: boundedInteger(env.TRAFFIC_FLUSH_INTERVAL_MS, 300000, 60000, 3600000),
    trafficRetentionDays: boundedInteger(env.TRAFFIC_RETENTION_DAYS, 90, 7, 365),
    trafficMaxPendingDays: boundedInteger(env.TRAFFIC_MAX_PENDING_DAYS, 3, 1, 7),
    trafficMaxAsnBuckets: boundedInteger(env.TRAFFIC_MAX_ASN_BUCKETS, 100, 1, 100),
    trafficMaxCountryBuckets: boundedInteger(env.TRAFFIC_MAX_COUNTRY_BUCKETS, 100, 1, 250),
    trafficWriteBudgetPerDay: boundedInteger(env.TRAFFIC_WRITE_BUDGET_PER_DAY, 600, 2, 1000),
    telemetryMaxBodyBytes: boundedInteger(env.TELEMETRY_MAX_BODY_BYTES, 2048, 256, 2048),
    telemetryRateLimitPerMinute: boundedInteger(env.TELEMETRY_RATE_LIMIT_PER_MINUTE, 20, 1, 100),
    telemetryGlobalRateLimitPerMinute: boundedInteger(env.TELEMETRY_GLOBAL_RATE_LIMIT_PER_MINUTE, 300, 1, 1000),
    geoCountryDbPath: localPath(env.GEO_COUNTRY_DB_PATH),
    geoAsnDbPath: localPath(env.GEO_ASN_DB_PATH),
    geoCacheMaxEntries: boundedInteger(env.GEO_CACHE_MAX_ENTRIES, 2000, 1, 10000),
    geoCacheTtlMs: boundedInteger(env.GEO_CACHE_TTL_MS, 3600000, 1000, 86400000),
    enableTrafficAdmin: env.ENABLE_TRAFFIC_ADMIN === 'true',
    trafficAdminCacheTtlMs: boundedInteger(env.TRAFFIC_ADMIN_CACHE_TTL_MS, 60000, 1000, 300000),
    trafficAdminCacheMaxEntries: boundedInteger(env.TRAFFIC_ADMIN_CACHE_MAX_ENTRIES, 32, 1, 32),
    trafficAdminMaxQueryDays: boundedInteger(env.TRAFFIC_ADMIN_MAX_QUERY_DAYS, 90, 1, 90),
    trafficAdminRateLimitPerMinute: boundedInteger(env.TRAFFIC_ADMIN_RATE_LIMIT_PER_MINUTE, 10, 1, 30),
    trafficAdminGlobalRateLimitPerMinute: boundedInteger(env.TRAFFIC_ADMIN_GLOBAL_RATE_LIMIT_PER_MINUTE, 60, 1, 120),
    trafficAdminReadBudgetPerDay: boundedInteger(env.TRAFFIC_ADMIN_READ_BUDGET_PER_DAY, 3000, 1, 10000),
    trafficAdminAuthConcurrency: boundedInteger(env.TRAFFIC_ADMIN_AUTH_CONCURRENCY, 4, 1, 4),
    trafficAdminAuthTimeoutMs: boundedInteger(env.TRAFFIC_ADMIN_AUTH_TIMEOUT_MS, 5000, 100, 10000),
    trafficAdminQueryTimeoutMs: boundedInteger(env.TRAFFIC_ADMIN_QUERY_TIMEOUT_MS, 5000, 100, 10000),
    trafficAdminQueryConcurrency: boundedInteger(env.TRAFFIC_ADMIN_QUERY_CONCURRENCY, 2, 1, 2)
  });
}

function localPath(value) {
  return typeof value === 'string' && value.length <= 4096 && value.trim() &&
    !/[\x00-\x1f]/.test(value) && !value.includes('://') ? value.trim() : null;
}

module.exports = { readConfig, boundedInteger };
