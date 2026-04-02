# Boxmatch Server API

Base URL (after deploy on Render):

`https://<your-render-service>.onrender.com`

## Endpoints

- `GET /health`
- `POST /recipient/listings/:listingId/reserve`
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
- Reason taxonomy and log schema:
  - [docs/ops/logging-taxonomy.md](/Users/Leo/Documents/boxmatch/docs/ops/logging-taxonomy.md)

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

Exports are written to `/Users/Leo/Documents/boxmatch/reports`.

## Render environment variables needed

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (use raw key with `\n` escaped)
- `ENABLE_KPI_EVENT_LOGS` (optional; set `true` only when raw event audit is needed)

## GitHub Actions secret needed

- `RENDER_DEPLOY_HOOK_URL` (from Render service settings)
