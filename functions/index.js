const crypto = require('crypto');
const cors = require('cors');
const express = require('express');
const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const app = express();
const corsMiddleware = cors({ origin: true });

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => corsMiddleware(req, res, next));

const LISTINGS = 'listings';
const RESERVATIONS = 'reservations';
const ABUSE_SIGNALS = 'abuse_signals';

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

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
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

  return { errors, payload };
}

function randomDigits(length = 4) {
  let output = '';
  for (let i = 0; i < length; i++) {
    output += Math.floor(Math.random() * 10);
  }
  return output;
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
    return { error: 'Invalid token.', code: 403 };
  }

  return { ref, data };
}

app.get('/health', async (_req, res) => {
  res.json({ ok: true, service: 'boxmatch-functions', ts: nowDate().toISOString() });
});

app.post('/recipient/listings/:listingId/reserve', async (req, res) => {
  try {
    const listingId = req.params.listingId;
    const claimerUid = String(req.body?.claimerUid || '').trim();
    const qty = Number(req.body?.qty || 0);
    const disclaimerAccepted = req.body?.disclaimerAccepted === true;

    if (!claimerUid) {
      return res.status(400).json({ error: 'claimerUid is required.' });
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ error: 'qty must be a positive integer.' });
    }
    if (!disclaimerAccepted) {
      return res.status(400).json({ error: 'Please accept disclaimer first.' });
    }

    const reservationRef = db.collection(RESERVATIONS).doc();
    await db.runTransaction(async (tx) => {
      const listingRef = db.collection(LISTINGS).doc(listingId);
      const listingSnap = await tx.get(listingRef);
      if (!listingSnap.exists) {
        throw new Error('Listing not found.');
      }

      const listing = listingSnap.data() || {};
      const expiresAt = listing.expiresAt?.toDate
        ? listing.expiresAt.toDate()
        : new Date(listing.expiresAt);
      const now = nowDate();
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

      tx.set(reservationRef, {
        listingId,
        claimerUid,
        qty,
        pickupCode: randomDigits(4),
        status: 'reserved',
        createdAt: now,
        expiresAt: listing.expiresAt
      });
    });

    const created = await reservationRef.get();
    const data = created.data() || {};
    return res.json({
      ok: true,
      reservation: {
        id: created.id,
        listingId: data.listingId || listingId,
        claimerUid: data.claimerUid || claimerUid,
        qty: Number(data.qty || qty),
        pickupCode: data.pickupCode || '',
        status: data.status || 'reserved',
        createdAt: toIso(data.createdAt),
        expiresAt: toIso(data.expiresAt)
      }
    });
  } catch (error) {
    const message = error?.message || 'Internal server error.';
    const status = ['Listing not found.', 'This listing is no longer available.'].includes(
      message
    )
      ? 400
      : 500;
    console.error('recipient reserve failed', error);
    return res.status(status).json({ error: message });
  }
});

app.post('/enterprise/listings/create', async (req, res) => {
  try {
    const { errors, payload } = validateAndBuildCreate(req.body?.data || {});
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed.', details: errors });
    }

    const token = crypto.randomBytes(24).toString('base64url');
    const now = nowDate();
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
      editTokenHash: sha256(token),
      createdAt: now,
      updatedAt: now
    });

    return res.json({ ok: true, listingId: listingRef.id, token });
  } catch (error) {
    console.error('create listing failed', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

app.post('/enterprise/listings/:listingId/validate-token', async (req, res) => {
  try {
    const listingId = req.params.listingId;
    const token = req.body?.token;
    const verified = await verifyTokenAndFetchListing(listingId, token);
    if (verified.error) {
      return res.status(verified.code).json({ error: verified.error, ok: false });
    }
    return res.json({ ok: true, listingId });
  } catch (error) {
    console.error('validate token failed', error);
    return res.status(500).json({ error: 'Internal server error.', ok: false });
  }
});

app.post('/enterprise/listings/:listingId/reservations', async (req, res) => {
  try {
    const listingId = req.params.listingId;
    const token = req.body?.token;
    const verified = await verifyTokenAndFetchListing(listingId, token);
    if (verified.error) {
      return res.status(verified.code).json({ error: verified.error, ok: false });
    }

    const snap = await db
      .collection(RESERVATIONS)
      .where('listingId', '==', listingId)
      .orderBy('createdAt', 'desc')
      .get();

    const reservations = snap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        listingId: data.listingId || listingId,
        claimerUid: data.claimerUid || '',
        qty: Number(data.qty || 0),
        pickupCode: data.pickupCode || '',
        status: data.status || 'reserved',
        createdAt: toIso(data.createdAt),
        expiresAt: toIso(data.expiresAt)
      };
    });

    return res.json({ ok: true, listingId, reservations });
  } catch (error) {
    console.error('list reservations failed', error);
    return res.status(500).json({ error: 'Internal server error.', ok: false });
  }
});

app.post('/enterprise/listings/:listingId/update', async (req, res) => {
  try {
    const listingId = req.params.listingId;
    const token = req.body?.token;

    const verified = await verifyTokenAndFetchListing(listingId, token);
    if (verified.error) {
      return res.status(verified.code).json({ error: verified.error });
    }

    const { errors, payload } = validateAndBuildUpdate(req.body?.data || {});
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed.', details: errors });
    }
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: 'No valid update fields provided.' });
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
    return res.json({ ok: true, listingId, updatedFields: Object.keys(updateDoc) });
  } catch (error) {
    console.error('update listing failed', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

app.post('/enterprise/listings/:listingId/rotate-token', async (req, res) => {
  try {
    const listingId = req.params.listingId;
    const token = req.body?.token;

    const verified = await verifyTokenAndFetchListing(listingId, token);
    if (verified.error) {
      return res.status(verified.code).json({ error: verified.error });
    }

    const newToken = crypto.randomBytes(24).toString('base64url');
    await verified.ref.update({
      editTokenHash: sha256(newToken),
      updatedAt: nowDate()
    });

    return res.json({ ok: true, listingId, token: newToken });
  } catch (error) {
    console.error('rotate token failed', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

app.post('/enterprise/listings/:listingId/revoke-token', async (req, res) => {
  try {
    const listingId = req.params.listingId;
    const token = req.body?.token;

    const verified = await verifyTokenAndFetchListing(listingId, token);
    if (verified.error) {
      return res.status(verified.code).json({ error: verified.error });
    }

    await verified.ref.update({
      editTokenHash: '',
      updatedAt: nowDate()
    });

    return res.json({ ok: true, listingId, revoked: true });
  } catch (error) {
    console.error('revoke token failed', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

app.post('/enterprise/listings/:listingId/confirm-pickup', async (req, res) => {
  try {
    const listingId = req.params.listingId;
    const { token, reservationId, pickupCode } = req.body || {};

    if (!reservationId || !pickupCode) {
      return res.status(400).json({ error: 'reservationId and pickupCode are required.' });
    }

    const verified = await verifyTokenAndFetchListing(listingId, token);
    if (verified.error) {
      return res.status(verified.code).json({ error: verified.error });
    }

    await db.runTransaction(async (tx) => {
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
    });

    return res.json({ ok: true, listingId, reservationId, confirmed: true });
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
    console.error('confirm pickup failed', error);
    return res.status(status).json({ error: message });
  }
});

exports.api = onRequest(
  {
    region: 'asia-east1',
    cors: true,
    invoker: 'public',
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  app
);
