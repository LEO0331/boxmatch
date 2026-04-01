# Deploy Runbook

## Preconditions

- Render service is connected and healthy
- Render env vars are configured
- GitHub secret `RENDER_DEPLOY_HOOK_URL` is configured

## Deploy Flow

1. Merge backend changes to `main`.
2. GitHub Action `Deploy Render API` triggers deploy hook.
3. Validate `https://<service>.onrender.com/health` returns `ok: true`.

## Rollback Flow

1. In GitHub, revert offending commit on `main`.
2. Push revert commit.
3. Confirm Render deploys reverted revision.
4. Re-run health and key API smoke tests.

## Manual Smoke Checks

1. `GET /health`.
2. `POST /enterprise/listings/create`.
3. `POST /recipient/listings/:listingId/reserve`.
4. `POST /enterprise/listings/:listingId/confirm-pickup`.

## Incident Notes

- If deploy fails at build stage, inspect Render build logs first.
- If deploy succeeds but traffic fails, inspect server logs and verify Firebase credentials.
