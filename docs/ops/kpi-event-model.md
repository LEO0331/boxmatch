# KPI Event Model (Day 18)

## Objective

Create a minimal KPI model for POC that is Spark-friendly, backend-owned, and tied to core business flow.

## Event Types (Core)

- `listing_created`
- `reservation_created`
- `pickup_confirmed`

## Required Fields

- `eventType`: one of core types above
- `createdAt`: server timestamp (UTC)
- `dayKey`: `YYYY-MM-DD` (UTC)
- `listingId`
- `reservationId` (nullable for listing event)
- `venueId` (nullable)
- `itemType`
- `qty`
- `requestId` (for log correlation)

## Aggregation Strategy

- Daily rollup collection: `kpi_daily/{dayKey}`
- Global rollup collection: `kpi_summary/global`
- Each successful write path increments aggregate counters.

## Aggregate Metrics

- `listing_created_count`
- `listed_qty_total`
- `reservation_created_count`
- `reserved_qty_total`
- `pickup_confirmed_count`
- `pickup_qty_total`
- `estimated_meals_reserved_total`
- `estimated_meals_picked_up_total`
- `estimated_kg_diverted_total`

## Free-Tier Policy

- Default: keep aggregate writes always on.
- Optional raw event logs (`kpi_events`) controlled by env:
  - `ENABLE_KPI_EVENT_LOGS=true`
- For Spark POC, keep raw event logs off unless debugging/auditing is needed.

## Ownership

- Event generation: server API only (no direct client KPI writes).
- Client reads analytics output only.
