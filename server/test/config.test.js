const { readConfig } = require('../observability/config');

test('request intelligence and external verification default disabled', () => {
  expect(readConfig({})).toEqual({
    enableRequestIntelligence: false, enableBotVerification: false, ipHmacSecret: null,
    riskWindowMs: 60000, riskRateThreshold: 60, riskAuthFailureThreshold: 5,
    riskNotFoundThreshold: 10, intelligenceMaxEntries: 10000,
    botVerificationTimeoutMs: 2000, botVerificationCacheMaxEntries: 1000,
    botVerificationCacheTtlMs: 3600000,
    enableFrontendTelemetry: false, enableGeoEnrichment: false, enableTrafficAggregation: false,
    trafficFlushIntervalMs: 300000, trafficFlushTimeoutMs: 30000, trafficRetentionDays: 90, trafficMaxPendingDays: 3,
    trafficMaxAsnBuckets: 100, trafficMaxCountryBuckets: 100, trafficWriteBudgetPerDay: 600,
    telemetryMaxBodyBytes: 2048, telemetryRateLimitPerMinute: 20, telemetryGlobalRateLimitPerMinute: 300,
    geoCountryDbPath: null, geoAsnDbPath: null, geoCacheMaxEntries: 2000, geoCacheTtlMs: 3600000,
    enableTrafficAdmin: false, trafficAdminCacheTtlMs: 60000, trafficAdminCacheMaxEntries: 32,
    trafficAdminMaxQueryDays: 90, trafficAdminRateLimitPerMinute: 10, trafficAdminGlobalRateLimitPerMinute: 60,
    trafficAdminReadBudgetPerDay: 3000, trafficAdminAuthConcurrency: 4, trafficAdminAuthTimeoutMs: 5000,
    trafficAdminQueryTimeoutMs: 5000, trafficAdminQueryConcurrency: 2
  });
});

test('only explicit true enables a feature and no insecure secret fallback exists', () => {
  for (const value of [undefined, 'false', '1', 'yes', 'TRUE', {}, true]) {
    const config = readConfig({ ENABLE_REQUEST_INTELLIGENCE: value, ENABLE_BOT_VERIFICATION: value });
    expect(config.enableRequestIntelligence).toBe(false);
    expect(config.enableBotVerification).toBe(false);
  }
  const config = readConfig({ ENABLE_REQUEST_INTELLIGENCE: 'true', ENABLE_BOT_VERIFICATION: 'true',
    REQUEST_IP_HMAC_SECRET: 'secure-test-secret-with-32-characters' });
  expect(config.enableRequestIntelligence).toBe(true);
  expect(config.enableBotVerification).toBe(true);
  expect(config.ipHmacSecret).toBe('secure-test-secret-with-32-characters');
  for (const value of ['', 'short', 'x'.repeat(4097), {}]) {
    expect(readConfig({ REQUEST_IP_HMAC_SECRET: value }).ipHmacSecret).toBeNull();
  }
  expect(Object.isFrozen(config)).toBe(true);
});

test.each(['-1', '0', 'NaN', 'Infinity', '1e100', '1.5', '99999999999999999', '', 'abc', {}, []])(
  'malformed or excessive numeric configuration %j restores safe defaults', (value) => {
    const env = {};
    for (const name of ['REQUEST_RISK_WINDOW_MS', 'REQUEST_RISK_RATE_THRESHOLD',
      'REQUEST_RISK_AUTH_FAILURE_THRESHOLD', 'REQUEST_RISK_NOT_FOUND_THRESHOLD',
      'REQUEST_INTELLIGENCE_MAX_ENTRIES', 'BOT_VERIFICATION_TIMEOUT_MS',
      'BOT_VERIFICATION_CACHE_MAX_ENTRIES', 'BOT_VERIFICATION_CACHE_TTL_MS']) env[name] = value;
    expect(readConfig(env)).toEqual(readConfig({}));
  }
);

test('numeric configuration respects configured values and upper bounds', () => {
  expect(readConfig({ REQUEST_RISK_WINDOW_MS: '300000', REQUEST_INTELLIGENCE_MAX_ENTRIES: '10000',
    REQUEST_RISK_RATE_THRESHOLD: ' 30 ', BOT_VERIFICATION_TIMEOUT_MS: '10000' }))
    .toMatchObject({ riskWindowMs: 300000, intelligenceMaxEntries: 10000, riskRateThreshold: 30,
      botVerificationTimeoutMs: 10000 });
  expect(readConfig({ REQUEST_RISK_WINDOW_MS: '300001', REQUEST_INTELLIGENCE_MAX_ENTRIES: '10001',
    BOT_VERIFICATION_TIMEOUT_MS: '10001', REQUEST_RISK_RATE_THRESHOLD: '1001' })).toMatchObject({ riskWindowMs: 60000,
    intelligenceMaxEntries: 10000, botVerificationTimeoutMs: 2000, riskRateThreshold: 60 });
});

test('Phase 2 flags are independently opt-in and local database paths cannot be URLs', () => {
  const flags = ['ENABLE_FRONTEND_TELEMETRY', 'ENABLE_GEO_ENRICHMENT', 'ENABLE_TRAFFIC_AGGREGATION'];
  for (const flag of flags) {
    expect(Object.values(readConfig({ [flag]: 'TRUE' })).filter((value) => value === true)).toHaveLength(0);
    expect(Object.values(readConfig({ [flag]: 'true' })).filter((value) => value === true)).toHaveLength(1);
  }
  for (const path of ['https://attacker.example/db.mmdb', 'bad\0path', '', 'x'.repeat(4097)]) {
    expect(readConfig({ GEO_COUNTRY_DB_PATH: path, GEO_ASN_DB_PATH: path }))
      .toMatchObject({ geoCountryDbPath: null, geoAsnDbPath: null });
  }
  expect(readConfig({ GEO_COUNTRY_DB_PATH: '/private/country.mmdb' }).geoCountryDbPath).toBe('/private/country.mmdb');
});

test('Phase 2 resource configuration rejects invalid or excessive limits', () => {
  const names = ['TRAFFIC_FLUSH_INTERVAL_MS', 'TRAFFIC_RETENTION_DAYS', 'TRAFFIC_MAX_PENDING_DAYS',
    'TRAFFIC_MAX_ASN_BUCKETS', 'TRAFFIC_MAX_COUNTRY_BUCKETS', 'TRAFFIC_WRITE_BUDGET_PER_DAY',
    'TELEMETRY_MAX_BODY_BYTES', 'TELEMETRY_RATE_LIMIT_PER_MINUTE', 'TELEMETRY_GLOBAL_RATE_LIMIT_PER_MINUTE',
    'GEO_CACHE_MAX_ENTRIES', 'GEO_CACHE_TTL_MS'];
  for (const value of ['0', '-1', '1e9', 'NaN', '999999999', '1.5']) {
    expect(readConfig(Object.fromEntries(names.map((name) => [name, value])))).toEqual(readConfig({}));
  }
  expect(readConfig({ TRAFFIC_FLUSH_INTERVAL_MS: '60000', TELEMETRY_MAX_BODY_BYTES: '2049',
    TELEMETRY_GLOBAL_RATE_LIMIT_PER_MINUTE: '1001' }))
    .toMatchObject({ trafficFlushIntervalMs: 60000, telemetryMaxBodyBytes: 2048, telemetryGlobalRateLimitPerMinute: 300 });
});

test('administrator features default off and resource limits remain bounded', () => {
  for (const value of ['false', 'TRUE', 'yes', '1']) expect(readConfig({ ENABLE_TRAFFIC_ADMIN: value }).enableTrafficAdmin).toBe(false);
  expect(readConfig({ ENABLE_TRAFFIC_ADMIN: 'true' }).enableTrafficAdmin).toBe(true);
  const limits = {
    TRAFFIC_ADMIN_CACHE_TTL_MS: '300001', TRAFFIC_ADMIN_CACHE_MAX_ENTRIES: '33',
    TRAFFIC_ADMIN_MAX_QUERY_DAYS: '91', TRAFFIC_ADMIN_RATE_LIMIT_PER_MINUTE: '31',
    TRAFFIC_ADMIN_GLOBAL_RATE_LIMIT_PER_MINUTE: '121', TRAFFIC_ADMIN_READ_BUDGET_PER_DAY: '10001',
    TRAFFIC_ADMIN_AUTH_CONCURRENCY: '5', TRAFFIC_ADMIN_AUTH_TIMEOUT_MS: '10001',
    TRAFFIC_ADMIN_QUERY_CONCURRENCY: '3', TRAFFIC_ADMIN_QUERY_TIMEOUT_MS: '10001'
  };
  expect(readConfig(limits)).toEqual(readConfig({}));
  for (const invalid of ['0', '-1', 'NaN', '1.5', '1e9']) {
    expect(readConfig(Object.fromEntries(Object.keys(limits).map((key) => [key, invalid])))).toEqual(readConfig({}));
  }
});

test('flush deadline and dashboard period floor are bounded', () => {
  expect(readConfig({ TRAFFIC_FLUSH_TIMEOUT_MS: '1000', TRAFFIC_ADMIN_MAX_QUERY_DAYS: '3' })).toMatchObject({ trafficFlushTimeoutMs: 1000, trafficAdminMaxQueryDays: 7 });
  expect(readConfig({ TRAFFIC_FLUSH_TIMEOUT_MS: '60001' }).trafficFlushTimeoutMs).toBe(30000);
});
