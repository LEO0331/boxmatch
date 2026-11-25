const { classifyTraffic, normalizeUserAgent } = require('../observability/trafficClassifier');

describe('traffic classification from untrusted User-Agent claims', () => {
  test.each([
    ['Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36', 'Chrome', 'Windows'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15 Safari/604.1', 'Safari', 'iOS'],
    ['Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/132.0', 'Firefox', 'Linux'],
    ['Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36 Edg/131.0', 'Edge', 'Windows']
  ])('recognizes a browser signature without asserting humanity: %s', (ua, browser, os) => {
    expect(classifyTraffic(ua)).toEqual({
      type: 'browser', browser, os, claimedBot: null, botPurpose: null, classification: 'likely_human'
    });
    expect(classifyTraffic(ua)).not.toHaveProperty('verified');
  });

  test.each([
    ['Googlebot', 'search_engine_crawler', 'search'],
    ['Bingbot', 'search_engine_crawler', 'search'],
    ['DuckDuckBot', 'search_engine_crawler', 'search'],
    ['YandexBot', 'search_engine_crawler', 'search'],
    ['Baiduspider', 'search_engine_crawler', 'search'],
    ['GPTBot', 'ai_crawler', 'training'],
    ['OAI-SearchBot', 'ai_crawler', 'search'],
    ['ChatGPT-User', 'ai_crawler', 'user_triggered'],
    ['ClaudeBot', 'ai_crawler', 'training'],
    ['Claude-SearchBot', 'ai_crawler', 'search'],
    ['Claude-User', 'ai_crawler', 'user_triggered'],
    ['PerplexityBot', 'ai_crawler', 'search'],
    ['facebookexternalhit', 'social_media_crawler', 'link_preview'],
    ['Twitterbot', 'social_media_crawler', 'link_preview'],
    ['LinkedInBot', 'social_media_crawler', 'link_preview'],
    ['Discordbot', 'social_media_crawler', 'link_preview'],
    ['Slackbot-LinkExpanding', 'social_media_crawler', 'link_preview'],
    ['Slackbot', 'social_media_crawler', 'automation']
  ])('labels %s as a claimed crawler only', (claimedBot, classification, botPurpose) => {
    const result = classifyTraffic(`Mozilla/5.0 (compatible; ${claimedBot.toLowerCase()}/1.0; +https://example.invalid/bot)`);
    expect(result).toMatchObject({ type: 'crawler', claimedBot, classification, botPurpose });
    expect(result).not.toHaveProperty('verificationStatus');
  });

  test.each(['curl/8.0', 'Wget/1.21.4', 'PostmanRuntime/7.43.0', 'python-requests/2.32.0',
    'Go-http-client/1.1', 'Mozilla/5.0 Chrome/131.0 HeadlessChrome/131.0', 'Playwright/1.0'])
  ('ordinary automation is not labeled malicious: %s', (ua) => {
    expect(classifyTraffic(ua)).toMatchObject({ type: 'api_client', classification: 'automated_api_client' });
  });

  test('scanner and scraper signatures remain heuristic categories', () => {
    expect(classifyTraffic('sqlmap/1.8')).toMatchObject({ classification: 'suspected_security_scanner' });
    expect(classifyTraffic('Scrapy/2.12')).toMatchObject({ classification: 'suspected_scraper' });
    expect(classifyTraffic('Googlebot/2.1', { suspiciousPath: true }))
      .toMatchObject({ claimedBot: 'Googlebot', classification: 'suspected_security_scanner' });
  });

  test.each([undefined, null, [], {}, 123, 'x'.repeat(1025), 'Googlebot\nAuthorization: SECRET'])
  ('rejects missing/malformed/oversized headers: %j', (value) => {
    expect(normalizeUserAgent(value)).toBe('');
    expect(classifyTraffic(value)).toMatchObject({ type: 'unknown', claimedBot: null, classification: 'unknown' });
  });

  test('does not retain attacker content or accept a bot-name substring as an identity', () => {
    expect(classifyTraffic('NotGooglebot/2.1')).toMatchObject({ claimedBot: null });
    expect(JSON.stringify(classifyTraffic('PRIVATE_TOKEN_abc curl/8.1'))).not.toContain('PRIVATE_TOKEN');
    expect(classifyTraffic('Mozilla/5.0')).toMatchObject({ classification: 'unknown' });
  });
});
