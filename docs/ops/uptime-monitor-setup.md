# Uptime Monitor Setup (Day 11)

## Goal

- Keep a free-tier uptime signal for Render API.
- Alert quickly when `/health` becomes unavailable.

## Health URL

- Primary health endpoint: `https://<your-render-service>.onrender.com/health`
- Returns JSON with `ok: true` when service is healthy.

## UptimeRobot (Free) Setup

1. Create account at <https://uptimerobot.com/>.
2. Add monitor:
   - Monitor Type: `HTTP(s)`
   - Friendly Name: `boxmatch-api-health`
   - URL: `https://<your-render-service>.onrender.com/health`
   - Monitoring Interval: `5 minutes` (free plan)
3. Alert contacts:
   - Email (required)
   - Optional: Slack / Telegram webhook if available in your plan
4. Alert rule:
   - Trigger when monitor is down for 2 consecutive checks.

## Runbook Hook

- If monitor is down:
  1. Open Render service logs.
  2. Check latest deployment status.
  3. Re-run health probe workflow manually.
  4. Follow rollback steps in `docs/ops/deploy-runbook.md`.
