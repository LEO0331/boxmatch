# Boxmatch Functions API

Base URL (after deploy):

`https://asia-east1-<project-id>.cloudfunctions.net/api`

## Endpoints

- `GET /health`
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

## GitHub Actions secrets needed

- `FIREBASE_TOKEN`: output from `firebase login:ci`
- `FIREBASE_PROJECT_ID`: e.g. `boxmatch-e2224`
