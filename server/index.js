const crypto = require('crypto');
const cors = require('cors');
const express = require('express');
const admin = require('./firebaseAdmin');
const { readConfig } = require('./observability/config');
const { createRequestIntelligence } = require('./observability/requestContext');

if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n')
      })
    });
  } else {
    admin.initializeApp();
  }
}

const db = admin.firestore();
const app = express();
// Only operator-configured proxy addresses may supply client forwarding data.
if (process.env.TRUST_PROXY_CIDRS) {
  app.set('trust proxy', process.env.TRUST_PROXY_CIDRS.split(',').map((value) => value.trim()).filter(Boolean));
}
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || (process.env.NODE_ENV === 'production' ? 'https://leo0331.github.io' : ''))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsMiddleware = cors({
  // CORS limits browser access; bearer tokens and edit tokens remain the auth boundary.
  origin(origin, callback) {
    callback(null, isAllowedCorsOrigin(origin));
  }
});

const LISTINGS = 'listings';
const LISTING_PRIVATE = 'listing_private';
const SECURITY_BUDGETS = 'security_budgets';
const RESERVATIONS = 'reservations';
const ABUSE_SIGNALS = 'abuse_signals';
const IDEMPOTENCY_KEYS = 'idempotency_keys';
const KPI_EVENTS = 'kpi_events';
const KPI_DAILY = 'kpi_daily';
const KPI_SUMMARY = 'kpi_summary';
const VERIFIED_ENTERPRISES = 'verified_enterprises';
const BADGE_RULES = 'badge_rules';
function positiveLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
const UNVERIFIED_DAILY_LIMIT = positiveLimit(process.env.UNVERIFIED_DAILY_LIMIT, 5);
const RECIPIENT_DAILY_RESERVATION_LIMIT = positiveLimit(process.env.RECIPIENT_DAILY_RESERVATION_LIMIT, 5);
const LEGACY_RECIPIENT_DAILY_RESERVATION_LIMIT = positiveLimit(process.env.LEGACY_RECIPIENT_DAILY_RESERVATION_LIMIT, 2);
const REQUIRE_ID_TOKEN = recipientIdTokenRequired();
const DEFAULT_BADGE_RULES = {
  enabled: true,
  rules: {
    verified: { enabled: true },
    quality_trusted: {
      enabled: true,
      minCompletedRate: 0.8,
      maxCancelledRate: 0.2,
      minReservations: 5
    },
    high_impact: { enabled: true, minQuantityTotal: 20 },
    flexible_pickup: { enabled: true, minPickupWindowMinutes: 120 },
    stable_shelf_life: { enabled: true, minExpiryAfterPickupStartMinutes: 120 }
  }
};

let cachedBadgeRules = null;
let cachedBadgeRulesAt = 0;
const BADGE_RULES_CACHE_TTL_MS = 60 * 1000;

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeEqual(a, b) {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function nowDate() {
  return new Date();
}

function utcDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function estimateKgFromItemType(itemType, qty) {
  const normalized = String(itemType || '').toLowerCase();
  const weightPerUnit =
    normalized.includes('lunch') || normalized.includes('便當')
      ? 0.45
      : normalized.includes('drink') || normalized.includes('飲')
      ? 0.3
      : normalized.includes('snack') || normalized.includes('點心')
      ? 0.2
      : 0.35;
  return Number((Math.max(0, Number(qty) || 0) * weightPerUnit).toFixed(3));
}

async function trackKpiEvent({
  eventType,
  listingId,
  reservationId = null,
  venueId = null,
  itemType = '',
  qty = 0,
  requestId = null
}) {
  const now = nowDate();
  const dayKey = utcDayKey(now);
  const quantity = Math.max(0, Number(qty) || 0);
  const estimatedMeals = quantity;
  const estimatedKg = estimateKgFromItemType(itemType, quantity);
  const increments = {
    listing_created: {
      listing_created_count: 1,
      listed_qty_total: quantity
    },
    reservation_created: {
      reservation_created_count: 1,
      reserved_qty_total: quantity,
      estimated_meals_reserved_total: estimatedMeals
    },
    pickup_confirmed: {
      pickup_confirmed_count: 1,
      pickup_qty_total: quantity,
      estimated_meals_picked_up_total: estimatedMeals,
      estimated_kg_diverted_total: estimatedKg
    }
  }[eventType];

  if (!increments) {
    return;
  }

  const incrementPatch = Object.fromEntries(
    Object.entries(increments).map(([key, value]) => [key, admin.firestore.FieldValue.increment(value)])
  );

  const dailyRef = db.collection(KPI_DAILY).doc(dayKey);
  const summaryRef = db.collection(KPI_SUMMARY).doc('global');

  const writes = [
    dailyRef.set(
      {
        dayKey,
        updatedAt: now,
        ...incrementPatch
      },
      { merge: true }
    ),
    summaryRef.set(
      {
        updatedAt: now,
        ...incrementPatch
      },
      { merge: true }
    )
  ];

  if (process.env.ENABLE_KPI_EVENT_LOGS === 'true') {
    writes.push(
      db.collection(KPI_EVENTS).add({
        eventType,
        listingId,
        reservationId,
        venueId,
        itemType,
        qty: quantity,
        estimatedMeals,
        estimatedKg,
        requestId,
        createdAt: now,
        dayKey
      })
    );
  }

  await Promise.all(writes);
}

function logEvent(level, event, fields = {}) {
  const entry = {
    ts: nowDate().toISOString(),
    level,
    event,
    service: 'boxmatch-server',
    ...fields
  };
  const text = JSON.stringify(entry);

  if (level === 'error') {
    console.error(text);
  } else {
    console.log(text);
  }
}

function requestRouteLabel(req) {
  // A route template cannot disclose query-string credentials or attacker-controlled paths.
  return typeof req.route?.path === 'string'
    ? `${req.baseUrl || ''}${req.route.path}`
    : '[pre-route-or-unmatched]';
}

function recipientIdTokenRequired(env = process.env) {
  const setting = env.REQUIRE_ID_TOKEN;
  if (setting == null || setting === '') return env.NODE_ENV === 'production';
  // Only an explicit "false" opts in to the legacy, unauthenticated mode.
  return String(setting).trim().toLowerCase() !== 'false';
}

function isAllowedCorsOrigin(origin, allowedOrigins = CORS_ALLOWED_ORIGINS) {
  return !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin);
}

function logServerError(event, req, error, extra = {}) {
  logEvent('error', event, {
    requestId: req.requestId ?? null,
    method: req.method ?? null,
    path: requestRouteLabel(req),
    errorName: error?.name || 'Error',
    // Raw error messages and stacks can contain credentials, tokens or user data.
    ...extra
  });
}

const requestIntelligenceConfig = readConfig(process.env);
let requestIntelligence;
try {
  requestIntelligence = createRequestIntelligence(requestIntelligenceConfig);
} catch (_) {
  // Optional telemetry cannot prevent the API from starting.
  requestIntelligence = { capture: () => null };
}

app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let enrich;
  try { enrich = requestIntelligence.capture(req); } catch (_) { /* fail open */ }
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    let payload = body;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      payload = {
        requestId: req.requestId,
        ...payload
      };
    }
    res.locals.reasonCode = typeof payload?.code === 'string' ? payload.code : null;
    return originalJson(payload);
  };

  let completed = false;
  const complete = (aborted) => {
    if (completed) return;
    completed = true;
    const latencyMs = Date.now() - startedAt;
    const reasonCode = res.locals.reasonCode || null;
    const status = aborted ? 499 : res.statusCode;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    const route = requestRouteLabel(req);
    let intelligence = {};
    try { intelligence = enrich?.({ route, method: req.method, status }) || {}; } catch (_) { /* fail open */ }

    try {
      logEvent(level, 'http.request.completed', {
        requestId: req.requestId,
        method: req.method,
        path: route,
        status,
        latencyMs,
        reasonCode,
        recipientAuthMode: req.recipientAuthMode || null,
        ...(aborted ? { aborted: true } : {}),
        ...intelligence
      });
    } catch (_) { /* logging must not affect API processing */ }
  };
  res.once('finish', () => complete(false));
  res.once('close', () => complete(!res.writableFinished));

  next();
});

// Attach lifecycle observation before parsers and CORS, including early exits.
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => corsMiddleware(req, res, next));

// Bound work before any database reads/writes. Never trust forwarding headers
// until the deployment's proxy chain has been explicitly configured.
const requestWindows = new Map();
app.use(['/enterprise', '/recipient'], (req, res, next) => {
  const key = sha256(resolveClientIp(req));
  const now = Date.now();
  for (const [entry, window] of requestWindows) {
    if (window.until <= now) requestWindows.delete(entry);
  }
  let window = requestWindows.get(key);
  if (!window) {
    if (requestWindows.size >= 10000) return errorResponse(res, 429, 'Request limit reached.', 'REQUEST_LIMIT_REACHED');
    window = { count: 0, until: now + 60000 };
    requestWindows.set(key, window);
  }
  if (++window.count > 300) return errorResponse(res, 429, 'Request limit reached.', 'REQUEST_LIMIT_REACHED');
  next();
});


app.use('/recipient', async (req, res, next) => {
  const suppliedUid = req.body?.claimerUid;
  // Validate before coercion: JSON objects can override toString/valueOf and
  // reject this async Express 4 middleware outside its token-verification catch.
  if (suppliedUid != null && typeof suppliedUid !== 'string') {
    return errorResponse(
      res, 400, 'claimerUid must be a string.', 'VALIDATION_CLAIMER_UID_INVALID'
    );
  }
  const legacyUid = (suppliedUid || '').trim();
  const bearerToken = parseBearerToken(req);

  if (!bearerToken) {
    if (REQUIRE_ID_TOKEN) {
      return errorResponse(
        res,
        401,
        'ID token is required.',
        'AUTH_ID_TOKEN_REQUIRED'
      );
    }
    if (!legacyUid) {
      return errorResponse(
        res,
        400,
        'claimerUid is required in legacy mode.',
        'VALIDATION_CLAIMER_UID_REQUIRED'
      );
    }
    req.recipientUid = legacyUid;
    req.recipientAuthMode = 'legacy';
    return next();
  }

  try {
    const decoded = await admin.auth().verifyIdToken(bearerToken);
    const authUid = String(decoded?.uid || '').trim();
    if (!authUid) {
      return errorResponse(
        res,
        401,
        'Invalid ID token.',
        'AUTH_ID_TOKEN_INVALID'
      );
    }
    if (legacyUid && legacyUid !== authUid) {
      return errorResponse(
        res,
        400,
        'claimerUid does not match ID token uid.',
        'AUTH_UID_MISMATCH'
      );
    }
    req.recipientUid = authUid;
    req.recipientAuthMode = 'token';
    return next();
  } catch (error) {
    logServerError('recipient.auth.verify_id_token.failed', req, error, {
      reasonCode: 'AUTH_ID_TOKEN_INVALID'
    });
    return errorResponse(
      res,
      401,
      'Invalid or expired ID token.',
      'AUTH_ID_TOKEN_INVALID'
    );
  }
});

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toMillis(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'number') return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 0;
  return d.getTime();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeAlias(value) {
  return normalizeText(value).toLowerCase();
}

function startOfDay(date = nowDate()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfDay(date = nowDate()) {
  const start = startOfDay(date);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

function resolveClientIp(req) {
  // Express applies its configured trusted-proxy policy to req.ip.
  // Never take the left-most X-Forwarded-For value from untrusted input.
  return String(req.ip || req.socket?.remoteAddress || 'unknown').trim();
}

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isRuleEnabled(rule) {
  return rule && rule.enabled !== false;
}

async function getBadgeRules() {
  const now = Date.now();
  if (
    cachedBadgeRules &&
    now - cachedBadgeRulesAt < BADGE_RULES_CACHE_TTL_MS
  ) {
    return cachedBadgeRules;
  }

  try {
    const snap = await db.collection(BADGE_RULES).doc('default').get();
    const raw = snap.exists ? snap.data() || {} : {};
    const merged = {
      enabled: raw.enabled !== false,
      rules: {
        ...DEFAULT_BADGE_RULES.rules,
        ...(raw.rules || {})
      }
    };
    cachedBadgeRules = merged;
    cachedBadgeRulesAt = now;
    return merged;
  } catch (_) {
    cachedBadgeRules = DEFAULT_BADGE_RULES;
    cachedBadgeRulesAt = now;
    return DEFAULT_BADGE_RULES;
  }
}


async function recordAbuseSignal(signal, req) {
  const day = utcDayKey(nowDate());
  const network = sha256(resolveClientIp(req));
  const budgetRef = db.collection(SECURITY_BUDGETS).doc(sha256(`abuse|${network}|${day}`));
  const signalRef = db.collection(ABUSE_SIGNALS).doc(sha256(`${network}|${day}|${signal.listingId}|${signal.reason}`));
  try {
    return await db.runTransaction(async (tx) => {
      const budget = await tx.get(budgetRef);
      const existing = await tx.get(signalRef);
      if (existing.exists) return true;
      const count = Number(budget.data()?.count || 0);
      if (count >= 20) return false;
      tx.set(budgetRef, { count: count + 1, expiresAt: endOfDay() });
      tx.set(signalRef, { ...signal, createdAt: nowDate(), expiresAt: new Date(Date.now() + 30 * 86400000) });
      return true;
    });
  } catch (error) {
    logServerError('abuse.signal.write.failed', req, error);
    return false;
  }
}

function deriveEnterpriseKey(req) {
  return req.enterpriseUid ? `uid:${req.enterpriseUid}` : `network:${sha256(resolveClientIp(req))}`;
}

async function isEnterpriseVerified(payload, ownerUid) {
  if (!ownerUid) {
    return false;
  }
  const snap = await db
    .collection(VERIFIED_ENTERPRISES)
    .where('ownerUid', '==', ownerUid)
    .where('venueId', '==', String(payload.venueId || ''))
    .where('active', '==', true)
    .limit(1)
    .get();
  return snap.docs.length > 0;
}

async function computeEnterpriseReservationMetrics(enterpriseKey) {
  if (!enterpriseKey) {
    return {
      totalReservations: 0,
      completedReservations: 0,
      cancelledReservations: 0,
      completedRate: 0,
      cancelledRate: 0
    };
  }

  const listingSnap = await db
    .collection(LISTING_PRIVATE)
    .where('enterpriseKey', '==', enterpriseKey)
    .limit(200)
    .get();
  const listingIds = listingSnap.docs.map((doc) => doc.id);
  if (listingIds.length === 0) {
    return {
      totalReservations: 0,
      completedReservations: 0,
      cancelledReservations: 0,
      completedRate: 0,
      cancelledRate: 0
    };
  }

  const chunks = [];
  for (let i = 0; i < listingIds.length; i += 30) {
    chunks.push(listingIds.slice(i, i + 30));
  }

  let totalReservations = 0;
  let completedReservations = 0;
  let cancelledReservations = 0;
  for (const chunk of chunks) {
    const reservationSnap = await db
      .collection(RESERVATIONS)
      .where('listingId', 'in', chunk)
      .get();
    for (const doc of reservationSnap.docs) {
      const status = String(doc.data()?.status || 'reserved');
      totalReservations += 1;
      if (status === 'completed') {
        completedReservations += 1;
      }
      if (status === 'cancelled') {
        cancelledReservations += 1;
      }
    }
  }

  const completedRate =
    totalReservations > 0 ? completedReservations / totalReservations : 0;
  const cancelledRate =
    totalReservations > 0 ? cancelledReservations / totalReservations : 0;

  return {
    totalReservations,
    completedReservations,
    cancelledReservations,
    completedRate,
    cancelledRate
  };
}

async function resolveEnterpriseBadges({ listingData, enterpriseVerified }) {
  const rulesRoot = await getBadgeRules();
  if (rulesRoot.enabled === false) {
    return [];
  }
  const rules = rulesRoot.rules || {};
  const badges = [];

  if (enterpriseVerified && isRuleEnabled(rules.verified)) {
    badges.push('verified');
  }

  if (isRuleEnabled(rules.high_impact)) {
    const minQuantity = asNumber(rules.high_impact.minQuantityTotal, 20);
    if (asNumber(listingData.quantityTotal, 0) >= minQuantity) {
      badges.push('high_impact');
    }
  }

  if (isRuleEnabled(rules.flexible_pickup)) {
    const minMinutes = asNumber(
      rules.flexible_pickup.minPickupWindowMinutes,
      120
    );
    const windowMs =
      toMillis(listingData.pickupEndAt) - toMillis(listingData.pickupStartAt);
    if (windowMs >= minMinutes * 60 * 1000) {
      badges.push('flexible_pickup');
    }
  }

  if (isRuleEnabled(rules.stable_shelf_life)) {
    const minMinutes = asNumber(
      rules.stable_shelf_life.minExpiryAfterPickupStartMinutes,
      120
    );
    const shelfMs =
      toMillis(listingData.expiresAt) - toMillis(listingData.pickupStartAt);
    if (shelfMs >= minMinutes * 60 * 1000) {
      badges.push('stable_shelf_life');
    }
  }

  if (isRuleEnabled(rules.quality_trusted)) {
    const minCompletedRate = asNumber(
      rules.quality_trusted.minCompletedRate,
      0.8
    );
    const maxCancelledRate = asNumber(
      rules.quality_trusted.maxCancelledRate,
      0.2
    );
    const minReservations = asNumber(
      rules.quality_trusted.minReservations,
      5
    );
    const metrics = await computeEnterpriseReservationMetrics(
      String(listingData.enterpriseKey || '')
    );
    if (
      metrics.totalReservations >= minReservations &&
      metrics.completedRate >= minCompletedRate &&
      metrics.cancelledRate <= maxCancelledRate
    ) {
      badges.push('quality_trusted');
    }
  }

  return badges;
}

function resolveListingStatus({ currentStatus, expiresAt, quantityRemaining }) {
  if (currentStatus === 'completed') {
    return 'completed';
  }
  const now = nowDate();
  const expires = expiresAt?.toDate ? expiresAt.toDate() : new Date(expiresAt);
  if (!Number.isNaN(expires.getTime()) && expires <= now) {
    return 'expired';
  }
  if (Number(quantityRemaining || 0) <= 0) {
    return 'reserved';
  }
  return 'active';
}

function parseDateField(input, fieldName, errors) {
  if (input == null) return undefined;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    errors.push(`${fieldName} must be a valid datetime string.`);
    return undefined;
  }
  return d;
}

function toDateLike(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validateListingTimeline(source, errors) {
  const pickupStartAt = toDateLike(source.pickupStartAt);
  const pickupEndAt = toDateLike(source.pickupEndAt);
  const expiresAt = toDateLike(source.expiresAt);

  if (pickupStartAt && pickupEndAt && pickupEndAt <= pickupStartAt) {
    errors.push('pickupEndAt must be later than pickupStartAt.');
  }
  if (pickupStartAt && expiresAt && expiresAt <= pickupStartAt) {
    errors.push('expiresAt must be later than pickupStartAt.');
  }
}

function validateAndBuildUpdate(body) {
  const allowed = [
    'venueId',
    'pickupPointText',
    'itemType',
    'description',
    'quantityTotal',
    'pickupStartAt',
    'pickupEndAt',
    'expiresAt',
    'displayNameOptional',
    'templateId',
    'visibility'
  ];

  const payload = {};
  const errors = [];

  for (const key of Object.keys(body || {})) {
    if (!allowed.includes(key)) {
      errors.push(`Field ${key} is not allowed.`);
    }
  }

  if (typeof body.venueId === 'string' && body.venueId.trim()) {
    payload.venueId = body.venueId.trim();
  }
  if (typeof body.pickupPointText === 'string' && body.pickupPointText.trim()) {
    payload.pickupPointText = body.pickupPointText.trim();
  }
  if (typeof body.itemType === 'string' && body.itemType.trim()) {
    payload.itemType = body.itemType.trim();
  }
  if (typeof body.description === 'string' && body.description.trim()) {
    payload.description = body.description.trim();
  }
  if (Object.hasOwn(body, 'displayNameOptional')) {
    payload.displayNameOptional =
      typeof body.displayNameOptional === 'string' && body.displayNameOptional.trim()
        ? body.displayNameOptional.trim()
        : null;
  }
  if (Object.hasOwn(body, 'templateId')) {
    payload.templateId =
      typeof body.templateId === 'string' && body.templateId.trim()
        ? body.templateId.trim()
        : null;
  }
  if (typeof body.visibility === 'string' && body.visibility.trim()) {
    payload.visibility = body.visibility.trim();
  }

  if (Object.hasOwn(body, 'quantityTotal')) {
    const q = Number(body.quantityTotal);
    if (!Number.isInteger(q) || q <= 0) {
      errors.push('quantityTotal must be a positive integer.');
    } else {
      payload.quantityTotal = q;
    }
  }

  const pickupStartAt = parseDateField(body.pickupStartAt, 'pickupStartAt', errors);
  const pickupEndAt = parseDateField(body.pickupEndAt, 'pickupEndAt', errors);
  const expiresAt = parseDateField(body.expiresAt, 'expiresAt', errors);

  if (pickupStartAt) payload.pickupStartAt = pickupStartAt;
  if (pickupEndAt) payload.pickupEndAt = pickupEndAt;
  if (expiresAt) payload.expiresAt = expiresAt;

  validateListingTimeline({ pickupStartAt, pickupEndAt, expiresAt }, errors);

  return { errors, payload };
}

function validateAndBuildCreate(body) {
  const required = [
    'venueId',
    'pickupPointText',
    'itemType',
    'description',
    'quantityTotal',
    'pickupStartAt',
    'pickupEndAt',
    'expiresAt',
    'visibility'
  ];
  const errors = [];
  const payload = {};

  for (const key of required) {
    if (!Object.hasOwn(body || {}, key)) {
      errors.push(`Missing required field: ${key}.`);
    }
  }

  const { errors: updateErrors, payload: updatePayload } = validateAndBuildUpdate(body || {});
  errors.push(...updateErrors);
  Object.assign(payload, updatePayload);

  if (!Object.hasOwn(payload, 'quantityTotal')) {
    errors.push('quantityTotal must be a positive integer.');
  }
  if (!normalizeText(payload.venueId)) {
    errors.push('venueId is required.');
  }
  if (!normalizeText(payload.pickupPointText)) {
    errors.push('pickupPointText is required.');
  }
  if (!normalizeText(payload.itemType)) {
    errors.push('itemType is required.');
  }
  if (!normalizeText(payload.description)) {
    errors.push('description is required.');
  }

  return { errors, payload };
}

function randomDigits(length = 4) {
  let output = '';
  for (let i = 0; i < length; i++) {
    output += crypto.randomInt(0, 10);
  }
  return output;
}

function parseBearerToken(req) {
  const authHeader = String(req.headers?.authorization || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  return token || null;
}

function resolveRecipientDailyLimit(authMode) {
  if (authMode === 'legacy') {
    return Math.min(
      RECIPIENT_DAILY_RESERVATION_LIMIT,
      LEGACY_RECIPIENT_DAILY_RESERVATION_LIMIT
    );
  }
  return RECIPIENT_DAILY_RESERVATION_LIMIT;
}

function errorResponse(res, status, message, code, details) {
  return res.status(status).json({
    ok: false,
    error: message,
    code,
    details: details ?? null
  });
}

async function verifyTokenAndFetchListing(listingId, token, req) {
  if (!listingId || typeof token !== 'string' || !token || token.length > 256) {
    return { error: 'listingId and token are required.', code: 400 };
  }

  const ref = db.collection(LISTINGS).doc(listingId);
  const snap = await ref.get();

  if (!snap.exists) {
    return { error: 'Listing not found.', code: 404 };
  }

  const privateRef = db.collection(LISTING_PRIVATE).doc(listingId);
  const privateSnap = await privateRef.get();
  const data = { ...snap.data(), ...privateSnap.data() };
  const storedHash = privateSnap.data()?.editTokenHash || '';
  if (!storedHash) {
    return { error: 'Token has been revoked.', code: 403 };
  }

  const incomingHash = sha256(token);
  if (!safeEqual(incomingHash, storedHash)) {
    await recordAbuseSignal({
      listingId,
      claimerUid: 'enterprise_token',
      reason: 'enterprise_token_mismatch',
      createdAt: nowDate()
    }, req);
    logEvent('warn', 'abuse.signal.created', {
      listingId,
      reasonCode: 'ABUSE_ENTERPRISE_TOKEN_MISMATCH'
    });
    return { error: 'Invalid token.', code: 403 };
  }

  return { ref, privateRef, data };
}

app.get('/health', async (_req, res) => {
  res.json({ ok: true, service: 'boxmatch-server', ts: nowDate().toISOString() });
});

app.post('/recipient/listings/:listingId/reserve', async (req, res) => {
  const recipientAuthMode = String(req.recipientAuthMode || 'legacy');
  const recipientDailyLimit = resolveRecipientDailyLimit(recipientAuthMode);
  try {
    const listingId = req.params.listingId;
    const claimerUid = String(req.recipientUid || '').trim();
    const qty = Number(req.body?.qty || 0);
    const disclaimerAccepted = req.body?.disclaimerAccepted === true;
    const idempotencyKey = String(req.body?.idempotencyKey || '').trim();

    if (!Number.isInteger(qty) || qty <= 0) {
      return errorResponse(
        res,
        400,
        'qty must be a positive integer.',
        'VALIDATION_QTY_INVALID'
      );
    }
    if (!disclaimerAccepted) {
      return errorResponse(
        res,
        400,
        'Please accept disclaimer first.',
        'VALIDATION_DISCLAIMER_REQUIRED'
      );
    }
    if (!idempotencyKey) {
      return errorResponse(
        res,
        400,
        'idempotencyKey is required.',
        'VALIDATION_IDEMPOTENCY_KEY_REQUIRED'
      );
    }
    if (idempotencyKey.length > 128) {
      return errorResponse(
        res,
        400,
        'idempotencyKey is too long.',
        'VALIDATION_IDEMPOTENCY_KEY_INVALID'
      );
    }

    const reservationRef = db.collection(RESERVATIONS).doc();
    const idempotencyDocId = sha256(`${claimerUid}|${listingId}|${idempotencyKey}`);
    const idempotencyRef = db.collection(IDEMPOTENCY_KEYS).doc(idempotencyDocId);

    const reserveResult = await db.runTransaction(async (tx) => {
      const idempotencySnap = await tx.get(idempotencyRef);
      if (idempotencySnap.exists) {
        const data = idempotencySnap.data() || {};
        const cached = data.reservation;
        if (data.status === 'succeeded' && cached && typeof cached === 'object') {
          return { idempotentReplay: true, reservation: cached, metricContext: null };
        }
        throw new Error('Idempotency key conflict.');
      }

      const now = nowDate();
      const from = startOfDay(now);
      const to = endOfDay(now);
      const recipientDailySnap = await tx.get(
        db
          .collection(RESERVATIONS)
          .where('claimerUid', '==', claimerUid)
          .where('createdAt', '>=', from)
          .where('createdAt', '<', to)
      );
      if (recipientDailySnap.size >= recipientDailyLimit) {
        throw new Error(
          `Recipient daily reservation limit reached (${recipientDailyLimit}).`
        );
      }

      const listingRef = db.collection(LISTINGS).doc(listingId);
      const listingSnap = await tx.get(listingRef);
      if (!listingSnap.exists) {
        throw new Error('Listing not found.');
      }

      const listing = listingSnap.data() || {};
      const expiresAt = listing.expiresAt?.toDate
        ? listing.expiresAt.toDate()
        : new Date(listing.expiresAt);
      const quantityRemaining = Number(listing.quantityRemaining || 0);
      const status = String(listing.status || 'active');

      const isExpired = Number.isNaN(expiresAt.getTime()) ? false : expiresAt <= now;
      const unavailable = isExpired || quantityRemaining < qty || status !== 'active';
      if (unavailable) {
        throw Object.assign(new Error('This listing is no longer available.'), {
          abuseSignal: { listingId, claimerUid, reason: 'reserve_failed_unavailable' }
        });
      }

      const nextRemaining = quantityRemaining - qty;
      tx.update(listingRef, {
        quantityRemaining: nextRemaining,
        status: nextRemaining === 0 ? 'reserved' : 'active',
        updatedAt: now
      });

      const pickupCode = randomDigits(4);
      tx.set(reservationRef, {
        listingId,
        claimerUid,
        qty,
        pickupCode,
        status: 'reserved',
        createdAt: now,
        expiresAt: listing.expiresAt
      });

      const reservationPayload = {
        id: reservationRef.id,
        listingId,
        claimerUid,
        qty,
        pickupCode,
        status: 'reserved',
        createdAt: now.toISOString(),
        expiresAt: toIso(listing.expiresAt)
      };
      tx.set(idempotencyRef, {
        listingId,
        claimerUid,
        idempotencyKeyHash: idempotencyDocId,
        status: 'succeeded',
        reservation: reservationPayload,
        createdAt: now,
        updatedAt: now
      });

      return {
        idempotentReplay: false,
        reservation: reservationPayload,
        metricContext: {
          venueId: listing.venueId || null,
          itemType: listing.itemType || '',
          qty
        }
      };
    });

    if (reserveResult.idempotentReplay) {
      logEvent('info', 'recipient.reserve.idempotent_replay', {
        requestId: req.requestId,
        listingId,
        recipientAuthMode
      });
    } else {
      try {
        await trackKpiEvent({
          eventType: 'reservation_created',
          listingId,
          reservationId: reserveResult.reservation?.id || null,
          venueId: reserveResult.metricContext?.venueId || null,
          itemType: reserveResult.metricContext?.itemType || '',
          qty: reserveResult.metricContext?.qty || 0,
          requestId: req.requestId
        });
      } catch (metricError) {
        logServerError('kpi.event.write.failed', req, metricError, {
          reasonCode: 'KPI_WRITE_FAILED_RESERVATION_CREATED'
        });
      }
    }

    return res.json({
      ok: true,
      code: reserveResult.idempotentReplay
        ? 'RESERVE_SUCCESS_IDEMPOTENT_REPLAY'
        : 'RESERVE_SUCCESS',
      idempotentReplay: reserveResult.idempotentReplay,
      reservation: reserveResult.reservation
    });
  } catch (error) {
    if (error.abuseSignal) await recordAbuseSignal(error.abuseSignal, req);
    const message = error?.message || 'Internal server error.';
    const status = [
      'Listing not found.',
      'This listing is no longer available.',
      'Idempotency key conflict.',
      `Recipient daily reservation limit reached (${recipientDailyLimit}).`
    ].includes(message)
      ? message.startsWith('Recipient daily reservation limit reached')
        ? 429
        : 400
      : 500;
    const reasonCode = message === 'Idempotency key conflict.'
      ? 'IDEMPOTENCY_KEY_CONFLICT'
      : message.startsWith('Recipient daily reservation limit reached')
      ? 'RECIPIENT_DAILY_LIMIT_REACHED'
      : status == 400
      ? 'RESERVE_FAILED_BUSINESS_RULE'
      : 'RESERVE_FAILED_INTERNAL';
    logServerError('recipient.reserve.failed', req, error, {
      reasonCode,
      recipientAuthMode
    });
    return errorResponse(res, status, status === 500 ? 'Internal server error.' : message, reasonCode);
  }
});

app.post('/recipient/listings/:listingId/report-abuse', async (req, res) => {
  try {
    const listingId = req.params.listingId;
    const claimerUid = String(req.recipientUid || '').trim();
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const reservationId = typeof req.body?.reservationId === 'string'
      ? req.body.reservationId.trim() : '';

    if (!reason) {
      return errorResponse(
        res,
        400,
        'reason is required.',
        'VALIDATION_ABUSE_REASON_REQUIRED'
      );
    }
    if (typeof req.body?.reason !== 'string' || reason.length > 240 ||
        (req.body?.reservationId != null &&
          (typeof req.body.reservationId !== 'string' || reservationId.length > 128))) {
      return errorResponse(
        res, 400, 'Invalid abuse report fields.', 'VALIDATION_ABUSE_REPORT_INVALID'
      );
    }

    const recorded = await recordAbuseSignal({
      listingId,
      claimerUid,
      reservationId: reservationId || null,
      reason,
      source: 'recipient_report',
      createdAt: nowDate()
    }, req);
    if (!recorded) return errorResponse(res, 429, 'Report limit reached.', 'ABUSE_REPORT_LIMIT_REACHED');
    logEvent('warn', 'recipient.abuse.reported', {
      requestId: req.requestId,
      listingId,
      reasonCode: 'RECIPIENT_ABUSE_REPORT_CREATED'
    });

    return res.json({
      ok: true,
      code: 'REPORT_ABUSE_SUCCESS',
      listingId,
      reported: true
    });
  } catch (error) {
    logServerError('recipient.abuse.report.failed', req, error, {
      reasonCode: 'REPORT_ABUSE_FAILED_INTERNAL'
    });
    return errorResponse(
      res,
      500,
      'Internal server error.',
      'REPORT_ABUSE_FAILED_INTERNAL'
    );
  }
});

app.post('/recipient/reservations/list', async (req, res) => {
  try {
    const claimerUid = String(req.recipientUid || '').trim();

    const snap = await db
      .collection(RESERVATIONS)
      .where('claimerUid', '==', claimerUid)
      .get();

    const reservations = snap.docs
      .map((doc) => {
        const data = doc.data() || {};
        return {
          id: doc.id,
          listingId: data.listingId || '',
          claimerUid: data.claimerUid || claimerUid,
          qty: Number(data.qty || 0),
          pickupCode: data.pickupCode || '',
          status: data.status || 'reserved',
          createdAt: toIso(data.createdAt),
          expiresAt: toIso(data.expiresAt),
          _createdAtMs: toMillis(data.createdAt)
        };
      })
      .sort((a, b) => b._createdAtMs - a._createdAtMs)
      .map(({ _createdAtMs, ...item }) => item);

    return res.json({
      ok: true,
      code: 'LIST_RECIPIENT_RESERVATIONS_SUCCESS',
      claimerUid,
      reservations
    });
  } catch (error) {
    logServerError('recipient.reservation.list.failed', req, error, {
      reasonCode: 'LIST_RECIPIENT_RESERVATIONS_FAILED_INTERNAL'
    });
    return errorResponse(
      res,
      500,
      'Internal server error.',
      'LIST_RECIPIENT_RESERVATIONS_FAILED_INTERNAL'
    );
  }
});

app.post('/recipient/reservations/:reservationId/cancel', async (req, res) => {
  try {
    const reservationId = req.params.reservationId;
    const claimerUid = String(req.recipientUid || '').trim();

    const reservationRef = db.collection(RESERVATIONS).doc(reservationId);
    const result = await db.runTransaction(async (tx) => {
      const reservationSnap = await tx.get(reservationRef);
      if (!reservationSnap.exists) {
        throw new Error('Reservation not found.');
      }

      const reservation = reservationSnap.data() || {};
      if (String(reservation.claimerUid || '') !== claimerUid) {
        throw new Error('Reservation does not belong to this user.');
      }
      const status = String(reservation.status || 'reserved');
      if (status === 'cancelled') {
        return {
          idempotent: true,
          listingId: String(reservation.listingId || ''),
          qty: Number(reservation.qty || 0)
        };
      }
      if (status !== 'reserved') {
        throw new Error('Reservation is not active.');
      }

      const listingId = String(reservation.listingId || '');
      const listingRef = db.collection(LISTINGS).doc(listingId);
      const listingSnap = await tx.get(listingRef);
      if (!listingSnap.exists) {
        throw new Error('Listing not found.');
      }
      const listing = listingSnap.data() || {};
      const qty = Number(reservation.qty || 0);
      const currentRemaining = Number(listing.quantityRemaining || 0);
      const quantityTotal = Number(listing.quantityTotal || 0);
      const nextRemaining = Math.max(0, Math.min(quantityTotal, currentRemaining + qty));
      const nextStatus = resolveListingStatus({
        currentStatus: String(listing.status || 'active'),
        expiresAt: listing.expiresAt,
        quantityRemaining: nextRemaining
      });

      tx.update(reservationRef, { status: 'cancelled' });
      tx.update(listingRef, {
        quantityRemaining: nextRemaining,
        status: nextStatus,
        updatedAt: nowDate()
      });

      return { idempotent: false, listingId, qty };
    });

    return res.json({
      ok: true,
      code: result.idempotent ? 'CANCEL_RESERVATION_IDEMPOTENT' : 'CANCEL_RESERVATION_SUCCESS',
      reservationId,
      cancelled: true,
      idempotentReplay: result.idempotent === true
    });
  } catch (error) {
    if (error.abuseSignal) await recordAbuseSignal(error.abuseSignal, req);
    const message = error?.message || 'Internal server error.';
    const status = [
      'Reservation not found.',
      'Reservation does not belong to this user.',
      'Reservation is not active.',
      'Listing not found.'
    ].includes(message)
      ? 400
      : 500;
    const reasonCode = status === 400
      ? 'CANCEL_RESERVATION_FAILED_BUSINESS_RULE'
      : 'CANCEL_RESERVATION_FAILED_INTERNAL';
    logServerError('recipient.reservation.cancel.failed', req, error, {
      reasonCode
    });
    return errorResponse(res, status, status === 500 ? 'Internal server error.' : message, reasonCode);
  }
});

app.post('/enterprise/listings/create', async (req, res) => {
  try {
    const { errors, payload } = validateAndBuildCreate(req.body?.data || {});
    if (errors.length > 0) {
      return errorResponse(
        res,
        400,
        'Validation failed.',
        'VALIDATION_CREATE_LISTING_FAILED',
        errors
      );
    }

    const token = crypto.randomBytes(24).toString('base64url');
    const now = nowDate();
    const bearer = parseBearerToken(req);
    if (bearer) {
      try { req.enterpriseUid = (await admin.auth().verifyIdToken(bearer)).uid; }
      catch (_) { return errorResponse(res, 401, 'Invalid ID token.', 'AUTH_ID_TOKEN_INVALID'); }
    }
    const enterpriseKey = deriveEnterpriseKey(req);
    const ownerUid = req.enterpriseUid || null;
    const enterpriseVerified = await isEnterpriseVerified(payload, ownerUid);
    const listingDraft = {
      ...payload,
      enterpriseKey
    };
    const enterpriseBadges = await resolveEnterpriseBadges({
      listingData: listingDraft,
      enterpriseVerified
    });

    const listingRef = db.collection(LISTINGS).doc();
    const privateRef = db.collection(LISTING_PRIVATE).doc(listingRef.id);
    const budgetRef = db.collection(SECURITY_BUDGETS).doc(sha256('posting|' + resolveClientIp(req) + '|' + utcDayKey(now)));
    const principalBudgetRef = db.collection(SECURITY_BUDGETS).doc(sha256('posting|' + enterpriseKey + '|' + utcDayKey(now)));
    const listingData = {
      venueId: payload.venueId,
      pickupPointText: payload.pickupPointText,
      itemType: payload.itemType,
      description: payload.description,
      quantityTotal: payload.quantityTotal,
      quantityRemaining: payload.quantityTotal,
      price: 0,
      currency: 'TWD',
      pickupStartAt: payload.pickupStartAt,
      pickupEndAt: payload.pickupEndAt,
      expiresAt: payload.expiresAt,
      displayNameOptional: payload.displayNameOptional ?? null,
      templateId: payload.templateId ?? null,
      visibility: payload.visibility,
      status: 'active',
      enterpriseVerified,
      enterpriseBadges,
      createdAt: now,
      updatedAt: now
    };

    const admitted = await db.runTransaction(async (tx) => {
      const networkBudget = await tx.get(budgetRef);
      const principalBudget = await tx.get(principalBudgetRef);
      const networkCount = Number(networkBudget.data()?.count || 0);
      const principalCount = Number(principalBudget.data()?.count || 0);
      if (networkCount >= UNVERIFIED_DAILY_LIMIT * 10 || (!enterpriseVerified &&
          (networkCount >= UNVERIFIED_DAILY_LIMIT || principalCount >= UNVERIFIED_DAILY_LIMIT))) return false;
      tx.set(budgetRef, { count: networkCount + 1, expiresAt: endOfDay(now) });
      // Anonymous principals use a network hash but a separate budget namespace.
      tx.set(principalBudgetRef, { count: principalCount + 1, expiresAt: endOfDay(now) });
      tx.set(listingRef, listingData);
      tx.set(privateRef, { enterpriseKey, ownerUid, editTokenHash: sha256(token), createdAt: now });
      return true;
    });
    if (!admitted) return errorResponse(res, 429, 'Daily posting limit reached.', 'UNVERIFIED_DAILY_LIMIT_REACHED');


    try {
      await trackKpiEvent({
        eventType: 'listing_created',
        listingId: listingRef.id,
        venueId: payload.venueId || null,
        itemType: payload.itemType || '',
        qty: payload.quantityTotal || 0,
        requestId: req.requestId
      });
    } catch (metricError) {
      logServerError('kpi.event.write.failed', req, metricError, {
        reasonCode: 'KPI_WRITE_FAILED_LISTING_CREATED'
      });
    }

    return res.json({ ok: true, code: 'CREATE_LISTING_SUCCESS', listingId: listingRef.id, token });
  } catch (error) {
    logServerError('enterprise.listing.create.failed', req, error, {
      reasonCode: 'CREATE_LISTING_FAILED_INTERNAL'
    });
    return errorResponse(
      res,
      500,
      'Internal server error.',
      'CREATE_LISTING_FAILED_INTERNAL'
    );
  }
});

app.post('/enterprise/listings/:listingId/validate-token', async (req, res) => {
  try {
    const listingId = req.params.listingId;
    const token = req.body?.token;
    const verified = await verifyTokenAndFetchListing(listingId, token, req);
    if (verified.error) {
      return errorResponse(
        res,
        verified.code,
        verified.error,
        'VALIDATE_TOKEN_FAILED'
      );
    }
    return res.json({ ok: true, code: 'VALIDATE_TOKEN_SUCCESS', listingId });
  } catch (error) {
    logServerError('enterprise.token.validate.failed', req, error, {
      reasonCode: 'VALIDATE_TOKEN_FAILED_INTERNAL'
    });
    return errorResponse(
      res,
      500,
      'Internal server error.',
      'VALIDATE_TOKEN_FAILED_INTERNAL'
    );
  }
});

app.post('/enterprise/listings/:listingId/reservations', async (req, res) => {
  try {
    const listingId = req.params.listingId;
    const token = req.body?.token;
    const verified = await verifyTokenAndFetchListing(listingId, token, req);
    if (verified.error) {
      return errorResponse(
        res,
        verified.code,
        verified.error,
        'LIST_RESERVATIONS_FORBIDDEN'
      );
    }

    const snap = await db
      .collection(RESERVATIONS)
      .where('listingId', '==', listingId)
      .get();

    const reservations = snap.docs
      .map((doc) => {
        const data = doc.data() || {};
        return {
          id: doc.id,
          listingId: data.listingId || listingId,
          claimerUid: data.claimerUid || '',
          qty: Number(data.qty || 0),
          pickupCode: data.pickupCode || '',
          status: data.status || 'reserved',
          createdAt: toIso(data.createdAt),
          expiresAt: toIso(data.expiresAt),
          _createdAtMs: toMillis(data.createdAt)
        };
      })
      .sort((a, b) => b._createdAtMs - a._createdAtMs)
      .map(({ _createdAtMs, ...item }) => item);

    return res.json({ ok: true, code: 'LIST_RESERVATIONS_SUCCESS', listingId, reservations });
  } catch (error) {
    logServerError('enterprise.reservation.list.failed', req, error, {
      reasonCode: 'LIST_RESERVATIONS_FAILED_INTERNAL'
    });
    return errorResponse(
      res,
      500,
      'Internal server error.',
      'LIST_RESERVATIONS_FAILED_INTERNAL'
    );
  }
});

app.post('/enterprise/listings/:listingId/update', async (req, res) => {
  try {
    const listingId = req.params.listingId;
    const token = req.body?.token;

    const verified = await verifyTokenAndFetchListing(listingId, token, req);
    if (verified.error) {
      return errorResponse(res, verified.code, verified.error, 'UPDATE_LISTING_FORBIDDEN');
    }

    const { errors, payload } = validateAndBuildUpdate(req.body?.data || {});
    if (errors.length > 0) {
      return errorResponse(
        res,
        400,
        'Validation failed.',
        'VALIDATION_UPDATE_LISTING_FAILED',
        errors
      );
    }
    if (Object.keys(payload).length === 0) {
      return errorResponse(
        res,
        400,
        'No valid update fields provided.',
        'VALIDATION_UPDATE_LISTING_EMPTY'
      );
    }

    const result = await db.runTransaction(async (tx) => {
      const listingSnap = await tx.get(verified.ref);
      const privateSnap = await tx.get(verified.privateRef);
      if (!listingSnap.exists || !safeEqual(privateSnap.data()?.editTokenHash, sha256(token))) {
        return { status: 403, error: 'Invalid or revoked edit token.', code: 'UPDATE_LISTING_FORBIDDEN' };
      }
      const existing = listingSnap.data();
      const metadata = privateSnap.data();
      const merged = { ...existing, ...payload };
      const timelineErrors = [];
      validateListingTimeline(merged, timelineErrors);
      if (timelineErrors.length) return { status: 400, error: 'Validation failed.', code: 'VALIDATION_UPDATE_LISTING_FAILED', details: timelineErrors };
      const enterpriseVerified = await isEnterpriseVerified(merged, metadata.ownerUid);
      const enterpriseBadges = await resolveEnterpriseBadges({
        listingData: { ...merged, enterpriseKey: metadata.enterpriseKey }, enterpriseVerified
      });
      const updateDoc = { ...payload, enterpriseVerified, enterpriseBadges, updatedAt: nowDate() };
      if (Object.hasOwn(payload, 'quantityTotal')) {
        const allocated = Number(existing.quantityTotal) - Number(existing.quantityRemaining);
        if (payload.quantityTotal < allocated) return { status: 400, error: 'Quantity cannot be lower than allocated stock.', code: 'VALIDATION_UPDATE_LISTING_FAILED' };
        updateDoc.quantityRemaining = payload.quantityTotal - allocated;
        updateDoc.status = resolveListingStatus({ currentStatus: existing.status,
          expiresAt: merged.expiresAt, quantityRemaining: updateDoc.quantityRemaining });
      }
      tx.update(verified.ref, updateDoc);
      return { fields: Object.keys(updateDoc) };
    });
    if (result.error) return errorResponse(res, result.status, result.error, result.code, result.details);
    return res.json({ ok: true, code: 'UPDATE_LISTING_SUCCESS', listingId, updatedFields: result.fields });
  } catch (error) {
    logServerError('enterprise.listing.update.failed', req, error, {
      reasonCode: 'UPDATE_LISTING_FAILED_INTERNAL'
    });
    return errorResponse(
      res,
      500,
      'Internal server error.',
      'UPDATE_LISTING_FAILED_INTERNAL'
    );
  }
});

app.post('/enterprise/listings/:listingId/rotate-token', async (req, res) => {
  try {
    const listingId = req.params.listingId;
    const token = req.body?.token;

    const verified = await verifyTokenAndFetchListing(listingId, token, req);
    if (verified.error) {
      return errorResponse(res, verified.code, verified.error, 'ROTATE_TOKEN_FORBIDDEN');
    }

    const newToken = crypto.randomBytes(24).toString('base64url');
    const rotated = await db.runTransaction(async (tx) => {
      const current = await tx.get(verified.privateRef);
      if (!safeEqual(current.data()?.editTokenHash, sha256(token))) return false;
      tx.update(verified.privateRef, { editTokenHash: sha256(newToken), updatedAt: nowDate() });
      return true;
    });
    if (!rotated) return errorResponse(res, 403, 'Invalid or revoked edit token.', 'ROTATE_TOKEN_FORBIDDEN');

    return res.json({ ok: true, code: 'ROTATE_TOKEN_SUCCESS', listingId, token: newToken });
  } catch (error) {
    logServerError('enterprise.token.rotate.failed', req, error, {
      reasonCode: 'ROTATE_TOKEN_FAILED_INTERNAL'
    });
    return errorResponse(
      res,
      500,
      'Internal server error.',
      'ROTATE_TOKEN_FAILED_INTERNAL'
    );
  }
});

app.post('/enterprise/listings/:listingId/revoke-token', async (req, res) => {
  try {
    const listingId = req.params.listingId;
    const token = req.body?.token;

    const verified = await verifyTokenAndFetchListing(listingId, token, req);
    if (verified.error) {
      return errorResponse(res, verified.code, verified.error, 'REVOKE_TOKEN_FORBIDDEN');
    }

    const revoked = await db.runTransaction(async (tx) => {
      const current = await tx.get(verified.privateRef);
      if (!safeEqual(current.data()?.editTokenHash, sha256(token))) return false;
      tx.update(verified.privateRef, { editTokenHash: '', updatedAt: nowDate() });
      return true;
    });
    if (!revoked) return errorResponse(res, 403, 'Invalid or revoked edit token.', 'REVOKE_TOKEN_FORBIDDEN');

    return res.json({ ok: true, code: 'REVOKE_TOKEN_SUCCESS', listingId, revoked: true });
  } catch (error) {
    logServerError('enterprise.token.revoke.failed', req, error, {
      reasonCode: 'REVOKE_TOKEN_FAILED_INTERNAL'
    });
    return errorResponse(
      res,
      500,
      'Internal server error.',
      'REVOKE_TOKEN_FAILED_INTERNAL'
    );
  }
});

app.post('/enterprise/listings/:listingId/confirm-pickup', async (req, res) => {
  try {
    const listingId = req.params.listingId;
    const { token, reservationId, pickupCode } = req.body || {};

    if (!reservationId || !pickupCode) {
      return errorResponse(
        res,
        400,
        'reservationId and pickupCode are required.',
        'VALIDATION_CONFIRM_PICKUP_REQUIRED_FIELDS'
      );
    }

    const verified = await verifyTokenAndFetchListing(listingId, token, req);
    if (verified.error) {
      return errorResponse(res, verified.code, verified.error, 'CONFIRM_PICKUP_FORBIDDEN');
    }

    const confirmContext = await db.runTransaction(async (tx) => {
      const listingRef = db.collection(LISTINGS).doc(listingId);
      const reservationRef = db.collection(RESERVATIONS).doc(reservationId);

      const listingSnap = await tx.get(listingRef);
      const reservationSnap = await tx.get(reservationRef);
      const credentialSnap = await tx.get(verified.privateRef);
      if (!safeEqual(credentialSnap.data()?.editTokenHash, sha256(token))) {
        throw new Error('Invalid or revoked edit token.');
      }

      if (!listingSnap.exists) {
        throw new Error('Listing not found.');
      }
      if (!reservationSnap.exists) {
        throw new Error('Reservation not found.');
      }

      const listingData = listingSnap.data() || {};
      const reservationData = reservationSnap.data() || {};

      if (reservationData.listingId !== listingId) {
        throw new Error('Reservation does not match listing.');
      }
      if (reservationData.status !== 'reserved') {
        throw new Error('Reservation is not active.');
      }
      if (String(reservationData.pickupCode || '') !== String(pickupCode || '')) {
        throw Object.assign(new Error('Pickup code does not match.'), { abuseSignal: { listingId, reason: 'pickup_code_mismatch' } });
      }

      tx.update(reservationRef, { status: 'completed' });
      if (Number(listingData.quantityRemaining || 0) === 0) {
        tx.update(listingRef, {
          status: 'completed',
          updatedAt: nowDate()
        });
      }

      return {
        venueId: listingData.venueId || null,
        itemType: listingData.itemType || '',
        qty: Number(reservationData.qty || 0)
      };
    });

    try {
      await trackKpiEvent({
        eventType: 'pickup_confirmed',
        listingId,
        reservationId,
        venueId: confirmContext?.venueId || null,
        itemType: confirmContext?.itemType || '',
        qty: confirmContext?.qty || 0,
        requestId: req.requestId
      });
    } catch (metricError) {
      logServerError('kpi.event.write.failed', req, metricError, {
        reasonCode: 'KPI_WRITE_FAILED_PICKUP_CONFIRMED'
      });
    }

    return res.json({
      ok: true,
      code: 'CONFIRM_PICKUP_SUCCESS',
      listingId,
      reservationId,
      confirmed: true
    });
  } catch (error) {
    if (error.abuseSignal) await recordAbuseSignal(error.abuseSignal, req);
    const message = error?.message || 'Internal server error.';
    const status = message === 'Invalid or revoked edit token.' ? 403 : [
      'Listing not found.',
      'Reservation not found.',
      'Reservation does not match listing.',
      'Reservation is not active.',
      'Pickup code does not match.'
    ].includes(message)
      ? 400
      : 500;
    logServerError('enterprise.pickup.confirm.failed', req, error, {
      statusHint: status,
      reasonCode:
        status == 400
          ? 'CONFIRM_PICKUP_FAILED_BUSINESS_RULE'
          : 'CONFIRM_PICKUP_FAILED_INTERNAL'
    });
    return errorResponse(
      res,
      status,
      status === 500 ? 'Internal server error.' : message,
      status == 400 ? 'CONFIRM_PICKUP_FAILED_BUSINESS_RULE' : 'CONFIRM_PICKUP_FAILED_INTERNAL'
    );
  }
});

// Enabled observation must not delegate to Express's raw parser/stack output.
// With the feature off, preserve the application's existing error response behavior.
app.use((error, req, res, next) => {
  if (!requestIntelligenceConfig.enableRequestIntelligence) return next(error);
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
    ? error.status : 500;
  return errorResponse(res, status,
    status === 500 ? 'Internal server error.' : 'Invalid request body.',
    status === 500 ? 'REQUEST_FAILED_INTERNAL' : 'REQUEST_BODY_INVALID');
});

async function startServer(port = Number(process.env.PORT || 8080)) {
  const { migrateListingPrivacy } = require('../scripts/migrate_listing_privacy');
  const migration = await migrateListingPrivacy(db, admin.firestore.FieldValue);
  logEvent('info', 'listing.privacy.migration.completed', migration);
  return app.listen(port, () => {
    console.log(`boxmatch server listening on ${port}`);
  });
}

if (require.main === module) {
  startServer().catch(() => {
    logEvent('error', 'server.start.failed');
    process.exitCode = 1;
  });
}

module.exports = {
  app,
  startServer,
  __test: {
    asNumber,
    estimateKgFromItemType,
    normalizeAlias,
    normalizeText,
    parseBearerToken,
    parseDateField,
    recipientIdTokenRequired,
    isAllowedCorsOrigin,
    requestRouteLabel,
    resolveClientIp,
    randomDigits,
    resolveListingStatus,
    resolveRecipientDailyLimit,
    safeEqual,
    sha256,
    startOfDay,
    endOfDay,
    toIso,
    toMillis,
    utcDayKey,
    validateAndBuildCreate,
    validateListingTimeline,
    validateAndBuildUpdate,
    resetRequestLimits: () => requestWindows.clear()
  }
};
