# Architecture baseline

Updated 2026-11-26. The deployed full-stack application is designed for low-cost operation with server-authoritative business mutations.

| Layer | Current design |
|---|---|
| Client | Flutter Web/mobile, GitHub Pages, public listing/map and recipient workflows |
| API | Node.js/Express on Render free tier, Firebase Admin SDK |
| Data and identity | Firebase Spark, Cloud Firestore, anonymous recipient auth, dedicated administrator email/password auth |
| Read boundary | Public catalog, owner-only reservations (opt-in direct query; authenticated API rollback) |
| Write boundary | Server-only business mutations and private metadata; transactions and idempotency |
| Observability | Structured request logs, optional crawler verification/risk/geography, daily aggregates and protected CSV dashboard |
| Delivery | GitHub Actions backend, Flutter, Firestore emulator and browser regression checks |

The versioned startup migration remains fail-closed. No active traffic blocking or new paid infrastructure is included. Direct database and static-only traffic bypass Express. Render free-tier cold starts and project-wide quotas remain operational constraints.

See [system design](../system-design-review.en.md), [部署手冊](deploy-runbook.md), [final review](../TRAFFIC_FINAL_REVIEW.md), and [reservation performance](reservation-loading-performance.md).


See [overall security architecture / 整體資安架構](../SECURITY_ARCHITECTURE.md). The opt-in [passive probe extension](../SECURITY_PROBE_INTELLIGENCE.md) reuses existing observation and daily aggregate infrastructure without new client permissions or enforcement.
