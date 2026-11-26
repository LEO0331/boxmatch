const { stat } = require('node:fs/promises');
const { normalizeIp, isPublicIp } = require('./clientIp');

// ISO 3166-1 alpha-2 only; vendor-specific region codes remain unknown.
const COUNTRY_CODES = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '));

function emptyResult(geoStatus) {
  return Object.freeze({ country: null, asn: null, organization: null, networkCategory: 'unknown', geoStatus });
}

function boundedInteger(value, fallback, maximum) {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

async function openDatabase(path) {
  const info = await stat(path);
  // Fail gracefully if future datasets exceed this free-tier memory allowance.
  if (!info.isFile() || info.size === 0 || info.size > 32 * 1024 * 1024) throw new Error('Unsupported database');
  // The reader is optional at runtime. Missing installation degrades safely.
  const maxmind = require('maxmind');
  return maxmind.open(path, { cache: { max: 1000 }, watchForUpdates: false });
}

function databasePath(value) {
  return typeof value === 'string' && value.length <= 1024 && value.trim() && !/[\x00-\x1f]/.test(value)
    ? value.trim() : null;
}

function organizationName(value) {
  return typeof value === 'string' && /^[\p{L}\p{N}\p{M} .,&()/'_:+-]{1,100}$/u.test(value)
    ? value.trim() || null : null;
}

// Database reads happen once during initialization. Request-time lookups use
// in-memory readers and a pseudonymous-key cache; no network API is involved.
function createGeoResolver(config = {}, { open = openDatabase, now = Date.now } = {}) {
  const enabled = config.enableGeoEnrichment === true;
  const maxEntries = boundedInteger(config.geoCacheMaxEntries, 2000, 10000);
  const ttlMs = boundedInteger(config.geoCacheTtlMs, 3600000, 86400000);
  const cache = new Map();
  const readers = {};
  let initialized = false;
  let closed = false;

  const ready = enabled ? Promise.all(['country', 'asn'].map(async (kind) => {
    const path = databasePath(kind === 'country' ? config.geoCountryDbPath : config.geoAsnDbPath);
    if (!path) return;
    try {
      const reader = await open(path);
      if (reader && typeof reader.get === 'function' && !closed) readers[kind] = reader;
    } catch (_) { /* Missing/corrupt/unprovisioned data must not affect startup. */ }
  })).then(() => { initialized = true; }) : Promise.resolve();

  return {
    ready,
    lookup(network = {}) {
      if (!enabled) return emptyResult('disabled');
      const ip = normalizeIp(network.ip);
      const key = network.ipFingerprint;
      if (closed || !initialized || network.identityConfidence !== 'trusted' || !isPublicIp(ip) ||
          typeof key !== 'string' || !/^hmac:[a-f0-9]{64}$/.test(key) || !Object.keys(readers).length) {
        return emptyResult('unavailable');
      }
      const cached = cache.get(key);
      if (cached && cached.until > now()) return cached.result;
      if (cached) cache.delete(key);
      let country = null;
      let asn = null;
      let organization = null;
      let failed = false;
      try {
        const record = readers.country?.get(ip);
        const candidate = record?.country?.iso_code;
        if (typeof candidate === 'string' && COUNTRY_CODES.has(candidate)) country = candidate;
      } catch (_) { failed = true; }
      try {
        const record = readers.asn?.get(ip);
        const candidate = record?.autonomous_system_number;
        if (Number.isSafeInteger(candidate) && candidate >= 1 && candidate <= 4294967295) {
          asn = candidate;
          organization = organizationName(record.autonomous_system_organization);
        }
      } catch (_) { failed = true; }
      const result = Object.freeze({ country, asn, organization, networkCategory: 'unknown',
        geoStatus: country || asn ? 'resolved' : failed ? 'unavailable' : 'not_found' });
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
      cache.set(key, { result, until: now() + ttlMs });
      return result;
    },
    close() {
      closed = true;
      cache.clear();
      for (const key of Object.keys(readers)) delete readers[key];
    },
    get size() { return cache.size; }
  };
}

module.exports = { createGeoResolver, isCountryCode: (value) => COUNTRY_CODES.has(value) };
