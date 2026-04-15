# Boxmatch 30-Day POC Execution Board (Free-Tier)

| Day | Theme | Engineering Task | Owner | KPI Target | Deliverable | Status |
|---|---|---|---|---|---|---|
| 1 | Baseline | Lock target architecture (Flutter + Render + Firebase Spark) and document system boundaries | PM + Eng-1 | Architecture doc approved | `docs/ops/architecture-baseline.md` | Done |
| 2 | Baseline | Finalize env variable contract (`BOXMATCH_API_BASE_URL`, Firebase service account vars) | Eng-1 | 100% env vars documented | `docs/ops/environment-matrix.md` | Done |
| 3 | Baseline | Add deploy checklist for local/dev/prod + rollback steps | Eng-1 | Deploy runbook completeness 100% | `docs/ops/deploy-runbook.md` | Done |
| 4 | Security | Confirm all enterprise writes are server-side only | Eng-1 | 100% enterprise writes via API | Rule + repo verification | Done |
| 5 | Security | Move recipient reserve to backend and lock client reservation writes | Eng-1 | 100% reserve writes via API | API + rules updated | Done |
| 6 | Security | Add API request validation hardening (required fields + type checks) | Eng-1 | Validation failure rate visible in logs | Input validation layer | Done |
| 7 | Security | Add abuse event taxonomy and structured logging keys | Eng-1 | 100% write failures tagged with reason code | Logging schema v1 | Done |
| 8 | Reliability | Add idempotency key support to reserve endpoint | Eng-1 | Duplicate reserve rate < 1% | Idempotent reserve logic | Done |
| 9 | Reliability | Add API timeout + retry policy in Flutter HTTP client | Eng-2 | API timeout UI error coverage 100% | `docs/ops/client-network-policy.md` | Done |
| 10 | Reliability | Add reservation polling backoff strategy (enterprise side) | Eng-2 | No excessive polling alerts | `docs/ops/enterprise-reservation-polling-policy.md` | Done |
| 11 | Reliability | Add health endpoint probe and uptime monitor setup (UptimeRobot free) | PM + Eng-1 | Uptime monitor active | `.github/workflows/health-probe.yml`, `docs/ops/uptime-monitor-setup.md` | Done |
| 12 | Reliability | Add error boundary UX for map/listing/reserve pages | Eng-2 | Crash-free session rate > 98% | `lib/core/widgets/load_error_view.dart` + key page integration | Done |
| 13 | Product UX | Add enterprise quick post template preset | Eng-2 | Post median time < 60s | `lib/features/surplus/presentation/enterprise/enterprise_listing_page.dart` | Done |
| 14 | Product UX | Add enterprise token safety UX (copy/regenerate warnings) | Eng-2 | Token misuse reports = 0 in pilot | Enterprise token guardrail UX in `enterprise_listing_page.dart` | Done |
| 15 | Product UX | Add recipient saved venues/favorites | Eng-2 | Return usage > 20% in pilot cohort | `lib/core/preferences/venue_favorites_store.dart` + list/map UI | Done |
| 16 | Product UX | Add clearer pickup status timeline (reserved/completed/expired) | Eng-2 | Pickup confusion tickets < 3 | `lib/features/surplus/presentation/browse/reservation_confirmation_page.dart` | Done |
| 17 | Product UX | Add bilingual copy pass (EN + zh-TW) for key flows | PM + Eng-2 | 100% key screens localized | `lib/core/i18n/app_strings.dart` + language switcher | Done |
| 18 | Data | Define KPI event model (`listing_created`, `reserved`, `pickup_confirmed`) | PM + Eng-1 | Event coverage 100% for core flow | `docs/ops/kpi-event-model.md` | Done |
| 19 | Data | Add lightweight metrics writer (Firestore aggregate docs) | Eng-1 | KPI dashboard data freshness < 15 min | Firestore `kpi_daily` + `kpi_summary` writer in `server/index.js` | Done |
| 20 | Data | Add weekly CSV export script for pilot reports | Eng-1 | Export generation success 100% | `scripts/export_kpi_csv.js` | Done |
| 21 | Data | Validate waste-reduction metric formula | PM + Eng-1 | Formula sign-off | `docs/ops/waste-reduction-formula.md` | Done |
| 22 | Ops | Create pilot day SOP (before/during/after event) | PM | SOP completed | `docs/ops/pilot-sop.md` | Done |
| 23 | Ops | Add incident report template (food safety/dispute/no-show) | PM + Eng-2 | Incident form ready | `docs/ops/incident-template.md` | Done |
| 24 | Ops | Add moderation playbook (suspend listing, revoke token, block abuse UID) | PM + Eng-1 | Moderation response < 15 min | `docs/ops/moderation-playbook.md` | Done |
| 25 | Quality | Add end-to-end smoke test script for core flow | Eng-1 | Smoke pass on each release | `scripts/smoke_test.sh`, `docs/ops/smoke-test.md` | Done |
| 26 | Quality | Add release checklist gate in GitHub Actions | Eng-1 | Checklist required before prod deploy | `.github/workflows/release-checklist-gate.yml`, `docs/ops/release-checklist.md` | Done |
| 27 | Pilot | Run pilot event #1 and collect baseline data | PM + Eng-2 | >= 20 successful pickups | `docs/wiki/pilot-report-1.md` | Blocked (Need real event data) |
| 28 | Pilot | Run pilot event #2 and compare baseline | PM + Eng-2 | >= 30 successful pickups cumulative | `docs/wiki/pilot-report-2.md` | Blocked (Need real event data) |
| 29 | Pilot | Analyze failures and prioritize top 5 fixes | PM + Eng-1 | Root-cause list completed | `docs/wiki/day29-root-cause.md` | Blocked (Need pilot findings) |
| 30 | Decision | Final POC review (continue/iterate/pivot) with KPI outcomes | PM + Team | Decision memo finalized | `docs/wiki/30-day-retro.md` | Blocked (Need KPI outcomes) |

## Owner Legend

- PM: Product owner / operations lead
- Eng-1: Fullstack/backend engineer
- Eng-2: Flutter/client engineer
