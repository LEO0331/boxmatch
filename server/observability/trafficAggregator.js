const ENUMS = Object.freeze({
  classifications: ['likely_human', 'search_engine_crawler', 'ai_crawler', 'social_media_crawler', 'automated_api_client', 'suspected_scraper', 'suspected_security_scanner', 'unknown'],
  riskLevels: ['low', 'suspicious', 'high', 'unknown'],
  verificationStatuses: ['verified', 'unverified', 'verification_failed', 'verification_unavailable', 'not_applicable', 'unknown'],
  sourceChannels: ['search_referral', 'social_referral', 'github_referral', 'same_origin', 'external_referral', 'direct_or_unknown', 'unknown'],
  pages: ['home', 'listing_feed', 'map', 'listing_detail', 'enterprise_post', 'enterprise_edit', 'reservation', 'my_reservations', 'unknown'],
  channels: ['organic_search', 'social_referral', 'github_referral', 'ai_referral', 'campaign_referral', 'external_referral', 'internal_navigation', 'direct_or_unknown', 'unknown'],
  campaignSources: ['google', 'bing', 'duckduckgo', 'facebook', 'instagram', 'linkedin', 'reddit', 'github', 'chatgpt', 'perplexity', 'claude', 'other', 'unknown'],
  campaignMediums: ['organic', 'social', 'referral', 'email', 'cpc', 'paid_social', 'other', 'unknown'],
  browsers: ['Chrome', 'Edge', 'Firefox', 'Safari', 'Opera', 'unknown'],
  operatingSystems: ['Windows', 'macOS', 'Linux', 'Android', 'iOS', 'Chrome OS', 'unknown'],
  identityConfidence: ['trusted', 'proxy', 'unresolved', 'unknown'],
  geoStatuses: ['resolved', 'not_found', 'unavailable', 'disabled', 'unknown']
});

const API_SCALARS = ['totalRequests', 'success', 'clientErrors', 'serverErrors', 'aborted', 'rateLimited'];
const API_DIMENSIONS = ['classifications', 'riskLevels', 'verificationStatuses', 'sourceChannels', 'countries', 'asns', 'identityConfidence', 'geoStatuses'];
const WEBSITE_DIMENSIONS = ['pages', 'channels', 'campaignSources', 'campaignMediums', 'browsers', 'operatingSystems', 'countries', 'asns', 'identityConfidence', 'geoStatuses'];

function limit(value, fallback, maximum) {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function add(left, right) {
  return Math.min(Number.MAX_SAFE_INTEGER, count(left) + count(right));
}

function dayKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && dayKey(value) === value;
}

function emptyDaily(key) {
  const api = Object.fromEntries(API_SCALARS.map((name) => [name, 0]));
  for (const name of API_DIMENSIONS) api[name] = { unknown: 0, ...(name === 'countries' || name === 'asns' ? { other: 0 } : {}) };
  const website = { pageViews: 0 };
  for (const name of WEBSITE_DIMENSIONS) website[name] = { unknown: 0, ...(name === 'countries' || name === 'asns' ? { other: 0 } : {}) };
  return { schemaVersion: 1, dayKey: key, api, website };
}

function dimensionKey(name, value) {
  if (name === 'countries') return typeof value === 'string' && /^[A-Z]{2}$/.test(value) ? value : ['other', 'unknown'].includes(value) ? value : 'unknown';
  if (name === 'asns') {
    const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : null;
    return Number.isSafeInteger(number) && number > 0 && number <= 4294967295 ? String(number) : ['other', 'unknown'].includes(value) ? value : 'unknown';
  }
  return ENUMS[name]?.includes(value) ? value : 'unknown';
}

function mergeDimension(name, existing, incoming, maximum) {
  const result = { unknown: 0, ...(name === 'countries' || name === 'asns' ? { other: 0 } : {}) };
  let cardinality = 0;
  for (const input of [existing, incoming]) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) continue;
    // Only bounded, schema-selected dimensions enter snapshots or persistence.
    for (const [rawKey, rawCount] of Object.entries(input)) {
      const amount = count(rawCount);
      if (!amount) continue;
      let key = dimensionKey(name, rawKey);
      if (maximum && key !== 'unknown' && key !== 'other' && !Object.hasOwn(result, key)) {
        if (cardinality >= maximum) key = 'other';
        else cardinality++;
      }
      result[key] = add(result[key], amount);
    }
  }
  return result;
}

// Reused at the transaction boundary so several instances cannot grow persisted
// ASN/country maps beyond the same limits enforced in memory.
function mergeDailyData(existing, delta, config = {}) {
  const key = validDay(delta?.dayKey) ? delta.dayKey : existing?.dayKey;
  if (!validDay(key)) throw new Error('Invalid traffic day');
  const result = emptyDaily(key);
  for (const name of API_SCALARS) result.api[name] = add(existing?.api?.[name], delta?.api?.[name]);
  result.website.pageViews = add(existing?.website?.pageViews, delta?.website?.pageViews);
  for (const [section, dimensions] of [['api', API_DIMENSIONS], ['website', WEBSITE_DIMENSIONS]]) {
    for (const name of dimensions) {
      const maximum = name === 'asns' ? limit(config.trafficMaxAsnBuckets, 100, 100) : name === 'countries' ? limit(config.trafficMaxCountryBuckets, 100, 250) : null;
      result[section][name] = mergeDimension(name, existing?.[section]?.[name], delta?.[section]?.[name], maximum);
    }
  }
  return result;
}

function createTrafficAggregator(config = {}, { now = Date.now } = {}) {
  const enabled = config.enableTrafficAggregation === true;
  const maxDays = limit(config.trafficMaxPendingDays, 3, 7);
  const days = new Map();
  let droppedEvents = 0;

  function bucket(timestamp) {
    const current = dayKey(now());
    const key = dayKey(timestamp ?? now());
    const oldest = new Date(`${current}T00:00:00Z`).getTime() - (maxDays - 1) * 86400000;
    if (!key || key > current || new Date(`${key}T00:00:00Z`).getTime() < oldest) {
      droppedEvents++;
      return null;
    }
    for (const [day, entry] of days) {
      if (day < dayKey(oldest) && !entry.inFlight) days.delete(day);
    }
    let entry = days.get(key);
    if (!entry) {
      if (days.size >= maxDays) { droppedEvents++; return null; }
      entry = { data: emptyDaily(key), inFlight: null };
      days.set(key, entry);
    }
    return entry;
  }

  function increment(entry, section, dimension, value) {
    const key = dimensionKey(dimension, value);
    // Bounded admission is cheap for the two high-cardinality maps; fixed enum
    // maps cannot grow from caller-provided strings.
    const maximum = dimension === 'asns' ? limit(config.trafficMaxAsnBuckets, 100, 100) : dimension === 'countries' ? limit(config.trafficMaxCountryBuckets, 100, 250) : null;
    entry.data[section][dimension] = mergeDimension(dimension, entry.data[section][dimension], { [key]: 1 }, maximum);
  }

  function networkDimensions(entry, section, network = {}) {
    const resolved = network.identityConfidence === 'trusted' && network.geoStatus === 'resolved';
    increment(entry, section, 'countries', resolved ? network.country : null);
    increment(entry, section, 'asns', resolved ? network.asn : null);
    increment(entry, section, 'identityConfidence', network.identityConfidence);
    increment(entry, section, 'geoStatuses', network.geoStatus);
  }

  return {
    recordApi(event = {}) {
      if (!enabled || event.telemetry || event.preflight ||
          (event.path === '/health' && ['GET', 'HEAD'].includes(event.method)) ||
          (typeof event.path === 'string' && /^\/telemetry\/visit\/?$/i.test(event.path))) return false;
      const entry = bucket(event.ts);
      if (!entry) return false;
      const api = entry.data.api;
      api.totalRequests = add(api.totalRequests, 1);
      if (event.aborted) api.aborted = add(api.aborted, 1);
      else if (event.status >= 200 && event.status < 400) api.success = add(api.success, 1);
      else if (event.status >= 400 && event.status < 500) api.clientErrors = add(api.clientErrors, 1);
      else api.serverErrors = add(api.serverErrors, 1);
      if (event.status === 429) api.rateLimited = add(api.rateLimited, 1);
      increment(entry, 'api', 'classifications', event.security?.classification);
      increment(entry, 'api', 'riskLevels', event.security?.riskLevel);
      increment(entry, 'api', 'verificationStatuses', event.security?.verificationStatus);
      increment(entry, 'api', 'sourceChannels', event.source?.channel);
      networkDimensions(entry, 'api', event.network);
      return true;
    },
    recordVisit(event = {}) {
      if (!enabled) return false;
      const entry = bucket(event.ts);
      if (!entry) return false;
      entry.data.website.pageViews = add(entry.data.website.pageViews, 1);
      for (const [dimension, value] of [['pages', event.page], ['channels', event.acquisitionChannel],
        ['campaignSources', event.campaignSource], ['campaignMediums', event.campaignMedium],
        ['browsers', event.client?.browser], ['operatingSystems', event.client?.os]]) increment(entry, 'website', dimension, value);
      networkDimensions(entry, 'website', event.network);
      return true;
    },
    takePending() {
      const snapshots = [];
      for (const entry of days.values()) {
        if (entry.inFlight || !(entry.data.api.totalRequests || entry.data.website.pageViews)) continue;
        entry.inFlight = entry.data;
        snapshots.push(entry.inFlight);
        entry.data = emptyDaily(entry.data.dayKey);
      }
      return snapshots;
    },
    ackPending(snapshot) {
      const entry = days.get(snapshot?.dayKey);
      if (!entry || entry.inFlight !== snapshot) return;
      entry.inFlight = null;
      if (!(entry.data.api.totalRequests || entry.data.website.pageViews)) days.delete(snapshot.dayKey);
    },
    restorePending(snapshot) {
      const entry = days.get(snapshot?.dayKey);
      if (!entry || entry.inFlight !== snapshot) return;
      entry.data = mergeDailyData(snapshot, entry.data, config);
      entry.inFlight = null;
    },
    get size() { return days.size; },
    get droppedEvents() { return droppedEvents; }
  };
}

module.exports = { createTrafficAggregator, mergeDailyData, emptyDaily, validDay, ENUMS };
