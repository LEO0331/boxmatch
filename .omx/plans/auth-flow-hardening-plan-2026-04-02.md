# Boxmatch Auth Flow Hardening Plan (2026-04-02)

## Scope assumption
This plan assumes the target feature is **shipping the existing authentication flow safely** (recipient token migration + enterprise edit-token hardening), based on current code and docs.

## Requirements Summary
1. Preserve existing dual-mode recipient auth behavior during migration window while reducing spoofing risk.
2. Keep enterprise no-login token edit flow operational (create / validate / rotate / revoke / confirm pickup).
3. Make token-only rollout (`REQUIRE_ID_TOKEN=true`) deployable without breaking smoke checks and runbooks.
4. Add sufficient automated verification for auth-critical server paths.

## Current architecture baseline (evidence)
- Recipient auth middleware is centralized under `/recipient` and supports bearer token + legacy fallback: `server/index.js:235-294`.
- Token-only enforcement is controlled by env flag `REQUIRE_ID_TOKEN`: `server/index.js:51`, `server/index.js:240-246`.
- UID mismatch protection exists (`AUTH_UID_MISMATCH`): `server/index.js:272-278`.
- Recipient write/list/cancel/report endpoints rely on middleware-resolved `req.recipientUid`: `server/index.js:581-900`.
- Client sends bearer token when available and still sends `claimerUid` for compatibility: `lib/features/surplus/data/firestore_surplus_repository.dart:265-337`, `523-539`.
- Recipient identity comes from Firebase anonymous auth with local fallback: `lib/core/identity/firebase_recipient_identity_service.dart:17-42`, `lib/core/identity/local_recipient_identity_service.dart:14-30`.
- Enterprise auth is token-hash verification on listing docs (`editTokenHash`): `server/index.js:541-575`, used by enterprise endpoints `1057-1360`.
- Firestore denies direct listing/reservation writes from clients: `firestore.rules:13-23`.
- Docs already define phase-1 migration window as **2026-04-02 to 2027-04-01**: `docs/ops/client-network-policy.md:42-53`.

## Acceptance Criteria (testable)
1. Recipient auth behavior
   - Without bearer token and `REQUIRE_ID_TOKEN=false`, recipient endpoints accept valid `claimerUid`.
   - Without bearer token and `REQUIRE_ID_TOKEN=true`, recipient endpoints return `401` + `AUTH_ID_TOKEN_REQUIRED`.
   - With bearer token + mismatched `claimerUid`, return `400` + `AUTH_UID_MISMATCH`.
   - With valid bearer token, recipient identity is token UID regardless of body.
2. Enterprise token behavior
   - Invalid enterprise token returns `403` and does not allow update/reservation list/confirm.
   - Rotate returns new working token and invalidates old one.
   - Revoke invalidates token immediately.
3. Operational readiness
   - Smoke flow supports both legacy mode and token-required mode (or clearly gates token-required mode with explicit precheck).
   - Runbook and environment docs include `REQUIRE_ID_TOKEN` and migration-stage instructions.
4. Quality gates
   - Server auth-critical paths have automated tests in CI.
   - Flutter tests that cover auth-related client behavior remain green.

## Implementation Steps

### 1) Freeze and document auth contract before edits
- Add an auth contract doc section with canonical status/error codes and mode matrix.
- Files:
  - `docs/ops/client-network-policy.md` (extend migration section)
  - `docs/ops/environment-matrix.md` (add `REQUIRE_ID_TOKEN`)
  - `docs/ops/deploy-runbook.md` (add staged rollout + rollback conditions)

### 2) Refactor server auth seams for testability (behavior-preserving)
- Extract recipient auth resolution and enterprise token verification helpers into focused modules while preserving endpoint behavior.
- Keep API surface and error codes unchanged.
- Files:
  - `server/index.js` (wire-up)
  - new `server/auth/*` helpers (recipient auth, enterprise token verification, shared errors)

### 3) Add server auth regression tests (no new runtime deps)
- Use Node built-ins (`node:test`, `assert`) and existing server stack to validate middleware/result codes.
- Cover all recipient mode combinations and enterprise token invalidation scenarios.
- Files:
  - new `server/test/auth/*.test.js`
  - `server/package.json` scripts for test execution

### 4) Make smoke tests auth-mode aware
- Update smoke script to detect/run correctly in both modes:
  - Legacy-compatible run (current behavior)
  - Token-required run via provided ID token (or explicit skip/fail-fast guidance)
- Ensure script output surfaces `requestId` + failing step on auth failures.
- Files:
  - `scripts/smoke_test.sh`
  - `docs/ops/smoke-test.md`

### 5) Tighten client migration behavior and observability
- Ensure recipient API calls always include auth when available and preserve fallback semantics.
- Surface server `code` + `requestId` cleanly in user-safe error handling paths.
- Files:
  - `lib/features/surplus/data/firestore_surplus_repository.dart`
  - auth-sensitive UI surfaces in:
    - `lib/features/surplus/presentation/browse/reservation_confirmation_page.dart`
    - `lib/features/surplus/presentation/browse/my_reservations_page.dart`

### 6) Stage rollout
- Stage A (staging): `REQUIRE_ID_TOKEN=true`, run full smoke + regression tests.
- Stage B (production canary): enable token-required mode during low-traffic window, monitor error rates (`AUTH_ID_TOKEN_REQUIRED`, `AUTH_ID_TOKEN_INVALID`, `AUTH_UID_MISMATCH`).
- Stage C (full): keep legacy path disabled once metrics stabilize.

## Risks and Mitigations
- **Risk:** Token-required mode breaks clients still on legacy path.
  - **Mitigation:** staged rollout + smoke in token-required mode first + explicit rollback toggle.
- **Risk:** Auth refactor changes behavior subtly.
  - **Mitigation:** add behavior-locking tests before and after extraction.
- **Risk:** Ops docs drift from implementation.
  - **Mitigation:** make docs updates part of same PR and release checklist gate.
- **Risk:** Enterprise token leakage persists via link sharing.
  - **Mitigation:** keep rotate/revoke UX prominent and document incident SOP usage.

## Verification Steps
1. Local static checks
   - `flutter analyze`
   - `flutter test`
   - `cd server && npm test`
2. Local/preview API checks
   - Recipient matrix test (legacy vs token-required)
   - Enterprise token rotation/revocation regression tests
3. Staging checks
   - `scripts/smoke_test.sh` in legacy-compatible mode
   - `scripts/smoke_test.sh` (or companion flow) in token-required mode
4. Pre-prod release gate
   - Confirm runbook checklist includes auth mode + rollback toggle
   - Confirm no unresolved auth regression failures

## Out of Scope
- Replacing enterprise token-link model with fully authenticated enterprise accounts.
- Cross-service SSO or external IAM integration.

