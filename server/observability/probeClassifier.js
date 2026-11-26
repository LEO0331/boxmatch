// Passive classification only. Raw URLs are transient and never returned.
const TARGETS = Object.freeze(['environment', 'git_metadata', 'wordpress', 'backup', 'path_traversal', 'admin_tools', 'configuration', 'credentials', 'other_sensitive']);
function classifyProbe(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  let path = value.split(/[?#]/, 1)[0];
  for (let i = 0; i < 2; i++) {
    try { path = decodeURIComponent(path); } catch (_) { break; }
  }
  path = path.replace(/\\/g, '/').toLowerCase();
  if (/(?:^|\/)\.\.(?:\/|$)/.test(path)) return 'path_traversal';
  if (/(?:^|\/)\.env(?:\.[^/]*)?(?:\/|$)/.test(path)) return 'environment';
  if (/(?:^|\/)\.git(?:\/|$)/.test(path)) return 'git_metadata';
  if (/(?:^|\/)(?:wp-admin|wp-login\.php|xmlrpc\.php|wp-config\.php)(?:\/|$)/.test(path)) return 'wordpress';
  if (/(?:^|\/)(?:backup|backups|dump|database|site)(?:[-_.][a-z0-9_-]{1,40})?\.(?:zip|tar|gz|sql|bak|old|7z)(?:\/|$)/.test(path) ||
      /(?:^|\/)[^/]{1,128}\.(?:bak|backup|old|sql)(?:\/|$)/.test(path)) return 'backup';
  if (/(?:^|\/)(?:phpmyadmin|phpinfo\.php|adminer(?:\.php)?)(?:\/|$)/.test(path)) return 'admin_tools';
  if (/(?:^|\/)(?:credentials(?:\.json)?|id_rsa|\.htpasswd)(?:\/|$)/.test(path)) return 'credentials';
  if (/(?:^|\/)(?:web\.config|\.htaccess|config\.(?:php|ya?ml|json)|appsettings\.json|application\.(?:properties|ya?ml)|database\.ya?ml|docker-compose\.ya?ml)(?:\/|$)/.test(path)) return 'configuration';
  return null;
}

// Short fixed window per trusted HMAC. Count requests, never people or unique IPs.
// Bounded LRU; restarts, eviction and split instances lose correlation context.
function createProbeWindow({ now = Date.now, maxEntries = 2048, windowMs = 60000 } = {}) {
  const entries = new Map();
  const maximum = Number.isInteger(maxEntries) ? Math.max(1, Math.min(2048, maxEntries)) : 2048;
  const window = Number.isInteger(windowMs) ? Math.max(1000, Math.min(300000, windowMs)) : 60000;
  // Physically discard expired entries even if probes stop arriving. The
  // sweep is bounded by maximum entries, and never keeps the process alive.
  const timer = setInterval(() => {
    const time = now();
    for (const [key, entry] of entries) {
      if (time - entry.start >= window) entries.delete(key);
    }
  }, window);
  timer.unref?.();
  return {
    close() { clearInterval(timer); entries.clear(); },
    observe(network, category) {
      const key = network?.ipFingerprint;
      if (network?.identityConfidence !== 'trusted' || typeof key !== 'string' ||
          !/^hmac:[a-f0-9]{64}$/.test(key) || !TARGETS.includes(category)) return { correlated: false, repeated: false, multiCategory: false };
      const time = now();
      // Incremental cleanup plus strict capacity; no per-request full scan.
      for (let i = 0; i < 32 && entries.size; i++) {
        const [oldKey, old] = entries.entries().next().value;
        if (time - old.last < window) break;
        entries.delete(oldKey);
      }
      const prior = entries.get(key);
      const active = prior && time >= prior.start && time - prior.start < window;
      const bit = 1 << TARGETS.indexOf(category);
      const mask = (active ? prior.mask : 0) | bit;
      entries.delete(key);
      if (entries.size >= maximum) entries.delete(entries.keys().next().value);
      entries.set(key, { start: active ? prior.start : time, last: time, mask });
      return { correlated: true, repeated: Boolean(active), multiCategory: Boolean(active && (mask & (mask - 1))) };
    },
    get size() { return entries.size; }
  };
}
module.exports = { TARGETS, classifyProbe, createProbeWindow };
