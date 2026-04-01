# Waste Reduction Formula Validation (Day 21)

## Purpose

Define and validate a simple, transparent formula set for POC reporting.

## Formula Set (v1)

1. `reserve_to_pickup_rate = pickup_confirmed_count / reservation_created_count`
2. `listed_to_reserved_rate = reserved_qty_total / listed_qty_total`
3. `estimated_meals_saved = estimated_meals_picked_up_total`
4. `estimated_kg_diverted = estimated_kg_diverted_total`

## Weight Assumptions (item-level)

- Lunchbox: `0.45 kg`
- Drink: `0.30 kg`
- Snack: `0.20 kg`
- Fallback for unknown type: `0.35 kg`

## Validation Example

Given a day with:

- `listed_qty_total = 100`
- `reserved_qty_total = 72`
- `reservation_created_count = 60`
- `pickup_confirmed_count = 48`
- `estimated_meals_picked_up_total = 55`
- `estimated_kg_diverted_total = 21.3`

Calculated:

- `listed_to_reserved_rate = 72 / 100 = 72%`
- `reserve_to_pickup_rate = 48 / 60 = 80%`
- `estimated_meals_saved = 55`
- `estimated_kg_diverted = 21.3 kg`

## Constraints

- Metrics are directional for POC decision-making, not regulatory-grade waste accounting.
- Keep assumptions explicit in all pilot reports.
