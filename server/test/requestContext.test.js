const { extractSource, headerValue, createRequestIntelligence } = require('../observability/requestContext');
const { readConfig } = require('../observability/config');

function request(headers = {}, extra = {}) {
  return { headers: { host: 'api.example.com', ...headers }, protocol: 'https', method: 'GET', originalUrl: '/health', ...extra };
}

test.each([
  ['https://www.google.com/search?q=PRIVATE', 'search_referral'],
  ['https://bing.com/search?q=PRIVATE', 'search_referral'],
  ['https://github.com/owner/repo?token=PRIVATE', 'github_referral'],
  ['https://l.facebook.com/redirect?user=PRIVATE', 'social_referral'],
  ['https://api.example.com/listings?token=PRIVATE', 'same_origin'],
  ['https://other.example.org/path?token=PRIVATE', 'external_referral'],
  ['https://google.com.attacker.example/path', 'external_referral']
])('attributes sanitized hostname from %s', (referer, channel) => {
  const source = extractSource(request({ referer }));
  expect(source.channel).toBe(channel);
  expect(source.referrerDomain).toBe(new URL(referer).hostname);
  expect(JSON.stringify(source)).not.toContain('PRIVATE');
});

test.each([undefined, [], {}, '\nhttps://google.com', 'x'.repeat(2049), 'not-a-url', 'javascript:alert(1)', 'https://user:secret@google.com/', 'https://127.0.0.1/token', 'https://[::1]/', 'https://google..com/', 'https://-google.com/'])('ignores unsafe referrer %j', (referer) => {
  expect(extractSource(request({ referer }))).toEqual({
    referrerDomain: null, originDomain: null, channel: 'direct_or_unknown'
  });
});

test('origin is a source hint, and missing referrer does not establish direct traffic', () => {
  expect(extractSource(request({ origin: 'https://github.com' }))).toEqual({
    referrerDomain: null, originDomain: 'github.com', channel: 'github_referral'
  });
  expect(extractSource(request()).channel).toBe('direct_or_unknown');
  expect(headerValue('  Chrome  ', 20)).toBe('Chrome');
  expect(headerValue('Chrome\r\nsecret', 20)).toBe('');
});

test('enrichment emits selected categories and fingerprints, never raw identifiers', () => {
  const network = { ip: '8.8.8.8', ipFingerprint: 'hmac:opaque', identityConfidence: 'trusted' };
  const scorer = { evaluate: jest.fn(() => ({ riskScore: 0, riskLevel: 'low', signals: [] })) };
  const verifier = { check: jest.fn(() => 'not_applicable'), close: jest.fn() };
  const intelligence = createRequestIntelligence(readConfig({ ENABLE_REQUEST_INTELLIGENCE: 'true' }), {
    resolveNetworkIdentity: () => network, scorer, verifier
  });
  const finish = intelligence.capture(request({
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0.0.0 PRIVATE_UA',
    authorization: 'Bearer PRIVATE_AUTH', cookie: 'session=PRIVATE_COOKIE',
    referer: 'https://google.com/search?token=PRIVATE_REFERRER'
  }, { originalUrl: '/listing/PRIVATE_PATH?token=PRIVATE_QUERY', body: { pickupCode: 'PRIVATE_CODE' } }));
  const event = finish({ route: '/listing/:listingId', method: 'GET', status: 200 });
  expect(event.network).toEqual({ ipFingerprint: 'hmac:opaque', identityConfidence: 'trusted' });
  expect(event.source.channel).toBe('search_referral');
  expect(event.security.classification).toBe('likely_human');
  expect(JSON.stringify(event)).not.toMatch(/PRIVATE|8\.8\.8\.8/);
  expect(scorer.evaluate).toHaveBeenCalledWith(expect.objectContaining({ fingerprint: 'hmac:opaque', status: 200 }));
  intelligence.close();
  expect(verifier.close).toHaveBeenCalledTimes(1);
});

test('disabled feature extracts nothing and starts no verification work', () => {
  const resolveNetworkIdentity = jest.fn();
  const verifier = { check: jest.fn() };
  const intelligence = createRequestIntelligence(readConfig({}), { resolveNetworkIdentity, verifier });
  expect(intelligence.capture(request())).toBeNull();
  expect(resolveNetworkIdentity).not.toHaveBeenCalled();
  expect(verifier.check).not.toHaveBeenCalled();
});

test('authorized admin operations do not contribute to behavioral counters at completion', () => {
  const network = { ip: '8.8.8.8', ipFingerprint: 'hmac:' + 'a'.repeat(64), identityConfidence: 'trusted' };
  const intelligence = createRequestIntelligence(readConfig({
    ENABLE_REQUEST_INTELLIGENCE: 'true', REQUEST_RISK_RATE_THRESHOLD: '1'
  }), { resolveNetworkIdentity: () => network });
  const req = request({ 'user-agent': 'Mozilla/5.0' }, { originalUrl: '/admin/traffic/overview' });
  const complete = () => intelligence.capture(req);
  for (let i = 0; i < 3; i++) {
    expect(complete()({ route: '[pre-route-or-unmatched]', method: 'GET', status: 200, skipBehavior: true }).security.signals).toEqual([]);
  }
  expect(complete()({ route: '[pre-route-or-unmatched]', method: 'GET', status: 401 }).security.signals).not.toContain('HIGH_REQUEST_FREQUENCY');
  expect(complete()({ route: '[pre-route-or-unmatched]', method: 'GET', status: 401 }).security.signals).toContain('HIGH_REQUEST_FREQUENCY');
  intelligence.close();
});
