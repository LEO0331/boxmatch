const { readConfig } = require('../observability/config');

test('request intelligence and external verification default disabled', () => {
  expect(readConfig({})).toEqual({
    enableRequestIntelligence: false, enableBotVerification: false, ipHmacSecret: null,
    riskWindowMs: 60000, riskRateThreshold: 60, riskAuthFailureThreshold: 5,
    riskNotFoundThreshold: 10, intelligenceMaxEntries: 10000,
    botVerificationTimeoutMs: 2000, botVerificationCacheMaxEntries: 1000,
    botVerificationCacheTtlMs: 3600000
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
