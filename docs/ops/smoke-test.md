# Core Flow Smoke Test (Day 25)

## Purpose

Validate end-to-end API flow before release:

1. health
2. create listing
3. reserve (with idempotency replay)
4. enterprise list reservations
5. confirm pickup
6. revoke token

## Script

- Script path: `scripts/smoke_test.sh`

## Prerequisite

- Deployed API is reachable.
- Set env var:

```bash
export BOXMATCH_API_BASE_URL="https://<your-render-service>.onrender.com"
```

## Run

```bash
/Users/Leo/Documents/boxmatch/scripts/smoke_test.sh
```

## Success Criteria

- Script exits with code `0`
- Final output includes: `Smoke test PASSED`
- Idempotency replay assertion passes (same reservation id on retry)

## Failure Handling

- Capture terminal log output
- Attach `requestId` from API responses/logs
- Open incident entry using `docs/ops/incident-template.md`
