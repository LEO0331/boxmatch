const { ENUMS, API_COUNTERS, API_DIMENSIONS, WEBSITE_DIMENSIONS, PROBE_COUNTERS, PROBE_DIMENSIONS } = require('./trafficSchema');
const { isCountryCode } = require('./geoResolver');
const DIMENSIONS = { api: API_DIMENSIONS, website: WEBSITE_DIMENSIONS, probes: PROBE_DIMENSIONS };

function validateDays(value = 7) {
  if ((typeof value !== 'number' && (typeof value !== 'string' || !/^\d{1,2}$/.test(value))) ||
      !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 90) {
    throw new Error('Traffic export days must be an integer from 1 to 90.');
  }
  return Number(value);
}

function dayRange(days, now = new Date()) {
  days = validateDays(days);
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid export date.');
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Array.from({ length: days }, (_, index) =>
    new Date(today - (days - index - 1) * 86400000).toISOString().slice(0, 10));
}

function safeCsvCell(value) {
  let text = String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  if (/^\s*[=+@-]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function counter(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function isKnownKey(dimension, key) {
  if (key === 'unknown' || key === 'other') return true;
  if (dimension === 'countries') return isCountryCode(key);
  if (dimension === 'asns') return /^\d{1,10}$/.test(key) && Number(key) > 0 && Number(key) <= 4294967295;
  return ENUMS[dimension]?.includes(key) || false;
}

function dailyRows(dayKey, data = {}) {
  const rows = [];
  for (const stream of ['api', 'website', ...(data.probes?.observedRequests ? ['probes'] : [])]) {
    const values = data?.[stream] || {};
    for (const metric of stream === 'api' ? API_COUNTERS : stream === 'probes' ? PROBE_COUNTERS : ['pageViews']) {
      rows.push([dayKey, stream, 'totals', metric, counter(values[metric])]);
    }
    for (const dimension of DIMENSIONS[stream]) {
      const buckets = values[dimension];
      if (!buckets || typeof buckets !== 'object' || Array.isArray(buckets)) continue;
      // Persisted maps are bounded; cap operator processing if a malformed document is supplied.
      for (const key of Object.keys(buckets).sort().slice(0, 512)) {
        if (isKnownKey(dimension, key)) rows.push([dayKey, stream, dimension, key, counter(buckets[key])]);
      }
    }
  }
  return rows;
}

function snapshotCsv(snapshot) {
  const rows = [['dayKey', 'stream', 'dimension', 'key', 'count', 'status']];
  const hasProbes = Boolean(snapshot.overview?.probes || snapshot.days.some(day => day.data?.probes || day.data?.probeInvalid));
  for (const day of snapshot.days) {
    if (day.status !== 'available' || !day.data) {
      rows.push([day.date, '', 'coverage', 'observation', '', day.status]);
    } else {
      for (const row of dailyRows(day.date, day.data)) rows.push([...row, 'available']);
    }
    if (hasProbes && !day.data?.probes?.observedRequests) {
      rows.push([day.date, 'probes', 'coverage', 'observation', '', day.data?.probeInvalid ? 'invalid' : 'not_observed']);
    }
  }
  return `${rows.map((row) => row.map(safeCsvCell).join(',')).join('\n')}\n`;
}

module.exports = { validateDays, dayRange, safeCsvCell, dailyRows, snapshotCsv };
