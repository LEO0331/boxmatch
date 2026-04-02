# Boxmatch

![Coverage Gate](https://img.shields.io/badge/Coverage%20Gate-80%25%20minimum-blue)
[![Pages Deploy](https://github.com/LEO0331/boxmatch/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/LEO0331/boxmatch/actions/workflows/deploy-pages.yml)

Boxmatch is a lightweight surplus-food matching app for exhibitions.
Enterprises can post leftover lunchboxes or drinks, and nearby users can reserve for pickup.

## MVP Highlights

- Listing feed + map view (OpenStreetMap) for curated exhibition venues.
- Enterprise posting flow with minimal public profile fields.
- No-login enterprise edit flow using secure tokenized edit links.
- Recipient reserve flow with disclaimer confirmation and 4-digit pickup code.
- Spark-friendly expiry handling: realtime updates + 30-minute client reconciliation.
- Donation-first model (`price = 0`) with schema ready for low-price offers later.

## Data Model (Firestore)

Collections used:

- `venues`
- `listings`
- `reservations`
- `abuse_signals`
- `kpi_daily`
- `kpi_summary`
- `kpi_events` (optional, controlled by backend env)

See `firestore.rules` and `firestore.indexes.json` for starter Firebase config.

## Run

```bash
flutter pub get
flutter run
```

## Firebase Notes

The app attempts Firebase initialization first.
If Firebase is not configured in the current environment, it automatically falls back to local in-memory demo mode so development can continue.

To enable Firebase mode in production:

1. Create a Firebase project.
2. Add platform configs (`google-services.json`, `GoogleService-Info.plist`, etc.).
3. Deploy Firestore rules/indexes.

## API Backend (Spark-friendly)

This project now uses a standalone Node API in `server/` (Render deploy) instead of Firebase Functions, so you can stay on Firebase Spark plan.

Set your API URL when building/running Flutter:

```bash
flutter run --dart-define=BOXMATCH_API_BASE_URL=https://<your-render-service>.onrender.com
```

## GitHub Pages (Auto Deploy)

Web app deploy is automated by:

- `.github/workflows/deploy-pages.yml`

On every push to `main`, CI builds Flutter web and deploys to GitHub Pages.

One-time setup in GitHub:

1. Repo `Settings` -> `Pages`
2. `Build and deployment` -> `Source` = `GitHub Actions`
3. (Optional) add repo secret `BOXMATCH_API_BASE_URL` if you want a non-default API URL in web build

### KPI Export (weekly/monthly report)

From repo root:

```bash
cd server
npm run export:kpi:7d
npm run export:kpi:30d
```

## Testing

```bash
flutter analyze
flutter test
```

### Coverage Gate Rule

- CI workflow: `.github/workflows/flutter-ci.yml`
- Rule: overall coverage is calculated from `coverage/lcov.info`.
- Fail condition: CI fails when overall coverage is **below 80%**.

## Release Smoke + Gate

Production deploy gate workflow:

- `.github/workflows/release-checklist-gate.yml`
- checklist doc: `docs/ops/release-checklist.md`

## Seed Testing Data (POC)

Generate multiple demo listings/reservations via backend API
Optional knobs:

- `SEED_LISTING_COUNT` (default `6`)
- `SEED_RESERVE_COUNT` (default `3`)
- `SEED_CONFIRM_COUNT` (default `1`)

## Execution Board

- 30-day POC board for GitHub Wiki:
  - [docs/wiki/30-day-poc-board.md](https://github.com/LEO0331/boxmatch/wiki/30%E2%80%90Day-POC-Execution-Plan-(Free%E2%80%90Tier-First))

## Postman API Collection

Recommended run order in collection:

1. `Health`
2. `Enterprise - Create listing`
3. `Enterprise - Validate token`
4. `Recipient - Reserve listing`
5. `Recipient - Reserve replay (same idempotency key)`
6. `Enterprise - List reservations`
7. `Enterprise - Update listing`
8. `Enterprise - Confirm pickup`
9. `Enterprise - Rotate token`
10. `Enterprise - Revoke token`

Collection tests auto-save `listingId`, `token`, `reservationId`, `pickupCode` for downstream requests.
