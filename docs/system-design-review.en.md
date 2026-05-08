# Boxmatch System Design Review (EN)

## 1) Scope and Objectives
- Product goal: match exhibition surplus food/drinks from enterprises to recipients quickly and safely in public pickup areas.
- MVP constraints:
  - Keep Firebase on Spark plan.
  - Avoid paid Firebase Functions/Cloud Scheduler.
  - Keep enterprise flow lightweight (token link, no enterprise login in MVP).

## 2) Current Architecture
- Client: Flutter (Web + Mobile).
- Backend API: Node.js + Express on Render.
- Database/Auth: Firestore + Firebase Auth (Anonymous + ID token compatible flow).
- CI/CD: GitHub Actions + Render deploy hook + GitHub Pages for web app.

Flow boundary:
- Sensitive writes are backend-only (Admin SDK), not client Firestore writes:
  - listing create/update/rotate/revoke
  - reserve/cancel/confirm
  - abuse signal submit
- Firestore rules enforce read-mostly from clients and block direct writes for protected collections.

## 3) Data Model and Why

### 3.1 Collections in use
- `venues`
- `listings`
- `reservations`
- `abuse_signals`
- `verified_enterprises`
- `badge_rules`
- `idempotency_keys`
- `kpi_daily`, `kpi_summary` (and optional `kpi_events`)

### 3.2 Why these structures (and alternatives)

1. `venues` as curated top-level collection
- Why chosen:
  - Stable reference data reused by many listings.
  - Small, cache-friendly, easy to seed.
  - Prevents typo drift for venue names.
- Alternative:
  - Embed venue text directly in each listing.
- Tradeoff:
  - Embedded text is simpler initially but causes data inconsistency and weak filtering/grouping later.

2. `listings` top-level (not nested under venue)
- Why chosen:
  - Query by time/status globally is straightforward.
  - Better for list/map combined feed and cross-venue operations.
  - Simpler indexes for active feed (`expiresAt`, `status`).
- Alternative:
  - `/venues/{venueId}/listings/{listingId}` nested subcollection.
- Tradeoff:
  - Nested can improve locality per venue but makes cross-venue feed and some analytics queries heavier.

3. `reservations` top-level with `listingId` + `claimerUid`
- Why chosen:
  - Supports both recipient-centric and listing-centric queries.
  - Simplifies enterprise reservation management endpoint.
  - Enables per-recipient limits and cancellation policies.
- Alternative:
  - Nested under listing (`/listings/{id}/reservations`).
- Tradeoff:
  - Nested is intuitive for listing scope, but recipient “my reservations” query becomes more expensive/multi-query.

4. `idempotency_keys` dedicated collection
- Why chosen:
  - Prevent duplicate reserve writes during retries/network instability.
  - Keeps reserve endpoint replay-safe without requiring distributed cache.
- Alternative:
  - Keep last request hash on reservation doc only.
  - Redis/memory cache dedupe.
- Tradeoff:
  - Doc-only hash is harder for robust dedupe across failure windows.
  - Redis adds infra cost/ops overhead (not ideal for POC free tier).

5. `verified_enterprises` separate collection
- Why chosen:
  - Decouples trust/moderation lifecycle from listing documents.
  - Allows manual/operational review workflows and future admin panel.
- Alternative:
  - Put `enterpriseVerified` static flag directly in listing input.
- Tradeoff:
  - Listing-only flag is easy to spoof/abuse and hard to govern.

6. `badge_rules/default` configuration document
- Why chosen:
  - Server-calculated badges are adjustable without app redeploy.
  - Keeps business thresholds out of client hardcode.
- Alternative:
  - Hardcode badge thresholds in Flutter app.
- Tradeoff:
  - Hardcoding is simpler short-term but causes version drift and slower policy changes.

7. `kpi_daily` + `kpi_summary` aggregate docs
- Why chosen:
  - Cheap and simple KPI storage on Spark.
  - Supports dashboard-style reporting without full analytics stack.
- Alternative:
  - BigQuery event warehouse first.
- Tradeoff:
  - BigQuery is more scalable for deep analytics, but too heavy for POC cost profile.

## 4) API and Security Tradeoffs

### 4.1 Enterprise no-login token model
- Chosen:
  - Edit URL includes token, server stores hash only (`editTokenHash`), supports rotate/revoke.
- Why:
  - Lowest friction for enterprise event staff.
  - Works in Spark/free-tier constraints.
- Risks:
  - Token leak risk via URL sharing/history.
- Mitigations:
  - Token hash storage, rotation/revocation endpoints, logging taxonomy, moderation SOP.
- Alternative:
  - Full enterprise auth (email/password, SSO, invite roles).
- Tradeoff:
  - Stronger identity assurance but higher onboarding friction and product complexity.

### 4.2 Recipient identity model (compatible migration)
- Chosen:
  - Support both Bearer Firebase ID token and legacy `claimerUid` during transition.
- Why:
  - Backward compatibility while migrating older clients.
- Risk:
  - Legacy mode weaker against spoofing.
- Mitigation:
  - `REQUIRE_ID_TOKEN` switch for hard enforcement when ready.
- Alternative:
  - Immediate token-only cutover.
- Tradeoff:
  - Better security now, but potential abrupt breakage for existing clients.

### 4.3 Server-side authoritative writes
- Chosen:
  - Firestore Admin SDK performs all high-privilege writes.
- Why:
  - Centralized validation, transactional inventory control, abuse controls.
- Alternative:
  - Let client write directly with complex rules.
- Tradeoff:
  - Client-direct can reduce backend cost, but rules become fragile and business logic is harder to evolve safely.

## 5) Reliability and Performance Tradeoffs
- Chosen reliability controls:
  - reserve idempotency key
  - transaction decrement for `quantityRemaining`
  - client timeout/retry policy
  - enterprise polling backoff
  - app startup health warmup
- Why:
  - Handles free-tier cold starts + unstable network with minimal infra.
- Known limitations:
  - Render free cold starts can cause first-request latency.
  - No queue/worker separation yet.
- Alternatives:
  - Paid always-on service, queue workers, Redis locks.
- Tradeoff:
  - Better latency/throughput but higher recurring cost and operational overhead.

## 6) Why This Fits Spark-Plan POC
- Avoids Firebase Functions Blaze requirement.
- Keeps architecture simple and testable.
- Preserves path to scale:
  - can enforce token-only auth,
  - can split API modules,
  - can move analytics to warehouse later,
  - can add enterprise account model when needed.

## 7) Deep-Dive Q&A Prep

### Q1: Why not use Firebase Functions directly?
- Current blocker is plan/cost constraints for deployment requirements.
- Render API keeps server authority and works under Spark strategy.

### Q2: Why top-level `reservations` instead of subcollection under listing?
- Recipient-centric listing of “my reservations” becomes much easier and cheaper.
- Cross-listing moderation and rate-limit checks are also simpler.

### Q3: How do you prevent overbooking race conditions?
- Reserve path uses Firestore transaction and checks `quantityRemaining` atomically.
- Idempotency keys prevent duplicate decrements from retries.

### Q4: How is enterprise identity trusted without login?
- It is a controlled low-friction trust model:
  - token proof, hash verification, rotate/revoke, verification collection, posting limits.
- For stronger identity, roadmap is enterprise auth + approval workflow.

### Q5: How do you handle abuse at recipient side?
- UID/day caps, idempotency controls, abuse reporting endpoint, moderation playbook.
- Migration path to strict ID-token mode already prepared.

### Q6: Why keep badge rules in Firestore?
- Operational agility: PM/Ops can tune thresholds without Flutter release cycle.
- Maintains consistency across web/mobile instantly via backend calculation.

### Q7: What are the biggest production risks now?
- Cold start latency on free backend.
- Token-link leakage for enterprise if shared carelessly.
- Legacy uid compatibility period if prolonged too long.

### Q8: What is the clean scale-up path?
- Phase out legacy uid (`REQUIRE_ID_TOKEN=true`).
- Introduce enterprise account + role-based access.
- Add managed caching/queue and observability stack.
- Optionally split read/write services and add async event pipeline.

## 8) Recommended Talking Track for Review
- Start with constraints: “free-tier POC with server-authoritative safety.”
- Explain identity strategy as phased migration, not final state.
- Emphasize why each collection exists and what query pattern it unlocks.
- Close with explicit upgrade path (auth hardening, performance hardening, ops hardening).
