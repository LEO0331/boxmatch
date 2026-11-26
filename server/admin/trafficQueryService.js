const { dayRange } = require('../../scripts/export_traffic_csv');
const { ENUMS, emptyDaily } = require('../observability/trafficAggregator');
const { isCountryCode } = require('../observability/geoResolver');

const API_COUNTERS = ['totalRequests', 'success', 'clientErrors', 'serverErrors', 'aborted', 'rateLimited'];
const API_DIMENSIONS = ['classifications', 'riskLevels', 'verificationStatuses', 'sourceChannels', 'countries', 'asns', 'identityConfidence', 'geoStatuses'];
const WEBSITE_DIMENSIONS = ['pages', 'channels', 'campaignSources', 'campaignMediums', 'browsers', 'operatingSystems', 'countries', 'asns', 'identityConfidence', 'geoStatuses'];
const MAX_CACHE_BYTES = 16 * 1024 * 1024;

function failure(status, code) {
  return Object.assign(new Error(code), { status, code });
}

function bounded(value, fallback, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}

function normalizePeriod(query = {}, config = {}, now = Date.now()) {
  if (!query || typeof query !== 'object' || Array.isArray(query) ||
      Object.keys(query).some((key) => key !== 'days')) throw failure(400, 'TRAFFIC_ADMIN_QUERY_INVALID');
  const raw = query.days ?? '7';
  const maximum = bounded(config.trafficAdminMaxQueryDays, 90, 1, 90);
  if ((typeof raw !== 'string' && typeof raw !== 'number') || !/^\d{1,2}$/.test(String(raw))) {
    throw failure(400, 'TRAFFIC_ADMIN_QUERY_INVALID');
  }
  const days = Number(raw);
  if (days < 1 || days > maximum) throw failure(400, 'TRAFFIC_ADMIN_QUERY_INVALID');
  const keys = dayRange(days, now);
  return { startDate: keys[0], endDate: keys[keys.length - 1], timezone: 'UTC', days,
    keys, cacheKey: `${keys[0]}:${keys[keys.length - 1]}` };
}

function safeCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_COUNTER');
  return value;
}

function sum(values) {
  const value = values.reduce((total, item) => total + BigInt(safeCount(item)), 0n);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('COUNTER_OVERFLOW');
  return Number(value);
}

function validDimensionKey(name, key) {
  if (key === 'unknown' || key === 'other') return name === 'countries' || name === 'asns' || ENUMS[name]?.includes(key);
  if (name === 'countries') return isCountryCode(key);
  if (name === 'asns') return /^[1-9]\d{0,9}$/.test(key) && Number(key) <= 4294967295;
  return ENUMS[name]?.includes(key) || false;
}

function dimension(name, input, total) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_DIMENSION');
  const entries = Object.entries(input);
  const maximumEntries = name === 'asns' ? 102 : name === 'countries' ? 252 : ENUMS[name].length;
  if (entries.length > maximumEntries) throw new Error('INVALID_DIMENSION');
  const result = { unknown: 0, ...(['countries', 'asns'].includes(name) ? { other: 0 } : {}) };
  for (const [key, value] of entries) {
    if (!validDimensionKey(name, key)) throw new Error('INVALID_DIMENSION');
    result[key] = safeCount(value);
  }
  if (sum(Object.values(result)) !== total) throw new Error('INCONSISTENT_DIMENSION');
  return result;
}

function updatedAt(value, now) {
  try {
    const date = value && typeof value.toDate === 'function' ? value.toDate() : value;
    if (!(date instanceof Date) && typeof date !== 'string') return null;
    const time = new Date(date).getTime();
    return Number.isFinite(time) && time <= now + 60000 ? new Date(time).toISOString() : null;
  } catch (_) { return null; }
}

function sanitizeDay(date, raw, now) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { date, status: 'invalid', data: null };
  if (raw.schemaVersion !== 1) return { date, status: 'unsupported', data: null };
  try {
    if (raw.dayKey !== date) throw new Error('INVALID_DAY');
    const output = emptyDaily(date);
    for (const key of API_COUNTERS) output.api[key] = safeCount(raw.api?.[key]);
    const api = output.api;
    if (sum([api.success, api.clientErrors, api.serverErrors, api.aborted]) !== api.totalRequests ||
        api.rateLimited > api.clientErrors) throw new Error('INCONSISTENT_COUNTERS');
    output.website.pageViews = safeCount(raw.website?.pageViews);
    for (const name of API_DIMENSIONS) output.api[name] = dimension(name, raw.api?.[name], api.totalRequests);
    for (const name of WEBSITE_DIMENSIONS) output.website[name] = dimension(name, raw.website?.[name], output.website.pageViews);
    output.updatedAt = updatedAt(raw.updatedAt, now);
    return { date, status: 'available', data: output };
  } catch (_) {
    return { date, status: 'invalid', data: null };
  }
}

function mergeSection(left, right, scalars, dimensions) {
  const result = {};
  for (const name of scalars) result[name] = sum([left[name], right[name]]);
  for (const name of dimensions) {
    result[name] = { ...left[name] };
    for (const [key, amount] of Object.entries(right[name])) result[name][key] = sum([result[name][key] || 0, amount]);
  }
  return result;
}

function sortedDimension(input, limit) {
  const entries = Object.entries(input).filter(([key]) => !['other', 'unknown'].includes(key))
    .sort(([a, av], [b, bv]) => bv - av || (a < b ? -1 : a > b ? 1 : 0));
  const kept = limit ? entries.slice(0, limit) : entries;
  const result = Object.fromEntries(kept);
  result.unknown = input.unknown || 0;
  if (Object.hasOwn(input, 'other')) result.other = sum([input.other, ...entries.slice(limit || entries.length).map(([, value]) => value)]);
  return result;
}

function percent(numerator, denominator) {
  return denominator ? Math.round(numerator / denominator * 10000) / 100 : null;
}

function buildSnapshot(period, records, config, now) {
  let api = emptyDaily(period.endDate).api;
  let website = emptyDaily(period.endDate).website;
  const issues = new Set();
  const days = records.map((record) => {
    if (record.status !== 'available') return record;
    try {
      const nextApi = mergeSection(api, record.data.api, API_COUNTERS, API_DIMENSIONS);
      const nextWebsite = mergeSection(website, record.data.website, ['pageViews'], WEBSITE_DIMENSIONS);
      api = nextApi;
      website = nextWebsite;
      if (!record.data.updatedAt) issues.add('MISSING_UPDATE_TIME');
      return record;
    } catch (_) {
      issues.add('COUNTER_OVERFLOW');
      return { date: record.date, status: 'invalid', data: null };
    }
  });
  const countStatus = (status) => days.filter((record) => record.status === status).length;
  const availableDays = countStatus('available');
  const missingDays = countStatus('missing');
  const invalidDays = countStatus('invalid');
  const unsupportedDays = countStatus('unsupported');
  if (missingDays) issues.add('MISSING_DAYS');
  if (invalidDays) issues.add('INVALID_DAYS');
  if (unsupportedDays) issues.add('UNSUPPORTED_SCHEMA');
  const updates = days.map((record) => record.data?.updatedAt).filter(Boolean).sort();
  const lastPersistedAt = updates.length ? updates[updates.length - 1] : null;
  for (const [section, dimensions] of [[api, API_DIMENSIONS], [website, WEBSITE_DIMENSIONS]]) {
    for (const name of dimensions) section[name] = sortedDimension(section[name], ['countries', 'asns'].includes(name) ? 50 : null);
  }
  const errors = sum([api.clientErrors, api.serverErrors]);
  const knownCountry = (section) => sum(Object.entries(section.countries)
    .filter(([key]) => key !== 'unknown').map(([, value]) => value));
  const apiKnownCountryRate = percent(knownCountry(api), api.totalRequests);
  const websiteKnownCountryRate = percent(knownCountry(website), website.pageViews);
  const observed = (value) => availableDays ? value : null;
  const threshold = Math.max(900000, bounded(config.trafficFlushIntervalMs, 300000, 60000, 3600000) * 3);
  return {
    overview: {
      schemaVersion: 1,
      period: { startDate: period.startDate, endDate: period.endDate, timezone: 'UTC' },
      coverage: { requestedDays: period.days, availableDays, missingDays, invalidDays, unsupportedDays, lastPersistedAt },
      summary: {
        websitePageViews: observed(website.pageViews), apiRequests: observed(api.totalRequests), apiSuccess: observed(api.success),
        apiSuccessRate: percent(api.success, api.totalRequests), apiErrors: observed(errors), apiErrorRate: percent(errors, api.totalRequests),
        suspiciousRequests: observed(api.riskLevels.suspicious || 0), highRiskRequests: observed(api.riskLevels.high || 0),
        verifiedBotRequests: observed(api.verificationStatuses.verified || 0), apiKnownCountryRate, websiteKnownCountryRate
      },
      dailyTrends: days.map(({ date, status, data }) => ({ date, status, available: status === 'available',
        pageViews: data?.website.pageViews ?? null, apiRequests: data?.api.totalRequests ?? null,
        apiSuccess: data?.api.success ?? null, clientErrors: data?.api.clientErrors ?? null,
        serverErrors: data?.api.serverErrors ?? null, aborted: data?.api.aborted ?? null,
        suspicious: data ? data.api.riskLevels.suspicious || 0 : null, highRisk: data ? data.api.riskLevels.high || 0 : null })),
      api, website,
      network: { apiKnownCountryRate, websiteKnownCountryRate },
      dataQuality: {
        stale: lastPersistedAt ? now - Date.parse(lastPersistedAt) > threshold : null,
        currentDayPartial: true,
        flags: { requestIntelligence: config.enableRequestIntelligence === true,
          botVerification: config.enableBotVerification === true, trafficAdmin: config.enableTrafficAdmin === true,
          frontendTelemetry: config.enableFrontendTelemetry === true,
          geoEnrichment: config.enableGeoEnrichment === true, trafficAggregation: config.enableTrafficAggregation === true },
        issues: [...issues].sort()
      }
    },
    days
  };
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function createTrafficQueryService(config = {}, { db, now = Date.now } = {}) {
  const ttl = bounded(config.trafficAdminCacheTtlMs, 60000, 1000, 300000);
  const maximum = bounded(config.trafficAdminCacheMaxEntries, 32, 1, 32);
  const concurrency = bounded(config.trafficAdminQueryConcurrency, 2, 1, 2);
  const timeoutMs = bounded(config.trafficAdminQueryTimeoutMs, 5000, 10, 10000);
  const budget = bounded(config.trafficAdminReadBudgetPerDay, 3000, 1, 10000);
  const cache = new Map();
  const pending = new Map();
  let cacheBytes = 0;
  let budgetDate = '';
  let reservedReads = 0;

  function removeCache(key) {
    const entry = cache.get(key);
    if (entry) cacheBytes -= entry.bytes;
    cache.delete(key);
  }

  function normalizeQuery(query) { return normalizePeriod(query, config, now()); }

  function getSnapshot(query) {
    let period;
    try { period = normalizeQuery(query); } catch (error) { return Promise.reject(error); }
    const cached = cache.get(period.cacheKey);
    if (cached && cached.until > now()) {
      cache.delete(period.cacheKey); cache.set(period.cacheKey, cached);
      return Promise.resolve(cached.value);
    }
    if (cached) removeCache(period.cacheKey);
    if (pending.has(period.cacheKey)) return pending.get(period.cacheKey).response;
    if (pending.size >= concurrency) return Promise.reject(failure(429, 'TRAFFIC_ADMIN_QUERY_CAPACITY'));
    if (budgetDate !== period.endDate) { budgetDate = period.endDate; reservedReads = 0; }
    if (reservedReads + period.days > budget) return Promise.reject(failure(429, 'TRAFFIC_ADMIN_READ_BUDGET_EXHAUSTED'));
    // Reserve the complete range before work, including missing documents and
    // reads that may fail or time out. There are no application-level retries.
    reservedReads += period.days;
    const state = { expired: false, response: null };
    let timer;
    const work = (async () => {
      const records = [];
      const append = (date, doc) => records.push(doc.exists
        ? sanitizeDay(date, doc.data(), now()) : { date, status: 'missing', data: null });
      if (typeof db.getAll === 'function') {
        // Bound each RPC while avoiding ninety sequential network round trips.
        // Each document still consumes its own reserved read, including misses.
        for (let offset = 0; offset < period.keys.length; offset += 15) {
          if (state.expired) throw failure(503, 'TRAFFIC_ADMIN_QUERY_TIMEOUT');
          const dates = period.keys.slice(offset, offset + 15);
          const docs = await db.getAll(...dates.map((date) => db.collection('traffic_daily').doc(date)));
          if (!Array.isArray(docs) || docs.length !== dates.length) throw new Error('INVALID_BATCH');
          const byDate = new Map(docs.map((doc) => [doc.id, doc]));
          if (byDate.size !== dates.length || dates.some((date) => !byDate.has(date))) throw new Error('INVALID_BATCH');
          for (const date of dates) append(date, byDate.get(date));
        }
      } else {
        // Small test doubles and other Firestore-compatible adapters may expose
        // only document.get(); keep the same bounded sequential behavior there.
        for (const date of period.keys) {
          if (state.expired) throw failure(503, 'TRAFFIC_ADMIN_QUERY_TIMEOUT');
          append(date, await db.collection('traffic_daily').doc(date).get());
        }
      }
      if (state.expired) throw failure(503, 'TRAFFIC_ADMIN_QUERY_TIMEOUT');
      const value = freeze(buildSnapshot(period, records, config, now()));
      const bytes = Buffer.byteLength(JSON.stringify(value));
      if (bytes > 4 * 1024 * 1024) throw failure(503, 'TRAFFIC_ADMIN_RESPONSE_TOO_LARGE');
      while (cache.size && (cache.size >= maximum || cacheBytes + bytes > MAX_CACHE_BYTES)) removeCache(cache.keys().next().value);
      cache.set(period.cacheKey, { value, bytes, until: now() + ttl });
      cacheBytes += bytes;
      return value;
    })().catch((error) => { throw error.status ? error : failure(503, 'TRAFFIC_ADMIN_QUERY_UNAVAILABLE'); });
    state.response = Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => { state.expired = true; reject(failure(503, 'TRAFFIC_ADMIN_QUERY_TIMEOUT')); }, timeoutMs);
      timer.unref?.();
    })]);
    pending.set(period.cacheKey, state);
    // A timeout cannot cancel Firestore's underlying read. Keep its concurrency
    // slot until it settles, and do not start more reads or cache late results.
    work.finally(() => { clearTimeout(timer); pending.delete(period.cacheKey); }).catch(() => {});
    return state.response;
  }

  return { normalizeQuery, getSnapshot, async getOverview(query) { return (await getSnapshot(query)).overview; },
    get reservedReads() { return reservedReads; }, get cacheSize() { return cache.size; }, get pendingSize() { return pending.size; } };
}

module.exports = { createTrafficQueryService, normalizePeriod, sanitizeDay };
