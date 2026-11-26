# Deployment runbook

Updated 2026-11-26. Source defaults are not proof of live configuration.

## Deployment prerequisites

- Render service: repository root (Root Directory blank), build `cd server && npm ci`, start `cd server && npm start`, health `/health`. Verify actual settings, Firebase Admin credentials, required ID tokens and allowed CORS origin.
- GitHub Pages: Actions source, API base URL if non-default, explicit compile-time repository variables.
- Firebase: correct project, deployed rules and indexes, enabled anonymous auth, dedicated email/password account for traffic administration.
- Existing `RENDER_DEPLOY_HOOK_URL` secret if using the deploy-hook workflow. Keep all private credentials out of the repository.

## Release flow

1. Review applicable CI checks and [release checklist](release-checklist.md).
2. Merge approved changes. Render deployment and Pages build are triggered by their configured workflows/auto-deploy.
3. Verify Render health, Firebase settings and actual Pages deployment revision.
4. Smoke test public map/listing, reserve/cancel/pickup, authenticated read and optional dashboard. Use a controlled test identity/listing; do not mutate real user records for a smoke test.

## Traffic dashboard

Follow [dashboard setup](../TRAFFIC_DASHBOARD.md) and [analytics configuration](../TRAFFIC_ANALYTICS.md). Enable only the required backend flags and matching Pages variables:

| Purpose | Render | Pages variable |
|---|---|---|
| Request intelligence | `ENABLE_REQUEST_INTELLIGENCE` | — |
| Crawler verification (optional) | `ENABLE_BOT_VERIFICATION` | — |
| Website visits | `ENABLE_FRONTEND_TELEMETRY` | `BOXMATCH_ENABLE_TELEMETRY` |
| Daily aggregation | `ENABLE_TRAFFIC_AGGREGATION` | — |
| Administrator access | `ENABLE_TRAFFIC_ADMIN` | `BOXMATCH_ENABLE_TRAFFIC_ADMIN` |
| Local country/ASN (optional) | `ENABLE_GEO_ENRICHMENT` | — |

Use exact string `true` when enabling. Configure `REQUEST_IP_HMAC_SECRET` securely and only set `TRUST_PROXY_CIDRS` after verifying actual topology. No production secrets belong in frontend defines. GeoIP requires local licensed databases. Rebuild Pages after changing variables.

Create a dedicated non-anonymous account, enable Email/Password, verify authorized domains, install server dependencies and use authorized Firebase Admin credentials in a local operator terminal:

```sh
npm ci --prefix server
node scripts/manage_traffic_admin.js grant --uid YOUR_FIREBASE_UID
```

Sign in at [administrator login](https://leo0331.github.io/boxmatch/#/admin/login). Sign out/in after a claim change. Verify actual aggregates after the configured flush interval (default five minutes), and revoke only a controlled test account to exercise revocation. See the dashboard guide for revocation and safe credential handling.

## Reservation read rollout

Follow [reservation performance](reservation-loading-performance.md). After confirming deployed owner-only rules and green emulator CI, set GitHub Actions variable `BOXMATCH_DIRECT_RESERVATION_READS=true`, then rerun Pages deployment. False restores the authenticated API read path; denied Firestore reads never silently fall back. Mutations still require Express. Measure cold/warm navigation, refresh, cancellation and Firebase reads.

## Rollback

- Optional frontend/backend features: disable the affected flags and rebuild/redeploy as applicable. Keep authentication and security rules intact.
- Reservation reads: set the direct-read variable false and rebuild.
- Revert an offending application change via reviewed PR and verify deployment/health. If rolling back to a legacy listing writer or importing legacy data, stop affected writers/backend and run the forced privacy migration before restarting the current version; see [migration instructions](reservation-loading-performance.md).
- Inspect build/start logs, Firebase project/IAM configuration and rule deployment if health or authorization fails. Never log private tokens, credentials or pickup codes to diagnose an incident.

## Ongoing checks

Confirm aggregation coverage, actual proxy trust, memory and Firestore quotas, Render cold starts, authorization and map compatibility. No active crawler blocking is planned for the reviewed scope.
