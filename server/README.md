# Boxmatch Server API

Base URL (after deploy on Render):

`https://<your-render-service>.onrender.com`

## Endpoints

- `GET /health`
- `POST /recipient/listings/:listingId/reserve`
- `POST /recipient/listings/:listingId/report-abuse`
- `POST /recipient/reservations/list`
- `POST /recipient/reservations/:reservationId/cancel`
- `POST /enterprise/listings/create`
- `POST /enterprise/listings/:listingId/validate-token`
- `POST /enterprise/listings/:listingId/reservations`
- `POST /enterprise/listings/:listingId/update`
- `POST /enterprise/listings/:listingId/rotate-token`
- `POST /enterprise/listings/:listingId/revoke-token`
- `POST /enterprise/listings/:listingId/confirm-pickup`

## Example payloads

### Update listing

```json
{
  "token": "plain-edit-token",
  "data": {
    "pickupPointText": "Hall 1 Gate A",
    "description": "剩下 8 份餐盒",
    "quantityTotal": 12,
    "pickupStartAt": "2026-04-01T10:00:00.000Z",
    "pickupEndAt": "2026-04-01T12:00:00.000Z",
    "expiresAt": "2026-04-01T12:30:00.000Z"
  }
}
```

### Recipient reserve

```json
{
  "claimerUid": "firebase-anon-uid",
  "qty": 1,
  "disclaimerAccepted": true,
  "idempotencyKey": "reserve_abc123_same_key_for_retry"
}
```

Business rule:

- recipient daily reservation cap is enforced by resolved recipient uid + UTC day.
- when cap is hit, API returns `429` with code `RECIPIENT_DAILY_LIMIT_REACHED`.

Auth compatibility policy (Phase 1):

- recipient API accepts `Authorization: Bearer <Firebase ID token>` and legacy `claimerUid`.
- server always prefers the verified token uid when token is present.
- if both token uid and `claimerUid` exist but mismatch, API returns `400` with `AUTH_UID_MISMATCH`.
- **Production Render deployment requires a valid Firebase ID token**, including when the client uses anonymous Firebase sign-in. Missing tokens return `401 AUTH_ID_TOKEN_REQUIRED`.
- Legacy `claimerUid`-only mode remains an explicit **development-only compatibility opt-in** (`REQUIRE_ID_TOKEN=false`) and is vulnerable to identity spoofing; do not enable it on a public API.
- `REQUIRE_ID_TOKEN` defaults to `true` when `NODE_ENV=production`.

### Create listing

```json
{
  "data": {
    "venueId": "taipei-nangang-exhibition-center-hall-1",
    "pickupPointText": "Hall 1 Gate A",
    "itemType": "Lunchbox",
    "description": "剩下 10 份",
    "quantityTotal": 10,
    "pickupStartAt": "2026-04-01T10:00:00.000Z",
    "pickupEndAt": "2026-04-01T12:00:00.000Z",
    "expiresAt": "2026-04-01T12:30:00.000Z",
    "displayNameOptional": "Booth A",
    "visibility": "minimal"
  }
}
```

### Rotate token

```json
{
  "token": "old-plain-token"
}
```

### Revoke token

```json
{
  "token": "plain-edit-token"
}
```

## Security model

- Client sends plain token only to this API.
- API hashes (`SHA-256`) and verifies against Firestore `editTokenHash`.
- Firestore writes are done by Firebase Admin SDK (server-side only).

## Observability

- Responses include `requestId` and `code` for tracing/debugging.
- Server emits structured JSON logs (`http.request.completed` + endpoint failure events).

## KPI Tracking

- Server writes lightweight aggregate metrics to:
  - `kpi_daily/{YYYY-MM-DD}`
  - `kpi_summary/global`
- Tracked event families:
  - `listing_created`
  - `reservation_created`
  - `pickup_confirmed`
- Optional raw event logs (`kpi_events`) can be enabled by setting:
  - `ENABLE_KPI_EVENT_LOGS=true`

### KPI CSV export

Run from `server/`:

```bash
npm run export:kpi:7d
npm run export:kpi:30d
```

Exports are written to `../Documents/boxmatch/reports`.

## Render environment variables needed

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (use raw key with `\n` escaped)
- `ENABLE_KPI_EVENT_LOGS` (optional; set `true` only when raw event audit is needed)
- `UNVERIFIED_DAILY_LIMIT` (optional; default `5`)
- `RECIPIENT_DAILY_RESERVATION_LIMIT` (optional; default `5`)
- `LEGACY_RECIPIENT_DAILY_RESERVATION_LIMIT` (optional; default `2`)
- `REQUIRE_ID_TOKEN` (**true in render.yaml**; secure-by-default when `NODE_ENV=production`)
- `CORS_ALLOWED_ORIGINS` (comma-separated browser origins; Render default: `https://leo0331.github.io`; native clients without an Origin header are unaffected)
- Note: Render does not currently set Express `trust proxy`. IP fallback uses Express's `req.ip` rather than untrusted `X-Forwarded-For`; check Render's actual proxy topology before changing this policy.

## GitHub Actions secret needed

- `RENDER_DEPLOY_HOOK_URL` (from Render service settings)

## Recipient Auth Migration Timeline

- Historical Phase 1 compatibility: `2026-04-02` to `2026-11-19`.
  - token and legacy body uid were both accepted; production exposure is documented in `docs/SECURITY_REVIEW_2026-11-19.md`.
- Security cutover (after this PR is deployed):
  - production Render requires Firebase ID tokens now; missing tokens return `401`.
  - older clients using only `claimerUid` must upgrade; the current Flutter client already attempts anonymous Firebase sign-in and sends a bearer token.
  - do not disable this requirement to restore older unauthenticated clients.
- Follow-up: remove the legacy compatibility code after existing clients have migrated.

## Manual Review SOP (Verified Enterprise)

Goal: reduce abuse risk before exposing pickup codes publicly.

### 1) Review intake

- Collect:
  - enterprise display name (alias)
  - target venueId
  - booth / pickup point proof (photo or organizer reference)
  - event date window
- Confirm pickup happens only at public venue/service desk.

### 2) Approve in Firestore

Create a doc in `verified_enterprises` with fields:

```json
{
  "aliasNormalized": "acme booth a",
  "venueId": "taipei-nangang-exhibition-center-hall-1",
  "active": true,
  "reviewedBy": "ops-name",
  "reviewedAt": "2026-04-02T00:00:00.000Z",
  "notes": "manual verification passed"
}
```

Rules:

- `aliasNormalized` must be lowercase + trimmed and exactly match the alias enterprise uses in posting.
- `venueId` must match posting venue.
- `active=true` means verified badge is granted.

## Badge Rules (Admin-configurable)

`enterpriseBadges` are now computed by server from Firestore config doc:

- collection: `badge_rules`
- document: `default`

Example:

```json
{
  "enabled": true,
  "rules": {
    "verified": { "enabled": true },
    "quality_trusted": {
      "enabled": true,
      "minCompletedRate": 0.8,
      "maxCancelledRate": 0.2,
      "minReservations": 5
    },
    "high_impact": { "enabled": true, "minQuantityTotal": 20 },
    "flexible_pickup": { "enabled": true, "minPickupWindowMinutes": 120 },
    "stable_shelf_life": {
      "enabled": true,
      "minExpiryAfterPickupStartMinutes": 120
    }
  }
}
```

Admin location today:

- Firebase Console -> Firestore -> `badge_rules/default`
- this project currently has no separate in-app `/admin` screen

### Seed template + one-click import

You do **not** need to manually create `verified_enterprises` or `badge_rules` first.
Running the script will auto-create collection/documents.

From repo root:

```bash
export FIREBASE_PROJECT_ID="boxmatch-e2224"
export FIREBASE_CLIENT_EMAIL="..."
export FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

cd ../boxmatch/server
npm run seed:verified
```

Optional custom file path:

```bash
cd ../boxmatch/server
node ../scripts/seed_verified_enterprises.js /absolute/path/to/your.seed.json
```

### Demo seed (6 enterprise edit links)

Use this to quickly create demo listings and print clickable enterprise edit URLs.

```bash
cd ../boxmatch/server
export BOXMATCH_API_BASE_URL="https://boxmatch-api.onrender.com"
npm run seed:demo-links
```

Optional knobs:

- `SEED_LISTING_COUNT` (default `6`)
- `SEED_RESERVE_COUNT` (default `3`)
- `SEED_CONFIRM_COUNT` (default `1`)
- `BOXMATCH_WEB_BASE_URL` (default `https://leo0331.github.io/boxmatch/#`)

### Backend test suite

Run backend unit + API integration tests:

```bash
cd ../boxmatch/server
npm test
```

Current coverage focus:

- create listing validation + unverified daily limit
- enterprise token flow: validate/update/rotate/revoke
- recipient flow: reserve idempotency, overbooking guard, daily limit, list, cancel
- pickup confirmation status transition

### 3) Runtime behavior

- Verified match:
  - listing has `enterpriseVerified=true`
  - client shows `Verified enterprise` badge
- Unverified:
  - listing has `enterpriseVerified=false`
  - create listing is rate-limited by `UNVERIFIED_DAILY_LIMIT` per enterprise key/day

### 4) Incident response

- If suspicious reports appear:
  1. set matching `verified_enterprises.active=false`
  2. revoke token for active listings
  3. review abuse signals in `abuse_signals`

## Security hardening (2026-11-25)

Enterprise verification now requires a Firebase ID token whose UID matches the
`ownerUid` of an active `verified_enterprises` record at the submitted venue.
Aliases alone never grant verification. Populate `ownerUid` through the reviewed
seed input and run `npm run seed:verified`; missing ownership remains unverified.
The web client initializes anonymous Firebase identity before creating a listing.
Enterprise edit links remain bearer capabilities, now carried in URL fragments.

On the first `npm start` without a valid version-1 completion marker, an idempotent migration completes before the HTTP listener opens. Subsequent startups read only the server-owned `schema_migrations/listing_privacy_v1` marker. A failed scan never publishes completion.
It moves listing credentials/enterprise keys into the server-only `listing_private`
collection, removes public copies, and clears legacy unowned verification/reputation
badges. Existing edit tokens remain valid. Startup fails if migration cannot finish.
The standalone command always forces a full rescan and refreshes the marker. Run it after any rollback to an older writer or external legacy import, before restarting the current server. Use `node ../scripts/migrate_listing_privacy.js` from
`server/`, with the documented Admin environment credentials. Coordinate rollout
so old server instances no longer write legacy public fields.

Daily posting admission uses atomic Firestore counters, scoped to server-derived
principal and network identities. Unverified posts share the configured daily
network cap; verified posts still have a network ceiling of ten times that cap.
Alias changes and anonymous account cycling cannot reset the network counter.
Requests to enterprise/recipient routes are capped at 300 per minute per network
per server instance, before authentication/database work. Abuse signals deduplicate
per network/listing/reason/day and share a persistent 20-write daily network budget.
Counter expiry is enforced by day-specific IDs; deploy `firestore.indexes.json` to
enable TTL cleanup of counters and 30-day abuse records. Client writes/reads to
`listing_private` and `security_budgets` are explicitly denied by Firestore rules.

Proxy addresses are untrusted by default. Set `TRUST_PROXY_CIDRS` only to the actual
trusted reverse proxy CIDRs after verifying the hosting network and forwarding
behavior. Otherwise upstream proxy users share a network budget. Never set blanket
proxy trust or derive identity from an arbitrary `X-Forwarded-For` header.

Dependencies now use Firebase Admin's modular SDK through a small adapter.
The patched rimraf override is required until the upstream Google clients replace
their vulnerable v5 dependency. Recheck `npm audit` when updating these clients.
