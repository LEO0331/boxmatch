# Boxmatch security review — 2026-11-25

Scope: current working tree, including pre-existing uncommitted backend changes. Reviewed Express routes, Flutter identity/network/token flows, Firestore rules, deployment workflows, scripts, dependency manifests and lockfiles. Application code was not changed during this review.

Original assessment: application findings were **0 critical, 1 high, 3 medium, 2 low**. The initial dependency audit reported **6 moderate and 1 low affected packages**; these were three underlying advisories plus propagated dependency findings. The sections below retain the original evidence and line references from the reviewed snapshot.

## Remediation status

All six application findings have code fixes and regression coverage. Verified status now binds to a registered Firebase `ownerUid`; daily posting counters are atomic and use server-derived principal/network identities. Listing edits preserve allocated inventory and revalidate current credentials transactionally. Abuse writes are budgeted and deduplicated, including signals written after failed transactions. Private metadata moves to `listing_private`, and an idempotent startup migration removes existing public copies before the listener opens. Legacy alias-only verification is cleared rather than inherited. Client links now keep edit tokens in fragments with a no-referrer policy.

Firebase Admin and transitive dependencies were patched; full and production-only npm audits now report **zero vulnerabilities**. Runtime modular SDK compatibility is covered separately from the legacy-shaped API mock. See `server/README.md` for ownership provisioning, migration, TTL deployment and trusted-proxy configuration. These are source changes; production rollout and active Firebase settings remain unverified.

Final verification: backend syntax check and **73 tests across 9 suites passed**; **39 targeted Flutter tests passed**, targeted Dart analysis reported no issues, and `git diff --check` passed. The expanded mock stages and rolls back transaction writes, enforces read-before-write ordering and serializes admissions. Live Firestore deployment behavior was not tested.

## Application findings

### 1. HIGH — Caller-selected names grant verified enterprise privileges

Evidence: `server/index.js:438`, `server/index.js:1238`, `server/index.js:1455`.

The public create route determines enterprise verification by querying the registry with the submitted display name and venue. It proves no relationship between the caller and that enterprise. Anyone copying a registered alias and venue can publish a listing bearing its verified badge and avoid the unverified daily posting limit. Existing public listings disclose these identifying fields. Updates also recalculate verification from editable fields.

Reproduction: with a trusted alias/venue seeded in the existing Firebase mock, unauthenticated creation using those values returned 200 and stored `enterpriseVerified=true` and the verified badge.

Remediation: bind verification to an authenticated enterprise principal or independently issued enterprise credential. Keep aliases as display data. Apply the same authorization during creation and updates. OWASP A01/A07.

### 2. MEDIUM — Posting quota identity is attacker-controlled

Evidence: `server/index.js:430`, `server/index.js:1251`.

Supplying a display alias replaces the IP quota key. Rotating aliases resets the daily allowance. The count and subsequent listing write are also separate operations, allowing concurrent requests to exceed a shared key's cap.

Reproduction: seven posts from the same IP with distinct aliases succeeded despite the default cap of five. This weakness remains open from the November 19 review.

Remediation: use a server-owned principal and an atomic admission counter, with complementary request limits for anonymous onboarding. Do not use an editable display field as identity. OWASP A04.

### 3. MEDIUM — Listing edits can restore inventory consumed by concurrent reservations

Evidence: `server/index.js:1428`, `server/index.js:1463`, `server/index.js:1477`.

The update route reads stock while checking the edit token, then writes stock calculated from that old snapshot. A reservation committed between the read and update is overwritten, even when the enterprise only edits a description.

Controlled reproduction using the existing mock: start with one unit; pause a description update after its snapshot; reserve that unit; finish the update. Both operations return 200, leaving one reservation and one unit available again.

Remediation: metadata-only updates should not rewrite inventory or status. Perform inventory edits in a transaction that reads current state and preserves reservation accounting; revalidate the edit credential in that transaction. OWASP A04.

### 4. MEDIUM — Abuse reporting allows unbounded database writes

Evidence: `server/index.js:810`, `server/index.js:1061`.

Every wrong enterprise edit token for an existing listing creates an abuse document without authentication or a request budget. Recipient report requests also create a fresh document with no quota or duplicate suppression; a single anonymous authenticated user can repeatedly report the same listing. This enables storage/write-cost amplification and moderation noise. String length checks do not bound request volume.

Remediation: rate-limit before database work, apply per-principal and deployment-aware network budgets, and deduplicate or sample repeated signals. Preserve useful security telemetry within bounded storage. OWASP A04.

### 5. LOW — Public listings expose internal metadata

Evidence: `firestore.rules:14`, `server/index.js:435`, `server/index.js:1288`.

Public reads expose the complete listing document, including `enterpriseKey` and `editTokenHash`. For alias-less listings, the key contains the server-resolved IP, potentially an end-user address or proxy address depending on deployment. Random 192-bit edit tokens make their SHA-256 hashes impractical to reverse; hash disclosure alone is not a demonstrated token compromise.

Remediation: separate private identity and credential metadata into a server-only document. Publish only fields required by recipients. OWASP A01/A02.

### 6. LOW — Failure signals inside rejected transactions never persist

Evidence: `server/index.js:920`, `server/index.js:1594`.

Unavailable-reservation and wrong-pickup-code branches queue an abuse write and immediately throw from the transaction. Real Firestore rolls back those writes. Generic request/error logs still exist, but these intended structured abuse records are missing. The current mock writes immediately and does not model rollback.

Remediation: emit a bounded signal after the transaction fails, outside the aborted transaction; verify with a rollback-aware mock or Firestore emulator. OWASP A09.

## Dependency findings

Both full and production-only backend `npm audit` reported seven affected packages: six moderate, one low, zero high/critical. The root Playwright package audit returned zero findings. These counts are package findings, not seven independent CVEs.

| Underlying advisory | Locked package | Severity | Patched version |
|---|---|---|---|
| [CVE-2026-118773 / GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) — cancellation bypass during filesystem traversal | nested `glob@10.5.0` | Moderate | `14.0.2` |
| [CVE-2026-118764 / GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) — pattern amplification denial of service | nested `minimatch@9.0.9` | Moderate | `11.0.1` |
| [CVE-2026-126066 / GHSA-474x-hrwr-fgx4](https://github.com/advisories/GHSA-474x-hrwr-fgx4) — quadratic XML parsing | `fast-xml-parser@5.11.2` | Low | `5.12.0` |

The remaining moderate package findings propagate through `rimraf`, `gaxios`, `gcp-metadata`, and `google-gax`. No attacker-controlled request path reaching these vulnerable routines was established during review. Update the Firebase dependency tree and lockfile using compatible upstream releases, rerun tests and audit, and inspect major-version constraints before applying overrides. Registry checks also found `firebase-admin@14.5.1` available versus installed `14.5.0`; that does not by itself establish that the patch clears every advisory.

## Validation and existing defenses

- Backend Jest: **5 suites, 40 tests passed**. Initial sandbox loopback restrictions were resolved by rerunning with approved local socket access.
- Independent backend review reproduced findings 1–3 through registered route handlers and the existing Firebase mock; no live database was touched. The controlled race validates the application interleaving, not production transaction behavior.
- Recipient middleware verifies Firebase ID tokens and rejects supplied-UID mismatches; production deployment configuration requires ID tokens.
- Firestore rules reject client writes to listings/reservations and restrict reservation reads to the matching authenticated UID.
- Enterprise edit tokens use cryptographic randomness, hash storage, timing-safe comparison, rotation and revocation.
- Targeted tracked-file secret patterns found no confirmed private credential; the private-key match in the README is an obvious placeholder. Firebase client configuration is not an Admin credential.
- No concrete SQL/command injection, XSS, path traversal or SSRF chain was established in inspected application paths.

## Limits and follow-up

This was a source review with local mocked tests and live npm advisory checks, not a production penetration test. Active Render/Firebase configuration, deployed rules, actual proxy topology, Git history secrets, and Flutter/native dependency advisories were not independently verified. Anonymous Firebase identity also permits account cycling; per-UID quotas alone do not establish a per-person limit. Enterprise bearer links remain sensitive capabilities stored in URLs/history; use fragment-based links and a restrictive referrer policy as defense in depth.

Prioritize enterprise verification, then atomic inventory updates and abuse budgets. Existing passing tests do not cover the confirmed impersonation and concurrency cases; add targeted regression tests when remediating.
