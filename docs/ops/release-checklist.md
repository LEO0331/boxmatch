# Release Checklist (Day 26)

Use this checklist before production deployment.

## Checklist

- [ ] `flutter analyze` passed
- [ ] `flutter test` passed
- [ ] `server` lint passed (`npm run lint`)
- [ ] Smoke test passed (`scripts/smoke_test.sh`)
- [ ] `/health` monitor green (UptimeRobot)
- [ ] Rollback steps reviewed in `docs/ops/deploy-runbook.md`
- [ ] Stakeholder approval recorded (PM/owner)

## Deployment Path

- Preferred release gate: GitHub Actions `Release Checklist Gate`
- Trigger manually with all boolean inputs = `true`
