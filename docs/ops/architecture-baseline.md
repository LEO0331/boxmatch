# Architecture Baseline (POC)

## Objective

Provide a low-cost, production-shaped architecture for Boxmatch while staying on free tiers where possible.

## Runtime Topology

- Client: Flutter (mobile + web)
- API: Render free web service (`server/`)
- Data/Auth: Firebase Spark (Firestore + Anonymous Auth)
- CI/CD: GitHub Actions
- Monitoring: Render logs + UptimeRobot free health checks

## Write Authorization Boundary

- All sensitive writes flow through API:
  - enterprise create/update/rotate/revoke/confirm
  - recipient reserve
- Firestore security rules deny client writes for `listings` and `reservations`.

## Core Collections

- `venues`
- `listings`
- `reservations`
- `abuse_signals`

## Cost Principles

- Avoid Firebase Functions (requires Blaze for this flow)
- Keep single Render service in free tier
- Keep analytics as lightweight Firestore aggregates/exports in POC phase
