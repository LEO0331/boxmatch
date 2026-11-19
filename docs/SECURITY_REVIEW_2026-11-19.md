# Boxmatch Security Review — 2026-11-19

**Status:** Source-based review and proposed remediation on `security/boxmatch-review-hardening-20261119`. Merge, production rollout, and deployed-environment validation are **not** implied by this document.

## Scope and methodology

Reviewed current `main` (starting at `999fcf823868072adb972550c8bd312e4839f5bf`), focusing on:

- Node/Express endpoints in `server/index.js`, backend Jest suites, and dependency manifests
- Firebase Admin authority, Firestore rules, public listing/reservation data, and anonymous recipient identity
- Flutter API authentication and retry behavior in `lib/features/surplus/data/firestore_surplus_repository.dart`
- Render deployment variables and GitHub Actions CI/deployment configuration

Methods: manual source and trust-boundary review, review of existing regression tests and prior dependency-remediation PRs, and addition of targeted security regression tests. **No live penetration test, authenticated production abuse test, independent secrets scan, or full registry audit was executed as part of the initial review.** CI verification results must be checked on the proposed PR.

## Findings and disposition

| ID | Severity | Finding | Evidence | Disposition |
|---|---|---|---|---|
| BM-SEC-01 | **High** | Public Render config allowed legacy recipient requests with caller-supplied `claimerUid`; reservation list returns pickup codes and cancellation trusts the resulting UID. This can enable cross-user read/cancel when the victim UID is known. | `render.yaml` (`REQUIRE_ID_TOKEN=false`), `server/index.js` recipient middleware and list/cancel routes | **Remediated in proposed code:** Render now requires Firebase ID token, production defaults to token enforcement, verified UID is authoritative, and regression tests cover spoof attempts. **Production rollout not yet verified.** |
| BM-SEC-02 | **Medium** | Structured access/error logs used unredacted `req.originalUrl`; raw exception messages and stacks could contain tokens, query parameters, or sensitive details. Some events emitted recipient UIDs. | `server/index.js` | **Remediated in proposed code:** log route templates or a generic pre-route label; omit raw messages, stacks and affected UID event fields. Tests cover query/path leakage and internal error exposure. |
| BM-SEC-03 | **Medium** | CORS reflected any browser origin. Although CORS is **not authorization** and does not block non-browser clients, permissive policy is unnecessarily broad. | `server/index.js` `cors({origin:true})` | **Remediated in proposed code:** configured origin allowlist; production defaults to `https://leo0331.github.io`, Render explicitly sets `CORS_ALLOWED_ORIGINS`. Native requests without an Origin remain supported. |
| BM-SEC-04 | **Medium** | `resolveClientIp` read the first `X-Forwarded-For` entry unconditionally, allowing request-controlled identity values. | `server/index.js` | **Partially remediated:** now uses Express `req.ip`, which respects trusted-proxy settings. **Remain open:** verify Render's proxy chain before enabling any proxy trust; default untrusted proxy behavior can group unrelated users behind one upstream IP. |
| BM-SEC-05 | **Medium** | Unverified enterprise posting limit is based on user-selected display alias, with IP fallback only if no alias is supplied; alias rotation can evade this quota. It also uses a read-then-write count rather than an atomic quota ledger. | `deriveEnterpriseKey`, `/enterprise/listings/create` | **Open (follow-up required).** Use a server-owned identity/quota ledger with atomic admission, not a caller-selected alias. Evaluate privacy, verified-enterprise policies, Render proxy topology, abuse costs and rate-limit false positives before changing production behavior. |
| BM-SEC-06 | **Medium** | Backend CI checked syntax and tests, but not npm production dependency advisories. | `.github/workflows/backend-ci.yml` | **Remediated in proposed code:** adds `npm audit --omit=dev --audit-level=high` as a CI gate; does not establish that registry scan has passed until PR CI runs. |
| BM-SEC-07 | **Medium** | Report-abuse endpoint accepted unbounded reason strings up to the global 1MB JSON limit, with no per-identity reporting quota. | `/recipient/listings/:listingId/report-abuse` | **Partially remediated:** strict string types and 240-character reason / 128-character reservation ID bounds. **Remain open:** per-identity rate limits and duplicate-report controls to limit Firestore writes. |
| BM-SEC-08 | **Low / design** | Public Firestore listing reads include internal metadata such as `editTokenHash` and `enterpriseKey` because whole documents are readable. The edit tokens are generated from 24 random bytes and stored as SHA-256 hashes, not plaintext. | `firestore.rules`, `server/index.js` | **Open (data minimization).** Consider moving private fields to a server-only collection; do not claim the current hashes are directly reversible. |
| BM-SEC-09 | **Low** | An invalid non-string enterprise edit token could trigger a `crypto.update` exception and 500 response rather than a client validation error. | `verifyTokenAndFetchListing` | **Remediated in proposed code:** reject non-string/oversized tokens before hashing. |
| BM-SEC-10 | **Operational** | No-login enterprise bearer links can leak through URL sharing, screenshots and browser history; possession of a valid token allows enterprise actions until rotated or revoked. | `server/README.md`, enterprise token routes | **Accepted product-model risk, not fully fixed.** Token rotation/revocation and hash storage exist. Recommend `Referrer-Policy: no-referrer` on any host of token-bearing links, and a longer-term authenticated enterprise flow. |

## Existing defenses observed

- Firestore rules allow public reads of venues/listings but reject direct client writes to listings, reservations and abuse signals; reservation reads require matching authenticated UID.
- Firebase Admin executes protected writes; server validates hashed enterprise edit tokens.
- Reservation quantities are updated in Firestore transactions with idempotency keys; recipient daily caps exist.
- Recent Dependabot PRs patched runtime packages including `qs` and `body-parser`; existing `server/test/dependency.security.test.js` covers several advisory regressions.
- Backend Jest tests and Flutter tests/build gates already exist. These are **not** equivalent to a complete security assessment.

## Rollout and verification

1. **Before merge:** confirm the current Flutter web/mobile release signs in with Firebase anonymous Auth and attaches a valid bearer ID token to every recipient route. Existing mobile clients using only `claimerUid` **will receive 401** and must update.
2. Review `render.yaml` settings: `REQUIRE_ID_TOKEN=true` and `CORS_ALLOWED_ORIGINS=https://leo0331.github.io`. If using other trusted web origins, add their full **origin** (scheme/host/port) as comma-separated entries; do not include path components.
3. Run `cd server && npm ci && npm test && npm audit --omit=dev --audit-level=high`. Also run Flutter analysis/tests and browser E2E smoke tests.
4. Deploy and use real Firebase anonymous test users A and B to verify: missing/invalid tokens fail; A cannot list/cancel B's reservations; matching tokens work; enterprise edit/update/rotate/revoke/confirm remain functional.
5. Verify browser console/CORS from GitHub Pages, device flows, logs (no token/query/stack leakage), Render proxy behavior, and monitoring.
6. Monitor `401`, `403`, and `429` rates during rollout. Prepare to roll back **application code** if necessary, but **do not silently re-enable spoofable UID-only production access**.
7. Follow up with an atomic posting quota and abuse-report rate control, and data-minimization changes for publicly readable listing fields.

## Review limitations

- No ability from this repository view alone to inspect active Render secrets, GitHub security alerts or deployed Firebase Console/Auth/Firestore settings.
- The proposed changes do not prove an absence of other vulnerabilities and should not be called an external audit or security certification.
- The production-only npm audit is intentionally a *gate*; it does not replace static analysis, threat modeling, secrets scanning, authenticated API testing or runtime rate-limit monitoring.
