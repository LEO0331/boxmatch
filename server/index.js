const crypto = require('crypto');
const cors = require('cors');
const express = require('express');
const admin = require('firebase-admin');

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
const corsMiddleware = cors({ origin: true });

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => corsMiddleware(req, res, next));

const LISTINGS = 'listings';
const RESERVATIONS = 'reservations';
const ABUSE_SIGNALS = 'abuse_signals';
const IDEMPOTENCY_KEYS = 'idempotency_keys';
const KPI_EVENTS = 'kpi_events';
const KPI_DAILY = 'kpi_daily';
const KPI_SUMMARY = 'kpi_summary';
const VERIFIED_ENTERPRISES = 'verified_enterprises';
const UNVERIFIED_DAILY_LIMIT = Math.max(
  1,
  Number(process.env.UNVERIFIED_DAILY_LIMIT || 5)
);
const RECIPIENT_DAILY_RESERVATION_LIMIT = Math.max(
  1,
  Number(process.env.RECIPIENT_DAILY_RESERVATION_LIMIT || 5)
);
const LEGACY_RECIPIENT_DAILY_RESERVATION_LIMIT = Math.max(
  1,
  Number(process.env.LEGACY_RECIPIENT_DAILY_RESERVATION_LIMIT || 2)
);
const REQUIRE_ID_TOKEN = String(process.env.REQUIRE_ID_TOKEN || 'false').toLowerCase() === 'true';

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

function logServerError(event, req, error, extra = {}) {
  logEvent('error', event, {
    requestId: req.requestId ?? null,
    method: req.method ?? null,
    path: req.originalUrl ?? null,
    errorName: error?.name || 'Error',
    errorMessage: error?.message || String(error),
    stack: error?.stack || null,
    ...extra
  });
}

app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    let payload = body;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      payload = {
        requestId: req.requestId,
        ...payload
      };
    }
    res.locals.responsePayload = payload;
    return originalJson(payload);
  };

  res.on('finish', () => {
    const latencyMs = Date.now() - startedAt;
    const payload = res.locals.responsePayload || {};
    const reasonCode = payload?.code || null;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logEvent(level, 'http.request.completed', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      latencyMs,
      reasonCode,
      recipientAuthMode: req.recipientAuthMode || null
    });
  });

  next();
});

app.use('/recipient', async (req, res, next) => {
  const legacyUid = String(req.body?.claimerUid || '').trim();
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
  const forwarded = String(req.headers['x-forwarded-for'] || '').trim();
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return String(req.ip || req.socket?.remoteAddress || 'unknown').trim();
}

function deriveEnterpriseKey(req, payload) {
  const alias = normalizeAlias(payload.displayNameOptional);
  if (alias) {
    return `alias:${alias}`;
  }
  return `ip:${resolveClientIp(req)}`;
}

async function isEnterpriseVerified(payload) {
  const alias = normalizeAlias(payload.displayNameOptional);
  if (!alias) {
    return false;
  }
  const snap = await db
    .collection(VERIFIED_ENTERPRISES)
    .where('aliasNormalized', '==', alias)
    .where('venueId', '==', String(payload.venueId || ''))
    .where('active', '==', true)
    .limit(1)
    .get();
  return snap.docs.length > 0;
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

  if (pickupStartAt && pickupEndAt && pickupEndAt <= pickupStartAt) {
    errors.push('pickupEndAt must be later than pickupStartAt.');
  }
  if (pickupStartAt && expiresAt && expiresAt <= pickupStartAt) {
    errors.push('expiresAt must be later than pickupStartAt.');
  }

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
    output += Math.floor(Math.random() * 10);
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

async function verifyTokenAndFetchListing(listingId, token) {
  if (!listingId || !token) {
    return { error: 'listingId and token are required.', code: 400 };
  }

  const ref = db.collection(LISTINGS).doc(listingId);
  const snap = await ref.get();

  if (!snap.exists) {
    return { error: 'Listing not found.', code: 404 };
  }

  const data = snap.data() || {};
  const storedHash = data.editTokenHash || '';
  if (!storedHash) {
    return { error: 'Token has been revoked.', code: 403 };
  }

  const incomingHash = sha256(token);
  if (!safeEqual(incomingHash, storedHash)) {
    await db.collection(ABUSE_SIGNALS).add({
      listingId,
      claimerUid: 'enterprise_token',
      reason: 'enterprise_token_mismatch',
      createdAt: nowDate()
    });
    logEvent('warn', 'abuse.signal.created', {
      listingId,
      reasonCode: 'ABUSE_ENTERPRISE_TOKEN_MISMATCH'
    });
    return { error: 'Invalid token.', code: 403 };
  }

  return { ref, data };
}

app.get('/health', async (_req, res) => {
  res.json({ ok: true, service: 'boxmatch-server', ts: nowDate().toISOString() });
});

app.post('/recipient/listings/:listingId/reserve', async (req, res) => {
  try {
    const listingId = req.params.listingId;
    const claimerUid = String(req.recipientUid || '').trim();
    const recipientAuthMode = String(req.recipientAuthMode || 'legacy');
    const qty = Number(req.body?.qty || 0);
    const disclaimerAccepted = req.body?.disclaimerAccepted === true;
    const idempotencyKey = String(req.body?.idempotencyKey || '').trim();
    const recipientDailyLimit = resolveRecipientDailyLimit(recipientAuthMode);

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
        tx.set(db.collection(ABUSE_SIGNALS).doc(), {
          listingId,
          claimerUid,
          reason: 'reserve_failed_unavailable',
          createdAt: now
        });
        throw new Error('This listing is no longer available.');
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
        claimerUid,
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
    return errorResponse(res, status, message, reasonCode);
  }
});

app.post('/recipient/listings/:listingId/report-abuse', async (req, res) => {
  try {
    const listingId = req.params.listingId;
    const claimerUid = String(req.recipientUid || '').trim();
    const reason = String(req.body?.reason || '').trim();
    const reservationId = String(req.body?.reservationId || '').trim();

    if (!reason) {
      return errorResponse(
        res,
        400,
        'reason is required.',
        'VALIDATION_ABUSE_REASON_REQUIRED'
      );
    }

    await db.collection(ABUSE_SIGNALS).add({
      listingId,
      claimerUid,
      reservationId: reservationId || null,
      reason,
      source: 'recipient_report',
      createdAt: nowDate()
    });
    logEvent('warn', 'recipient.abuse.reported', {
      requestId: req.requestId,
      listingId,
      claimerUid,
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
    return errorResponse(res, status, message, reasonCode);
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
    const enterpriseKey = deriveEnterpriseKey(req, payload);
    const enterpriseVerified = await isEnterpriseVerified(payload);

    if (!enterpriseVerified) {
      const from = startOfDay(now);
      const to = endOfDay(now);
      const dailySnap = await db
        .collection(LISTINGS)
        .where('enterpriseKey', '==', enterpriseKey)
        .where('createdAt', '>=', from)
        .where('createdAt', '<', to)
        .get();
      if (dailySnap.size >= UNVERIFIED_DAILY_LIMIT) {
        return errorResponse(
          res,
          429,
          `Unverified enterprise daily posting limit reached (${UNVERIFIED_DAILY_LIMIT}).`,
          'UNVERIFIED_DAILY_LIMIT_REACHED'
        );
      }
    }

    const listingRef = db.collection(LISTINGS).doc();

    await listingRef.set({
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
      visibility: payload.visibility,
      status: 'active',
      enterpriseVerified,
      enterpriseKey,
      editTokenHash: sha256(token),
      createdAt: now,
      updatedAt: now
    });

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
    const verified = await verifyTokenAndFetchListing(listingId, token);
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
    const verified = await verifyTokenAndFetchListing(listingId, token);
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

    const verified = await verifyTokenAndFetchListing(listingId, token);
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

    const existing = verified.data;
    const quantityTotal = payload.quantityTotal ?? existing.quantityTotal;
    const prevRemaining = Number(existing.quantityRemaining ?? 0);
    const nextRemaining = Math.max(0, Math.min(prevRemaining, quantityTotal));

    const updateDoc = {
      ...payload,
      quantityRemaining: nextRemaining,
      status: nextRemaining === 0 ? 'reserved' : 'active',
      updatedAt: nowDate()
    };

    await verified.ref.update(updateDoc);
    return res.json({ ok: true, code: 'UPDATE_LISTING_SUCCESS', listingId, updatedFields: Object.keys(updateDoc) });
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

    const verified = await verifyTokenAndFetchListing(listingId, token);
    if (verified.error) {
      return errorResponse(res, verified.code, verified.error, 'ROTATE_TOKEN_FORBIDDEN');
    }

    const newToken = crypto.randomBytes(24).toString('base64url');
    await verified.ref.update({
      editTokenHash: sha256(newToken),
      updatedAt: nowDate()
    });

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

    const verified = await verifyTokenAndFetchListing(listingId, token);
    if (verified.error) {
      return errorResponse(res, verified.code, verified.error, 'REVOKE_TOKEN_FORBIDDEN');
    }

    await verified.ref.update({
      editTokenHash: '',
      updatedAt: nowDate()
    });

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

    const verified = await verifyTokenAndFetchListing(listingId, token);
    if (verified.error) {
      return errorResponse(res, verified.code, verified.error, 'CONFIRM_PICKUP_FORBIDDEN');
    }

    const confirmContext = await db.runTransaction(async (tx) => {
      const listingRef = db.collection(LISTINGS).doc(listingId);
      const reservationRef = db.collection(RESERVATIONS).doc(reservationId);

      const listingSnap = await tx.get(listingRef);
      const reservationSnap = await tx.get(reservationRef);

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
        tx.set(db.collection(ABUSE_SIGNALS).doc(), {
          listingId,
          claimerUid: reservationData.claimerUid || 'unknown',
          reason: 'pickup_code_mismatch',
          createdAt: nowDate()
        });
        throw new Error('Pickup code does not match.');
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
    const message = error?.message || 'Internal server error.';
    const status = [
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
      message,
      status == 400 ? 'CONFIRM_PICKUP_FAILED_BUSINESS_RULE' : 'CONFIRM_PICKUP_FAILED_INTERNAL'
    );
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`boxmatch server listening on ${port}`);
});
