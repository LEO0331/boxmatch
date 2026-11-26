function bounded(value, fallback, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function logDenied(logEvent, req, code) {
  try { logEvent('warn', 'admin.traffic.authorization_denied', { requestId: req.requestId || null, code }); }
  catch (_) { /* optional security logs cannot change authorization */ }
}

function createTrafficAuth(config = {}, { auth, logEvent = () => {}, now = Date.now } = {}) {
  const globalLimit = bounded(config.trafficAdminGlobalRateLimitPerMinute, 60, 1, 600);
  const userLimit = bounded(config.trafficAdminRateLimitPerMinute, 10, 1, 60);
  const concurrency = bounded(config.trafficAdminAuthConcurrency, 4, 1, 8);
  const timeoutMs = bounded(config.trafficAdminAuthTimeoutMs, 5000, 50, 10000);
  const users = new Map();
  let globalUntil = 0;
  let globalCount = 0;
  let active = 0;

  function deny(req, res, status, code) {
    logDenied(logEvent, req, code);
    return res.status(status).json({ error: status === 401 ? 'Authentication required.' :
      status === 403 ? 'Administrator access required.' : status === 429 ? 'Request limit reached.' :
        'Authentication temporarily unavailable.', code });
  }

  function userAllowed(uid, timestamp) {
    // Fixed-window insertion order also orders expiry; cleanup is bounded.
    for (let index = 0; index < 16 && users.size; index++) {
      const [key, value] = users.entries().next().value;
      if (value.until > timestamp) break;
      users.delete(key);
    }
    let entry = users.get(uid);
    if (entry && entry.until <= timestamp) { users.delete(uid); entry = null; }
    if (!entry) {
      if (users.size >= 1000) return false;
      entry = { count: 0, until: timestamp + 60000 };
      users.set(uid, entry);
    }
    return ++entry.count <= userLimit;
  }

  return async (req, res, next) => {
    const timestamp = now();
    if (timestamp >= globalUntil) { globalUntil = timestamp + 60000; globalCount = 0; }
    if (++globalCount > globalLimit) return deny(req, res, 429, 'TRAFFIC_ADMIN_GLOBAL_LIMIT');
    const rawHeaders = req.rawHeaders || [];
    let authorizationHeaders = 0;
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (rawHeaders[index].toLowerCase() === 'authorization') authorizationHeaders++;
    }
    if (authorizationHeaders > 1) return deny(req, res, 401, 'TRAFFIC_ADMIN_AUTH_REQUIRED');
    const header = req.headers.authorization;
    const match = typeof header === 'string' && header.length <= 8192
      ? /^Bearer ([^\s]+)$/i.exec(header) : null;
    if (!match) return deny(req, res, 401, 'TRAFFIC_ADMIN_AUTH_REQUIRED');
    if (active >= concurrency) return deny(req, res, 429, 'TRAFFIC_ADMIN_AUTH_CAPACITY');
    active++;
    let timeout;
    try {
      // Keep the slot occupied until the underlying SDK call settles, even if
      // the HTTP timeout wins. Otherwise hung providers could grow an unbounded queue.
      const work = Promise.resolve().then(() => auth.verifyIdToken(match[1], true))
        .finally(() => { active--; });
      const decoded = await Promise.race([work, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Object.assign(new Error('Authentication timeout'),
          { code: 'TRAFFIC_ADMIN_AUTH_TIMEOUT' })), timeoutMs);
        timeout.unref?.();
      })]);
      const provider = decoded?.firebase?.sign_in_provider;
      if (typeof decoded?.uid !== 'string' || !decoded.uid || decoded.uid.length > 128 ||
          typeof provider !== 'string' || !provider || provider.length > 128 ||
          provider === 'anonymous' || decoded.trafficAdmin !== true) {
        return deny(req, res, 403, 'TRAFFIC_ADMIN_FORBIDDEN');
      }
      if (!userAllowed(decoded.uid, now())) return deny(req, res, 429, 'TRAFFIC_ADMIN_USER_LIMIT');
      return next();
    } catch (error) {
      const invalid = ['auth/argument-error', 'auth/invalid-argument', 'auth/invalid-id-token',
        'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found',
        'auth/tenant-id-mismatch', 'auth/mismatching-tenant-id', 'auth/invalid-credential'].includes(error?.code);
      return deny(req, res, invalid ? 401 : 503,
        invalid ? 'TRAFFIC_ADMIN_AUTH_INVALID' : 'TRAFFIC_ADMIN_AUTH_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  };
}

module.exports = { createTrafficAuth };
