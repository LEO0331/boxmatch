# Traffic intelligence final remediation

Scope: observation-only Phases 1–3. All eleven remediation findings were implemented and merged in [PR #56](https://github.com/LEO0331/boxmatch/pull/56). No active blocking or new infrastructure. Source defaults remain disabled; deployed activation is operator-controlled.

| Finding | Remediation |
|---|---|
| TI-001 | Render repository-root build/start commands preserve shared scripts. Confirm the actual Render Root Directory is blank and commands match before redeploying. |
| TI-002 | Separate candidate token verification budget and authenticated operation allowance. Forged bearer traffic may still saturate verification capacity. |
| TI-003 | Disable date changes and refresh during CSV export, retaining session/epoch checks. |
| TI-004 | Explicit normal flush deadline; hold the underlying transaction slot until settlement and retain stable marker identity. Unrecoverably hung SDK work still requires restart. |
| TI-005 | Shared CSV status column with missing/invalid/unsupported days distinguished from real zero counts. |
| TI-006 | Include runtime scripts/rules/config in backend CI triggers; add default and opt-in browser CI. |
| TI-007 | Document the origin-only strict-origin map-compatible referrer policy. |
| TI-008 | Advertise supported dashboard periods; minimum configured maximum is seven days. |
| TI-009 | Exclude authorized normalized admin operations from behavior counters without excluding denied/malformed probes. |
| TI-010 | Bounded incremental business rate-window cleanup with independent expiry for the requested identity. |
| TI-011 | Shared analytics constants and CSV formatting; keep business logic separate. |

## Acceptance

Run backend npm ci/lint/test/audit, Flutter analyze/tests/coverage, both browser builds and their Playwright suites. Verify the actual Render root, proxy forwarding, Firebase project/provider and deployed rules, administrator provisioning/revocation, optional local licensed geography files, real data delivery and read/write/memory quotas in an approved environment. Confirm map tiles and existing reservation flows. Keep all feature switches off until explicitly enabled by the operator. Source changes and automated CI do not establish production readiness.


## Verified baseline (2026-11-26)

Following [reservation performance PR #57](https://github.com/LEO0331/boxmatch/pull/57), [all five checks passed](https://github.com/LEO0331/boxmatch/pull/57/checks): backend 546 tests across 31 suites, Flutter 89.32% coverage, real Firestore emulator security tests, and both browser builds. Backend npm audit reported zero vulnerabilities at that revision. The owner confirmed administrator dashboard access on 2026-11-26; aggregation, live rules, direct-read activation, geo/proxy and quotas have not been independently verified here.

The reviewed development scope is complete; continue with [operational acceptance](ops/deploy-runbook.md) and maintenance rather than a new active-enforcement phase.
