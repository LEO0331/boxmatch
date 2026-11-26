# Release checklist

Use this checklist before production deployment.

## Checklist

- [ ] `flutter analyze` passed
- [ ] `flutter test` passed
- [ ] Backend lint, Jest tests and dependency audit passed
- [ ] Flutter coverage meets 80% gate
- [ ] Firestore Rules CI passes owner-only queries and client write denial
- [ ] Both applicable browser configurations pass
- [ ] Deployed Firebase rules, Render settings and feature variables verified
- [ ] If enabling traffic dashboard: authorized sign-in, aggregation, export and controlled revocation verified
- [ ] If enabling direct reservation reads: cold/warm read, refresh, cancellation and identity isolation verified
- [ ] Smoke test passed (`scripts/smoke_test.sh`)
- [ ] `/health` monitor green (UptimeRobot)
- [ ] Rollback steps reviewed in `docs/ops/deploy-runbook.md`
- [ ] Stakeholder approval recorded (PM/owner)

## Deployment Path

- Preferred release gate: GitHub Actions `Release Checklist Gate`
- Trigger manually with all boolean inputs = `true`
