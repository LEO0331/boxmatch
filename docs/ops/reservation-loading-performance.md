# Reservation loading performance

## Read path

The opt-in flag `BOXMATCH_DIRECT_RESERVATION_READS=true` uses the default Firebase Auth account and the exact owner-filtered server-source Firestore query. No direct write, rule relaxation or unauthenticated/local fallback is allowed. The existing API is retained as a deliberate rollback path, not a fallback for denied reads. Reserve/cancel/confirm and inventory changes remain on Express.

The repository holds one authenticated recipient's most recent list in memory for 30 seconds. Every navigation/refresh requests an authoritative list; cached records are labeled as refreshing and actions are disabled until confirmed. Successful mutations invalidate the snapshot. Identity change rejects late results and clears the page. No new persistent browser storage is used. Firebase's own platform caching behavior is unchanged. Listing details are fetched independently in bounded batches, and missing details cannot suppress pickup codes. No automatic retry of the full page. The frequently used reservation route is eagerly loaded rather than deferred.

## Security verification and rollout

1. Require green Firestore Rules CI, backend, Flutter and browser jobs before merging. The isolated emulator uses a demo project and real repository rules; it asserts owner-only query and document reads, denies foreign/unfiltered/unauthenticated queries and all client mutations, and verifies the new migration marker and analytics remain server-only.
2. Verify the actual deployed Firebase rules match `firestore.rules` in the correct project. Deploy rules through the existing approved operator process if needed.
3. In GitHub repository Settings → Secrets and variables → Actions → Variables, set `BOXMATCH_DIRECT_RESERVATION_READS=true`. Re-run Deploy Flutter Web to GitHub Pages on main. Default false preserves the authenticated API route until the operator explicitly enables direct reads.
4. In a controlled session, verify cold and warm navigation, empty history, owner-only reads, cancellation, refresh, pickup confirmation and identity isolation. Compare browser network timings and Firestore document-read usage. No production timings have been measured by this change.
5. Roll back by setting the variable to false and rebuilding. Direct Firestore queries are not included in Express request analytics; website page-view telemetry remains unchanged.

## Startup migration

The first startup without a valid marker still waits for the full idempotent privacy migration. Only successful completion writes `schema_migrations/listing_privacy_v1`. Subsequent starts read one marker rather than scanning every listing; no client may read or change the marker. Concurrent first starts can repeat the safe scan. A failed scan or failed marker write blocks startup; the next startup retries. Existing migrated data is not altered by the marker itself.

The operator CLI `node scripts/migrate_listing_privacy.js` (from repository root with authorized Firebase Admin credentials and server dependencies installed) first invalidates the completion marker and then forces a scan. Stop legacy writers and the current backend before a legacy import or rollback, and complete the CLI migration before restarting the current backend. A failed forced scan leaves the marker incomplete. Do not manually fabricate a completion marker.

Render free-tier wake-up time remains for mutation operations and protected analytics. This change does not alter plan, proxy settings, feature flags for traffic monitoring, or production Firebase configuration.
