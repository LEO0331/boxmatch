#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BOXMATCH_API_BASE_URL:-}"
if [[ -z "$BASE_URL" ]]; then
  echo "BOXMATCH_API_BASE_URL is required. Example: https://boxmatch-api.onrender.com" >&2
  exit 1
fi

BASE_URL="${BASE_URL%/}"
LISTING_COUNT="${SEED_LISTING_COUNT:-6}"
RESERVE_COUNT="${SEED_RESERVE_COUNT:-3}"
CONFIRM_COUNT="${SEED_CONFIRM_COUNT:-1}"
CLAIMER_PREFIX="${SEED_CLAIMER_PREFIX:-seed_user}"
DISPLAY_NAME="${SEED_DISPLAY_NAME:-POC Enterprise}"
WEB_BASE_URL="${BOXMATCH_WEB_BASE_URL:-https://leo0331.github.io/boxmatch/#}"
WEB_BASE_URL="${WEB_BASE_URL%/}"

if ! [[ "$LISTING_COUNT" =~ ^[0-9]+$ ]] || ! [[ "$RESERVE_COUNT" =~ ^[0-9]+$ ]] || ! [[ "$CONFIRM_COUNT" =~ ^[0-9]+$ ]]; then
  echo "SEED_LISTING_COUNT / SEED_RESERVE_COUNT / SEED_CONFIRM_COUNT must be integers" >&2
  exit 1
fi

if (( RESERVE_COUNT > LISTING_COUNT )); then
  RESERVE_COUNT="$LISTING_COUNT"
fi
if (( CONFIRM_COUNT > RESERVE_COUNT )); then
  CONFIRM_COUNT="$RESERVE_COUNT"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
SUMMARY_FILE="$TMP_DIR/seed-summary.tsv"
touch "$SUMMARY_FILE"

VENUE_IDS=(
  "taipei-nangang-exhibition-center-hall-1"
  "taipei-nangang-exhibition-center-hall-2"
  "songshan-cultural-park"
)
ITEM_TYPES=("Lunchbox" "Drink" "Sandwich" "Snack")

add_minutes_utc() {
  local minutes="$1"
  date -u -v+"${minutes}"M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "+${minutes} minutes" +%Y-%m-%dT%H:%M:%SZ
}

echo "Seeding test data to: $BASE_URL"
echo "listing_count=$LISTING_COUNT reserve_count=$RESERVE_COUNT confirm_count=$CONFIRM_COUNT"

for ((i = 1; i <= LISTING_COUNT; i++)); do
  venue="${VENUE_IDS[$(((i - 1) % ${#VENUE_IDS[@]}))]}"
  item="${ITEM_TYPES[$(((i - 1) % ${#ITEM_TYPES[@]}))]}"
  pickup_start="$(add_minutes_utc $((20 + (i * 7))))"
  pickup_end="$(add_minutes_utc $((70 + (i * 7))))"
  expires_at="$(add_minutes_utc $((130 + (i * 9))))"

  cat > "$TMP_DIR/create_payload.json" <<JSON
{
  "data": {
    "venueId": "$venue",
    "pickupPointText": "Seed Booth $i",
    "itemType": "$item",
    "description": "POC seeded listing #$i",
    "quantityTotal": 3,
    "pickupStartAt": "$pickup_start",
    "pickupEndAt": "$pickup_end",
    "expiresAt": "$expires_at",
    "displayNameOptional": "$DISPLAY_NAME",
    "visibility": "minimal"
  }
}
JSON

  curl -fsS -X POST "$BASE_URL/enterprise/listings/create" \
    -H 'content-type: application/json' \
    --data-binary "@$TMP_DIR/create_payload.json" > "$TMP_DIR/create.json"

  listing_id="$(node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(!d.ok||!d.listingId||!d.token){process.exit(1)}; console.log(d.listingId)" "$TMP_DIR/create.json")"
  token="$(node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(d.token)" "$TMP_DIR/create.json")"

  reservation_id=""
  pickup_code=""
  reservation_status="none"

  if (( i <= RESERVE_COUNT )); then
    claimer_uid="${CLAIMER_PREFIX}_$i"
    idem_key="seed_$(date +%s)_${i}_reserve"
    cat > "$TMP_DIR/reserve_payload.json" <<JSON
{
  "claimerUid": "$claimer_uid",
  "qty": 1,
  "disclaimerAccepted": true,
  "idempotencyKey": "$idem_key"
}
JSON

    curl -fsS -X POST "$BASE_URL/recipient/listings/$listing_id/reserve" \
      -H 'content-type: application/json' \
      --data-binary "@$TMP_DIR/reserve_payload.json" > "$TMP_DIR/reserve.json"

    reservation_id="$(node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(!d.ok||!d.reservation||!d.reservation.id){process.exit(1)}; console.log(d.reservation.id)" "$TMP_DIR/reserve.json")"
    pickup_code="$(node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(d.reservation.pickupCode || '')" "$TMP_DIR/reserve.json")"
    reservation_status="reserved"

    if (( i <= CONFIRM_COUNT )); then
      cat > "$TMP_DIR/confirm_payload.json" <<JSON
{
  "token": "$token",
  "reservationId": "$reservation_id",
  "pickupCode": "$pickup_code"
}
JSON
      curl -fsS -X POST "$BASE_URL/enterprise/listings/$listing_id/confirm-pickup" \
        -H 'content-type: application/json' \
        --data-binary "@$TMP_DIR/confirm_payload.json" > "$TMP_DIR/confirm.json"
      node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(!d.ok||!d.confirmed){process.exit(1)}" "$TMP_DIR/confirm.json"
      reservation_status="completed"
    fi
  fi

  printf "%s\t%s\t%s\t%s\t%s\t%s\n" \
    "$i" "$listing_id" "$token" "$reservation_id" "$reservation_status" "$venue" >> "$SUMMARY_FILE"
done

echo
echo "Seed complete. Summary:"
echo "idx | listingId | token | reservationId | reservationStatus | venueId"
echo "----|-----------|-------|---------------|-------------------|--------"
awk -F'\t' '{printf "%s | %s | %s | %s | %s | %s\n", $1,$2,$3,$4,$5,$6}' "$SUMMARY_FILE"
echo
echo "Enterprise edit URLs:"
while IFS=$'\t' read -r idx listing_id token reservation_id reservation_status venue_id; do
  edit_url="${WEB_BASE_URL}/enterprise/edit/${listing_id}?token=${token}"
  echo "[$idx] $edit_url"
done < "$SUMMARY_FILE"
