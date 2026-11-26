const { ENUMS, API_COUNTERS: API_SCALARS, API_DIMENSIONS, WEBSITE_DIMENSIONS, PROBE_COUNTERS, PROBE_DIMENSIONS } = require('./trafficSchema');
const { createProbeWindow, TARGETS } = require('./probeClassifier');

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

function emptyProbes() {
  const data = Object.fromEntries(PROBE_COUNTERS.map((name) => [name, 0]));
  for (const name of PROBE_DIMENSIONS) data[name] = { unknown: 0, ...(['countries', 'asns'].includes(name) ? { other: 0 } : {}) };
  return data;
}

function probeStatus(event) {
  if (event.aborted) return 'aborted';
  const status = event.status;
  if (!Number.isInteger(status)) return 'unknown';
  if ([401, 403, 404, 429].includes(status)) return String(status);
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return 'other4xx';
  if (status >= 500 && status < 600) return '5xx';
  return 'unknown';
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
  // Additive optional section: old days/disabled collection remain unobserved.
  // Merge even when collection is disabled so an existing probe section survives.
  if (existing?.probes || delta?.probes) {
    result.probes = emptyProbes();
    for (const name of PROBE_COUNTERS) result.probes[name] = add(existing?.probes?.[name], delta?.probes?.[name]);
    for (const name of PROBE_DIMENSIONS) {
      const maximum = name === 'asns' ? limit(config.trafficMaxAsnBuckets, 100, 100) : name === 'countries' ? limit(config.trafficMaxCountryBuckets, 100, 250) : null;
      result.probes[name] = mergeDimension(name, existing?.probes?.[name], delta?.probes?.[name], maximum);
    }
  }
  return result;
}

function createTrafficAggregator(config = {}, { now = Date.now } = {}) {
  const enabled = config.enableTrafficAggregation === true;
  const maxDays = limit(config.trafficMaxPendingDays, 3, 7);
  const days = new Map();
  const probeWindow = enabled && config.enableSecurityProbes === true && config.enableRequestIntelligence === true ? createProbeWindow({ now }) : null;
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
      if (probeWindow && event.security && Object.hasOwn(event.security, 'probeCategory')) {
        const category = event.security.probeCategory;
        const probes = entry.data.probes ||= emptyProbes();
        probes.observedRequests = add(probes.observedRequests, 1);
        if (TARGETS.includes(category)) {
          probes.matchedRequests = add(probes.matchedRequests, 1);
          const observation = probeWindow.observe(event.network, category);
          if (observation.correlated) probes.correlatedRequests = add(probes.correlatedRequests, 1);
          if (observation.repeated) probes.repeatRequests = add(probes.repeatRequests, 1);
          if (observation.multiCategory) probes.multiCategoryRequests = add(probes.multiCategoryRequests, 1);
          const status = probeStatus(event);
          if (status === '2xx') probes.success2xx = add(probes.success2xx, 1);
          const method = ENUMS.probeMethods.includes(event.method) ? event.method : 'other';
          const hour = String(new Date(event.ts ?? now()).getUTCHours()).padStart(2, '0');
          for (const [name, value] of [['probeTargets', category], ['probeMethods', method],
            ['probeHours', hour], ['probeStatuses', status], ['classifications', event.security.classification],
            ['riskLevels', event.security.riskLevel], ['verificationStatuses', event.security.verificationStatus]]) {
            increment(entry, 'probes', name, value);
          }
          networkDimensions(entry, 'probes', event.network);
        }
      }
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
    close() { probeWindow?.close(); },
    get size() { return days.size; },
    get droppedEvents() { return droppedEvents; }
  };
}

module.exports = { createTrafficAggregator, mergeDailyData, emptyDaily, emptyProbes, validDay, ENUMS };
