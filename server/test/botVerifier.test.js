const { createBotVerifier, ipInCidr } = require('../observability/botVerifier');

const trusted = (ip = '66.249.66.1') => ({ ip, identityConfidence: 'trusted' });
const jsonFeed = (prefixes = ['66.249.66.0/24']) => new Response(JSON.stringify({
  prefixes: prefixes.map((cidr) => cidr.includes(':') ? { ipv6Prefix: cidr } : { ipv4Prefix: cidr })
}));
const flush = () => new Promise((resolve) => setImmediate(resolve));
async function complete() { for (let i = 0; i < 4; i++) await flush(); }

describe('IP range matching', () => {
  test.each([
    ['66.249.66.1', '66.249.66.0/24', true],
    ['66.249.67.1', '66.249.66.0/24', false],
    ['8.8.8.8', '0.0.0.0/0', true],
    ['::ffff:66.249.66.1', '66.249.66.0/24', true],
    ['2001:4860:4801:0000:0000:0000:0000:0001', '2001:4860:4801::/48', true],
    ['2001:4860:4802::1', '2001:4860:4801::/48', false],
    ['2001:4860::1', '2001:4860::1/128', true],
    ['2001:4860::2', '2001:4860::1/128', false],
    ['8.8.8.8', '::/0', false],
    ['invalid', '0.0.0.0/0', false],
    ['8.8.8.8', '8.8.8.8/33', false],
    ['2001:4860::1', '::/129', false],
    ['8.8.8.8', '8.8.8.8/24/other', false],
    ['8.8.8.8', '8.8.8.8/-1', false]
  ])('%s in %s => %s', (ip, cidr, expected) => expect(ipInCidr(ip, cidr)).toBe(expected));
});

describe('background bot verification', () => {
  const verifiers = [];
  function make(config = {}, deps = {}) {
    const verifier = createBotVerifier({ enableBotVerification: true, ...config }, deps);
    verifiers.push(verifier);
    return verifier;
  }
  afterEach(() => { for (const verifier of verifiers.splice(0)) verifier.close(); jest.useRealTimers(); });

  test('is nonblocking, deduplicates requests, caches the feed and verifies IPv4 and IPv6', async () => {
    const fetch = jest.fn(async () => jsonFeed(['66.249.66.0/24', '2001:4860:4801::/48']));
    const verifier = make({}, { fetch });
    expect(verifier.check('Googlebot', trusted())).toBe('verification_unavailable');
    expect(verifier.check('Googlebot', trusted())).toBe('verification_unavailable');
    expect(fetch).not.toHaveBeenCalled();
    await complete();
    expect(verifier.check('Googlebot', trusted())).toBe('verified');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://developers.google.com/static/crawling/ipranges/common-crawlers.json');
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
    expect(verifier.check('Googlebot', trusted('2001:4860:4801::12'))).toBe('verification_unavailable');
    await complete();
    expect(verifier.check('Googlebot', trusted('2001:4860:4801::12'))).toBe('verified');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test.each(['Googlebot', 'GPTBot'])('a spoofed %s fails only after a successful official range check', async (bot) => {
    const fetch = jest.fn(async () => jsonFeed());
    const verifier = make({}, { fetch });
    expect(verifier.check(bot, trusted('8.8.8.8'))).toBe('verification_unavailable');
    await complete();
    expect(verifier.check(bot, trusted('8.8.8.8'))).toBe('verification_failed');
    expect(fetch.mock.calls[0][0]).toBe(bot === 'GPTBot'
      ? 'https://openai.com/gptbot.json'
      : 'https://developers.google.com/static/crawling/ipranges/common-crawlers.json');
  });

  test.each([
    ['DuckDuckBot', 'https://duckduckgo.com/duckduckbot.json'],
    ['Discordbot', 'https://cdn.discordapp.com/ipranges/discord.json']
  ])('%s uses only its reviewed provider feed', async (bot, endpoint) => {
    const fetch = jest.fn(async () => jsonFeed());
    const verifier = make({}, { fetch });
    verifier.check(bot, trusted());
    await complete();
    expect(verifier.check(bot, trusted())).toBe('verified');
    expect(fetch.mock.calls[0][0]).toBe(endpoint);
  });

  test('Baiduspider requires forward-confirmed DNS under an exact official suffix', async () => {
    const reverse = jest.fn(async () => ['baiduspider-123-125-66-120.crawl.baidu.com']);
    const lookup = jest.fn(async () => [{ address: '123.125.66.120' }]);
    const verifier = make({}, { reverse, lookup });
    verifier.check('Baiduspider', trusted('123.125.66.120'));
    await complete();
    expect(verifier.check('Baiduspider', trusted('123.125.66.120'))).toBe('verified');
    reverse.mockResolvedValueOnce(['baidu.com.attacker.example']);
    verifier.check('Baiduspider', trusted('8.8.8.8'));
    await complete();
    expect(verifier.check('Baiduspider', trusted('8.8.8.8'))).toBe('verification_failed');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  test('closing before scheduled work starts prevents external requests', async () => {
    const fetch = jest.fn();
    const verifier = make({}, { fetch });
    verifier.check('GPTBot', trusted());
    verifier.close();
    await complete();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('Anthropic claims share their official provider feed but nonmatches stay unverified', async () => {
    const fetch = jest.fn(async () => jsonFeed(['216.73.216.0/22']));
    const verifier = make({}, { fetch });
    verifier.check('ClaudeBot', trusted('216.73.217.1'));
    verifier.check('Claude-User', trusted('8.8.8.8'));
    await complete();
    expect(verifier.check('ClaudeBot', trusted('216.73.217.1'))).toBe('verified');
    expect(verifier.check('Claude-User', trusted('8.8.8.8'))).toBe('unverified');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://claude.com/crawling/bots.json');
  });

  test.each([
    [{ ip: '66.249.66.1', identityConfidence: 'proxy' }],
    [{ ip: null, identityConfidence: 'unresolved' }],
    [trusted('127.0.0.1')], [trusted('10.1.2.3')], [trusted('169.254.169.254')],
    [trusted('::1')], [trusted('2001:db8::1')], [trusted('https://attacker.example')]
  ])('never verifies unreliable or nonpublic network identities: %j', (network) => {
    const fetch = jest.fn();
    const reverse = jest.fn();
    const verifier = make({}, { fetch, reverse });
    expect(verifier.check('Googlebot', network)).toBe('verification_unavailable');
    expect(fetch).not.toHaveBeenCalled();
    expect(reverse).not.toHaveBeenCalled();
  });

  test('disabled and unsupported bots do not contact providers', async () => {
    const fetch = jest.fn();
    const disabled = make({ enableBotVerification: false }, { fetch });
    expect(disabled.check('Googlebot', trusted())).toBe('unverified');
    const verifier = make({}, { fetch });
    expect(verifier.check(null, trusted())).toBe('not_applicable');
    expect(verifier.check('Twitterbot', trusted())).toBe('unverified');
    expect(verifier.check('https://attacker.example', trusted())).toBe('unverified');
    await complete();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('validates the exact DNS suffix and forward-confirmed address', async () => {
    const reverse = jest.fn(async () => ['msnbot-157-55-39-1.search.msn.com.']);
    const lookup = jest.fn(async () => [{ address: '157.55.39.1' }]);
    const verifier = make({}, { reverse, lookup });
    expect(verifier.check('Bingbot', trusted('157.55.39.1'))).toBe('verification_unavailable');
    await complete();
    expect(verifier.check('Bingbot', trusted('157.55.39.1'))).toBe('verified');
    expect(lookup).toHaveBeenCalledWith('msnbot-157-55-39-1.search.msn.com', { all: true });
  });

  test.each(['search.msn.com.attacker.example', 'evilsearch.msn.com', 'search.msn.com@attacker.example', '-bad.search.msn.com'])('rejects spoofed DNS suffix %s before forward lookup', async (name) => {
    const lookup = jest.fn();
    const verifier = make({}, { reverse: async () => [name], lookup });
    verifier.check('Bingbot', trusted('8.8.8.8'));
    await complete();
    expect(verifier.check('Bingbot', trusted('8.8.8.8'))).toBe('verification_failed');
    expect(lookup).not.toHaveBeenCalled();
  });

  test('a valid provider hostname must resolve back to the original address', async () => {
    const verifier = make({}, { reverse: async () => ['crawler.yandex.net'], lookup: async () => [{ address: '8.8.4.4' }] });
    verifier.check('YandexBot', trusted('8.8.8.8'));
    await complete();
    expect(verifier.check('YandexBot', trusted('8.8.8.8'))).toBe('verification_failed');
  });

  test.each([
    async () => { throw new Error('PRIVATE_NETWORK_EXCEPTION'); },
    async () => new Response('unavailable', { status: 503 }),
    async () => new Response('{invalid json'),
    async () => new Response(JSON.stringify({ prefixes: [{ ipv4Prefix: 'not-a-range' }] })),
    async () => new Response('x'.repeat(1024 * 1024 + 1))
  ])('provider failure becomes unavailable, not an identity mismatch', async (fetch) => {
    const verifier = make({}, { fetch });
    verifier.check('GPTBot', trusted());
    await complete();
    expect(verifier.check('GPTBot', trusted())).toBe('verification_unavailable');
  });

  test('DNS outage is unavailable rather than failed identity', async () => {
    const verifier = make({}, { reverse: async () => { throw new Error('DNS down'); } });
    verifier.check('Bingbot', trusted());
    await complete();
    expect(verifier.check('Bingbot', trusted())).toBe('verification_unavailable');
  });

  test('provider outage cooldown prevents fresh source IPs from refetching on every request', async () => {
    let now = 0;
    const fetch = jest.fn(async () => { throw new Error('Provider down'); });
    const verifier = make({}, { fetch, now: () => now });
    verifier.check('GPTBot', trusted());
    await complete();
    verifier.check('GPTBot', trusted('8.8.8.8'));
    await complete();
    expect(fetch).toHaveBeenCalledTimes(1);
    now = 30001;
    verifier.check('GPTBot', trusted('8.8.4.4'));
    await complete();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('times out hung verification, aborts its request and applies an outage cooldown', async () => {
    jest.useFakeTimers();
    let signal;
    const fetch = jest.fn((_url, options) => { signal = options.signal; return new Promise(() => {}); });
    const verifier = make({ botVerificationTimeoutMs: 50 }, { fetch });
    verifier.check('GPTBot', trusted());
    await jest.advanceTimersByTimeAsync(51);
    expect(signal.aborted).toBe(true);
    expect(verifier.check('GPTBot', trusted())).toBe('verification_unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('limits background concurrency without an unbounded queue', async () => {
    const reverse = jest.fn(() => new Promise(() => {}));
    const verifier = make({}, { reverse });
    for (let i = 1; i <= 30; i++) verifier.check('Bingbot', trusted(`8.8.8.${i}`));
    await complete();
    expect(reverse).toHaveBeenCalledTimes(4);
    verifier.close();
    expect(verifier.check('Bingbot', trusted())).toBe('unverified');
  });

  test('caps result cache and expires results and official feeds', async () => {
    let now = 0;
    const fetch = jest.fn(async () => jsonFeed());
    const verifier = make({ botVerificationCacheMaxEntries: 1, botVerificationCacheTtlMs: 100 }, { fetch, now: () => now });
    verifier.check('Googlebot', trusted());
    await complete();
    expect(verifier.check('Googlebot', trusted())).toBe('verified');
    verifier.check('Googlebot', trusted('66.249.66.2'));
    await complete();
    expect(verifier.check('Googlebot', trusted())).toBe('verification_unavailable');
    await complete();
    expect(fetch).toHaveBeenCalledTimes(1);
    now = 101;
    expect(verifier.check('Googlebot', trusted())).toBe('verification_unavailable');
    await complete();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(verifier.check('Googlebot', trusted())).toBe('verified');
  });
});
