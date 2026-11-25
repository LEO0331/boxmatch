const { normalizeIp, isPublicIp } = require('./clientIp');
const { Resolver } = require('node:dns').promises;

// Only operator-reviewed provider URLs appear here. Headers never choose a URL.
const PROVIDERS = Object.freeze({
  Googlebot: { url: 'https://developers.google.com/static/crawling/ipranges/common-crawlers.json' },
  DuckDuckBot: { url: 'https://duckduckgo.com/duckduckbot.json' },
  GPTBot: { url: 'https://openai.com/gptbot.json' },
  'OAI-SearchBot': { url: 'https://openai.com/searchbot.json' },
  'ChatGPT-User': { url: 'https://openai.com/chatgpt-user.json' },
  ClaudeBot: { url: 'https://claude.com/crawling/bots.json', partial: true },
  'Claude-SearchBot': { url: 'https://claude.com/crawling/bots.json', partial: true },
  'Claude-User': { url: 'https://claude.com/crawling/bots.json', partial: true },
  PerplexityBot: { url: 'https://www.perplexity.ai/perplexitybot.json' },
  Discordbot: { url: 'https://cdn.discordapp.com/ipranges/discord.json' },
  Bingbot: { suffixes: ['search.msn.com'] },
  Baiduspider: { suffixes: ['baidu.com', 'baidu.jp'] },
  YandexBot: { suffixes: ['yandex.ru', 'yandex.net', 'yandex.com'] }
});

function parseIp(input) {
  input = normalizeIp(input);
  if (!input) return null;
  if (input.includes('.')) {
    return { bits: 32, value: input.split('.').reduce((n, part) => (n << 8n) | BigInt(part), 0n) };
  }
  const halves = input.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const parts = halves.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  const value = parts.reduce((n, part) => (n << 16n) | BigInt(`0x${part}`), 0n);
  return { bits: 128, value };
}

function compileCidr(cidr) {
  if (typeof cidr !== 'string' || cidr.length > 49) return null;
  const [base, prefix, extra] = cidr.split('/');
  if (extra != null || !/^\d{1,3}$/.test(prefix || '')) return null;
  const range = parseIp(base);
  const length = Number(prefix);
  if (!range || length > range.bits) return null;
  const shift = BigInt(range.bits - length);
  return { bits: range.bits, shift, prefix: range.value >> shift };
}

function matchesRange(address, range) {
  return Boolean(address && range && address.bits === range.bits && address.value >> range.shift === range.prefix);
}

function ipInCidr(ip, cidr) {
  return matchesRange(parseIp(ip), compileCidr(cidr));
}

function validHostname(host, suffixes) {
  if (typeof host !== 'string' || host.length > 253) return false;
  const normalized = host.toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(normalized) ||
      normalized.split('.').some((label) => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) return false;
  return suffixes.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`));
}

function boundedInteger(value, fallback, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}

function createBotVerifier(config = {}, dependencies = {}) {
  const enabled = config.enableBotVerification === true;
  const timeoutMs = boundedInteger(config.botVerificationTimeoutMs, 2000, 10, 10000);
  const maxEntries = boundedInteger(config.botVerificationCacheMaxEntries, 1000, 1, 10000);
  const ttlMs = boundedInteger(config.botVerificationCacheTtlMs, 3600000, 100, 86400000);
  const now = dependencies.now || Date.now;
  const fetch = dependencies.fetch || global.fetch;
  const results = new Map();
  const pending = new Map();
  const feeds = new Map();
  const feedPending = new Map();
  const controllers = new Set();
  const resolvers = new Set();
  let closed = false;

  function cacheResult(key, status) {
    if (closed) return;
    if (!results.has(key) && results.size >= maxEntries) results.delete(results.keys().next().value);
    // Outages have a short cooldown, without converting them to identity failures.
    results.set(key, { status, until: now() + (status === 'verification_unavailable' ? Math.min(ttlMs, 30000) : ttlMs) });
  }

  async function readFeed(url, signal) {
    if (closed || signal.aborted) throw new Error('Verification stopped');
    const cached = feeds.get(url);
    if (cached && cached.until > now()) {
      if (cached.unavailable) throw new Error('Provider cooldown');
      return cached.prefixes;
    }
    if (feedPending.has(url)) return feedPending.get(url);
    const promise = (async () => {
      const response = await fetch(url, { signal, redirect: 'error', headers: { accept: 'application/json' } });
      if (!response.ok || !response.body) throw new Error('Provider unavailable');
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 1024 * 1024) throw new Error('Provider response too large');
          chunks.push(Buffer.from(part.value));
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Array.isArray(data.prefixes) || !data.prefixes.length || data.prefixes.length > 20000) throw new Error('Invalid provider data');
      const prefixes = data.prefixes.map((entry) => compileCidr(entry?.ipv4Prefix || entry?.ipv6Prefix));
      if (prefixes.some((range) => !range)) throw new Error('Invalid provider CIDR');
      if (!closed && !signal.aborted) feeds.set(url, { prefixes, until: now() + ttlMs });
      return prefixes;
    })().catch((error) => {
      // Share provider outages across new IPs as well as repeat requests.
      if (!closed) feeds.set(url, { unavailable: true, until: now() + Math.min(ttlMs, 30000) });
      throw error;
    });
    feedPending.set(url, promise);
    try { return await promise; }
    finally { feedPending.delete(url); }
  }

  async function verifyDns(ip, suffixes, resolver) {
    const reverse = dependencies.reverse || ((address) => resolver.reverse(address));
    const forward = dependencies.lookup || (async (host) => {
      const answers = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
      const addresses = answers.filter((answer) => answer.status === 'fulfilled').flatMap((answer) => answer.value);
      if (!addresses.length && answers.some((answer) => answer.status === 'rejected' && !['ENODATA', 'ENOTFOUND'].includes(answer.reason?.code))) {
        throw new Error('DNS unavailable');
      }
      return addresses.map((address) => ({ address }));
    });
    const names = await reverse(ip);
    if (!Array.isArray(names) || names.length > 32) throw new Error('Invalid DNS answer');
    const allowed = names.filter((name) => validHostname(name, suffixes)).slice(0, 4);
    if (!allowed.length) return 'verification_failed';
    const source = parseIp(ip);
    for (const name of allowed) {
      const answers = await forward(name.toLowerCase().replace(/\.$/, ''), { all: true });
      if (!Array.isArray(answers) || answers.length > 100) throw new Error('Invalid DNS answer');
      if (answers.some((answer) => {
        const parsed = parseIp(typeof answer === 'string' ? answer : answer?.address);
        return parsed && parsed.bits === source.bits && parsed.value === source.value;
      })) return 'verified';
    }
    return 'verification_failed';
  }

  async function verify(provider, ip) {
    if (closed) return 'verification_unavailable';
    const controller = new AbortController();
    const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
    controllers.add(controller);
    resolvers.add(resolver);
    let timeout;
    try {
      const address = parseIp(ip);
      const work = provider.url
        ? readFeed(provider.url, controller.signal).then((prefixes) => prefixes.some((range) => matchesRange(address, range))
          ? 'verified' : provider.partial ? 'unverified' : 'verification_failed')
        : verifyDns(ip, provider.suffixes, resolver);
      return await Promise.race([work, new Promise((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); resolver.cancel(); reject(new Error('Verification timed out')); }, timeoutMs);
        timeout.unref?.();
      })]);
    } catch (_) {
      return 'verification_unavailable';
    } finally {
      clearTimeout(timeout);
      controller.abort();
      resolver.cancel();
      controllers.delete(controller);
      resolvers.delete(resolver);
    }
  }

  return {
    check(claimedBot, network = {}) {
      if (!claimedBot) return 'not_applicable';
      if (typeof claimedBot !== 'string') return 'unverified';
      const provider = Object.hasOwn(PROVIDERS, claimedBot) ? PROVIDERS[claimedBot] : null;
      if (!provider || !enabled || closed) return 'unverified';
      if (network.identityConfidence !== 'trusted' || !isPublicIp(network.ip)) return 'verification_unavailable';
      const address = parseIp(network.ip);
      const key = `${claimedBot}|${address.bits}|${address.value}`;
      const cached = results.get(key);
      if (cached && cached.until > now()) return cached.status;
      if (cached) results.delete(key);
      if (pending.has(key) || pending.size >= 4) return 'verification_unavailable';
      // No queue: load shedding keeps work bounded even under a stream of new IPs.
      const task = Promise.resolve().then(() => verify(provider, network.ip))
        .then((status) => cacheResult(key, status))
        .catch(() => cacheResult(key, 'verification_unavailable'))
        .finally(() => pending.delete(key));
      pending.set(key, task);
      return 'verification_unavailable';
    },
    close() {
      closed = true;
      for (const controller of controllers) controller.abort();
      for (const resolver of resolvers) resolver.cancel();
      results.clear();
      feeds.clear();
    }
  };
}

module.exports = { createBotVerifier, ipInCidr, isPublicIp };
