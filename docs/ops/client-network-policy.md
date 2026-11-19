# Client Network Policy (Day 9)

## Scope

- Flutter API calls from `lib/features/surplus/data/firestore_surplus_repository.dart`.
- Applies to reserve + token validation + enterprise reservation fetch endpoints.
- Recipient endpoints now send bearer token when available:
  - `Authorization: Bearer <Firebase ID token>`

## Timeout

- Default HTTP timeout: `8s` per request attempt.
- Timeout error shown to user after retries are exhausted:
  - `Network timeout. Please try again.`

## Retry Policy

- Max attempts: `3` for retry-enabled endpoints.
- Backoff schedule:
  - Attempt 1 -> 2 delay: `300ms`
  - Attempt 2 -> 3 delay: `800ms`
  - Later fallback delay: `1500ms`
- Retry on:
  - Timeout (`TimeoutException`)
  - Transport failure (`http.ClientException`)
  - Retryable HTTP status: `408`, `429`, `500`, `502`, `503`, `504`
- Do not retry on non-retryable business/permission responses (e.g. `400`, `401`, `403`, `404`, `409`, `422`).

## Idempotency Key Reuse Rule

- Reserve request includes `idempotencyKey`.
- A key is generated once per reserve action in client code.
- All automatic retries for that same reserve action reuse the same request payload and the same `idempotencyKey`.
- Server deduplicates with `(claimerUid, listingId, idempotencyKey)` hash and returns prior successful result for replay.

## Current Retry-Enabled Calls

- `POST /enterprise/listings/:listingId/validate-token`
- `POST /enterprise/listings/:listingId/reservations`
- `POST /recipient/listings/:listingId/reserve`

## Recipient Auth Migration (Production Token Enforcement)

- The 2026-04-02 legacy phase accepted a client-supplied `claimerUid` without authenticating it. This is unsafe for publicly deployed recipient routes.
- Current production policy after this review: Render sets `REQUIRE_ID_TOKEN=true`.
- Client behavior:
  - obtains a Firebase anonymous user and sends the ID token as a bearer token on recipient routes.
  - keeps the `claimerUid` body only for backward-compatible payload structure; the server verifies it matches the token.
- Server behavior:
  - derives the authoritative UID from the verified Firebase token.
  - rejects missing tokens (`401 AUTH_ID_TOKEN_REQUIRED`) or mismatched UIDs (`400 AUTH_UID_MISMATCH`).
  - permits UID-only fallback only when explicitly configured `REQUIRE_ID_TOKEN=false` for isolated local development.
- Rollout: verify Firebase anonymous sign-in, deployment environment variables, and older mobile client versions before/after production deployment. Older clients without tokens will no longer be able to reserve, list or cancel.

## Notes

- Keep retry count conservative on Spark/POC infra to avoid accidental traffic spikes.
- For create/update/revoke actions, retries can be enabled later only after validating full idempotency guarantees.
