#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BOXMATCH_API_BASE_URL:-}"
if [[ -z "$BASE_URL" ]]; then
  echo "BOXMATCH_API_BASE_URL is required. Example: https://boxmatch-api.onrender.com" >&2
  exit 1
fi

BASE_URL="${BASE_URL%/}"
VENUE_ID="${SMOKE_VENUE_ID:-taipei-nangang-exhibition-center-hall-1}"
CLAIMER_UID="smoke_$(date +%s)"
IDEMPOTENCY_KEY="smoke_$(date +%s)_reserve"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "[1/6] Health check..."
curl -fsS "$BASE_URL/health" > "$TMP_DIR/health.json"
node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(!d.ok){process.exit(1)}; console.log('health ok')" "$TMP_DIR/health.json"

echo "[2/6] Create listing..."
NOW_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PICKUP_START="$(date -u -v+20M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+20 minutes' +%Y-%m-%dT%H:%M:%SZ)"
PICKUP_END="$(date -u -v+110M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+110 minutes' +%Y-%m-%dT%H:%M:%SZ)"
EXPIRES_AT="$(date -u -v+150M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+150 minutes' +%Y-%m-%dT%H:%M:%SZ)"

cat > "$TMP_DIR/create_payload.json" <<JSON
{
  "data": {
    "venueId": "$VENUE_ID",
    "pickupPointText": "Smoke Test Booth",
    "itemType": "Lunchbox",
    "description": "Automated smoke test listing",
    "quantityTotal": 2,
    "pickupStartAt": "$PICKUP_START",
    "pickupEndAt": "$PICKUP_END",
    "expiresAt": "$EXPIRES_AT",
    "displayNameOptional": "SmokeBot",
    "visibility": "minimal"
  }
}
JSON

curl -fsS -X POST "$BASE_URL/enterprise/listings/create" \
  -H 'content-type: application/json' \
  --data-binary "@$TMP_DIR/create_payload.json" > "$TMP_DIR/create.json"

LISTING_ID="$(node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(!d.ok||!d.listingId||!d.token){process.exit(1)}; console.log(d.listingId)" "$TMP_DIR/create.json")"
EDIT_TOKEN="$(node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(d.token)" "$TMP_DIR/create.json")"
echo "created listing: $LISTING_ID"

echo "[3/6] Reserve listing with idempotency key..."
cat > "$TMP_DIR/reserve_payload.json" <<JSON
{
  "claimerUid": "$CLAIMER_UID",
  "qty": 1,
  "disclaimerAccepted": true,
  "idempotencyKey": "$IDEMPOTENCY_KEY"
}
JSON

curl -fsS -X POST "$BASE_URL/recipient/listings/$LISTING_ID/reserve" \
  -H 'content-type: application/json' \
  --data-binary "@$TMP_DIR/reserve_payload.json" > "$TMP_DIR/reserve1.json"

curl -fsS -X POST "$BASE_URL/recipient/listings/$LISTING_ID/reserve" \
  -H 'content-type: application/json' \
  --data-binary "@$TMP_DIR/reserve_payload.json" > "$TMP_DIR/reserve2.json"

RESERVATION_ID="$(node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(!d.ok||!d.reservation||!d.reservation.id){process.exit(1)}; console.log(d.reservation.id)" "$TMP_DIR/reserve1.json")"
PICKUP_CODE="$(node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(d.reservation.pickupCode)" "$TMP_DIR/reserve1.json")"

node -e "const fs=require('fs'); const a=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const b=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); if(!b.idempotentReplay){console.error('Expected idempotent replay'); process.exit(1)}; if(a.reservation.id!==b.reservation.id){console.error('Idempotent replay returned different reservation id'); process.exit(1)}; console.log('idempotency replay ok')" "$TMP_DIR/reserve1.json" "$TMP_DIR/reserve2.json"

echo "[4/6] List enterprise reservations..."
cat > "$TMP_DIR/list_payload.json" <<JSON
{ "token": "$EDIT_TOKEN" }
JSON

curl -fsS -X POST "$BASE_URL/enterprise/listings/$LISTING_ID/reservations" \
  -H 'content-type: application/json' \
  --data-binary "@$TMP_DIR/list_payload.json" > "$TMP_DIR/list.json"

node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(!d.ok||!Array.isArray(d.reservations)){process.exit(1)}; if(!d.reservations.find(r=>r.id===process.argv[2])){console.error('Reservation not found in enterprise list'); process.exit(1)}; console.log('enterprise list includes reservation')" "$TMP_DIR/list.json" "$RESERVATION_ID"

echo "[5/6] Confirm pickup..."
cat > "$TMP_DIR/confirm_payload.json" <<JSON
{
  "token": "$EDIT_TOKEN",
  "reservationId": "$RESERVATION_ID",
  "pickupCode": "$PICKUP_CODE"
}
JSON

curl -fsS -X POST "$BASE_URL/enterprise/listings/$LISTING_ID/confirm-pickup" \
  -H 'content-type: application/json' \
  --data-binary "@$TMP_DIR/confirm_payload.json" > "$TMP_DIR/confirm.json"

node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(!d.ok||!d.confirmed){process.exit(1)}; console.log('pickup confirmed')" "$TMP_DIR/confirm.json"

echo "[6/6] Revoke token..."
cat > "$TMP_DIR/revoke_payload.json" <<JSON
{ "token": "$EDIT_TOKEN" }
JSON

curl -fsS -X POST "$BASE_URL/enterprise/listings/$LISTING_ID/revoke-token" \
  -H 'content-type: application/json' \
  --data-binary "@$TMP_DIR/revoke_payload.json" > "$TMP_DIR/revoke.json"

node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(!d.ok||!d.revoked){process.exit(1)}; console.log('token revoked')" "$TMP_DIR/revoke.json"

echo "Smoke test PASSED"
