const { createRiskScorer, classifySuspiciousPath } = require('../observability/riskScorer');

const fingerprint = `hmac:${'a'.repeat(64)}`;
const request = { fingerprint, identityConfidence: 'trusted', method: 'GET', route: '/api/items',
  status: 200, userAgentPresent: true, verificationStatus: 'not_applicable' };

describe('bounded observation-only request risk scoring', () => {
  let timestamp;
  let scorer;
  beforeEach(() => {
    timestamp = 100000;
    scorer = createRiskScorer({}, { now: () => timestamp });
  });

  test('counts strictly more than 60 requests, not exactly 60', () => {
    for (let i = 0; i < 60; i++) expect(scorer.evaluate(request).signals).not.toContain('HIGH_REQUEST_FREQUENCY');
    expect(scorer.evaluate(request)).toMatchObject({ riskScore: 20, riskLevel: 'low', signals: ['HIGH_REQUEST_FREQUENCY'] });
  });

  test('adds each applicable auth and not-found signal once per evaluation', () => {
    for (let i = 0; i < 4; i++) expect(scorer.evaluate({ ...request, status: 401 }).signals).toEqual([]);
    expect(scorer.evaluate({ ...request, status: 403 }).signals).toEqual(['REPEATED_AUTH_FAILURE']);
    for (let i = 0; i < 9; i++) expect(scorer.evaluate({ ...request, status: 404 }).signals).not.toContain('REPEATED_NOT_FOUND');
    const result = scorer.evaluate({ ...request, status: 404 });
    expect(result).toEqual({ riskScore: 35, riskLevel: 'suspicious', signals: ['REPEATED_AUTH_FAILURE', 'REPEATED_NOT_FOUND'] });
    expect(new Set(result.signals).size).toBe(result.signals.length);
  });

  test('caps a combined score at 100 and has stable risk boundaries', () => {
    for (let i = 0; i < 61; i++) scorer.evaluate({ ...request, status: i < 10 ? 404 : 401 });
    expect(scorer.evaluate({ ...request, userAgentPresent: false, suspiciousPath: true,
      verificationStatus: 'verification_failed' })).toMatchObject({ riskScore: 100, riskLevel: 'high' });
    expect(createRiskScorer().evaluate({ ...request, userAgentPresent: false })).toMatchObject({ riskScore: 10, riskLevel: 'low' });
    expect(createRiskScorer().evaluate({ ...request, verificationStatus: 'verification_failed' }))
      .toMatchObject({ riskScore: 30, riskLevel: 'suspicious' });
    const thresholds = createRiskScorer({ riskRateThreshold: 1, riskAuthFailureThreshold: 1 });
    thresholds.evaluate(request);
    expect(thresholds.evaluate({ ...request, status: 401, verificationStatus: 'verification_failed' }))
      .toMatchObject({ riskScore: 70, riskLevel: 'high' });
  });

  test('provider outages, unavailable verification and unsupported providers do not add mismatch risk', () => {
    for (const verificationStatus of ['unverified', 'verification_unavailable', 'not_applicable', 'verified']) {
      expect(scorer.evaluate({ ...request, verificationStatus }).riskScore).toBe(0);
    }
  });

  test('expires the exact sliding-window boundary', () => {
    for (let i = 0; i < 61; i++) scorer.evaluate(request);
    timestamp += 59999;
    expect(scorer.evaluate(request).signals).toContain('HIGH_REQUEST_FREQUENCY');
    timestamp++;
    expect(scorer.evaluate(request).signals).toEqual([]);
    expect(scorer.size).toBe(1);
  });

  test('a saturated timestamp ring retains only recent threshold observations', () => {
    for (let i = 0; i < 10000; i++) scorer.evaluate({ ...request, status: 401 });
    timestamp += 60000;
    expect(scorer.evaluate(request).signals).toEqual([]);
  });

  test('bounds identities and expires inactive entries without scanning all identities', () => {
    scorer = createRiskScorer({ intelligenceMaxEntries: 2 }, { now: () => timestamp });
    scorer.evaluate(request);
    scorer.evaluate({ ...request, fingerprint: `hmac:${'b'.repeat(64)}` });
    scorer.evaluate({ ...request, fingerprint: `hmac:${'c'.repeat(64)}` });
    expect(scorer.size).toBe(2);
    timestamp += 60000;
    scorer.evaluate(request);
    expect(scorer.size).toBe(1);
  });

  test('large configured thresholds reduce identity capacity to the timestamp memory budget', () => {
    scorer = createRiskScorer({ intelligenceMaxEntries: 10000, riskRateThreshold: 1000,
      riskAuthFailureThreshold: 1000, riskNotFoundThreshold: 1000 });
    for (let i = 0; i < 800; i++) {
      scorer.evaluate({ ...request, fingerprint: `hmac:${i.toString(16).padStart(64, '0')}` });
    }
    const expectedCapacity = Math.floor(16 * 1024 * 1024 / (8 * (1001 + 1000 + 1000) + 256));
    expect(scorer.size).toBe(expectedCapacity);
    expect(scorer.size).toBeLessThan(700);
  });

  test.each(['proxy', 'unresolved'])('does not attribute shared/unresolved identities to a person (%s)', (identityConfidence) => {
    for (let i = 0; i < 100; i++) {
      expect(scorer.evaluate({ ...request, identityConfidence, status: 401 }).signals).toEqual([]);
    }
    expect(scorer.size).toBe(0);
    expect(scorer.evaluate({ ...request, identityConfidence, suspiciousPath: true }).signals).toEqual(['SUSPICIOUS_PATH']);
  });

  test.each([undefined, null, '', '192.0.2.1', 'sha256:guessable'])('does not count without a valid HMAC fingerprint: %s', (key) => {
    for (let i = 0; i < 61; i++) expect(scorer.evaluate({ ...request, fingerprint: key }).riskScore).toBe(0);
    expect(scorer.size).toBe(0);
  });

  test('health checks and preflights never add scores or behavioral observations', () => {
    for (const extra of [{ method: 'OPTIONS', preflight: true }, { preflight: true }, { route: '/health' }, { healthCheck: true }]) {
      for (let i = 0; i < 61; i++) expect(scorer.evaluate({ ...request, status: 403,
        userAgentPresent: false, verificationStatus: 'verification_failed', ...extra }))
        .toEqual({ riskScore: 0, riskLevel: 'low', signals: [] });
    }
    expect(scorer.size).toBe(0);
    expect(scorer.evaluate(request).riskScore).toBe(0);
  });

  test('OPTIONS probes without preflight headers remain observable', () => {
    expect(scorer.evaluate({ ...request, method: 'OPTIONS', suspiciousPath: true }))
      .toMatchObject({ riskScore: 25, signals: ['SUSPICIOUS_PATH'] });
    expect(scorer.size).toBe(1);
  });

  test('invalid or oversized numeric configuration uses conservative defaults', () => {
    scorer = createRiskScorer({ riskRateThreshold: NaN, riskAuthFailureThreshold: -1,
      riskNotFoundThreshold: Infinity, intelligenceMaxEntries: 100000000, riskWindowMs: 0 });
    for (let i = 0; i < 4; i++) expect(scorer.evaluate({ ...request, status: 401 }).riskScore).toBe(0);
    expect(scorer.evaluate({ ...request, status: 403 }).riskScore).toBe(20);
  });
});

describe('transient suspicious path classification', () => {
  test.each(['/wp-admin/', '/wp-login.php', '/xmlrpc.php', '/.env', '/.env.production', '/.git/config',
    '/phpmyadmin/index.php', '/adminer.php', '/backup/config.json', '/web.config', '/.htpasswd',
    '/appsettings.json', '/application.properties', '/config/database.yml', '/docker-compose.yaml',
    '/../secret', '/%2e%2e/secret', '/%252e%252e%252fsecret', '/..\\secret'])
  ('recognizes a probe without returning path contents: %s', (path) => {
    expect(classifySuspiciousPath(path)).toBe(true);
  });

  test.each(['/api/items?next=/.env&token=SECRET', '/health', '/api/environment', '/wordpress-guide',
    '/listing/valid-id', null, {}])('does not flag ordinary routes/query contents: %j', (path) => {
    expect(classifySuspiciousPath(path)).toBe(false);
  });
});
