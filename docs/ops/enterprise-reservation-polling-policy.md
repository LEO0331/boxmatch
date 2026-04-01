# Enterprise Reservation Polling Policy (Day 10)

## Scope

- Enterprise reservation list polling in Flutter:
  - `watchReservationsForListing` at `lib/features/surplus/data/firestore_surplus_repository.dart`

## Goal

- Keep enterprise UI near real-time when reservations change.
- Reduce unnecessary API calls when reservation state is stable.
- Avoid aggressive retry storms during transient network/API failures.

## Backoff Strategy

- Fast interval baseline: `8s`.
- If result changed from previous poll:
  - Emit new list immediately.
  - Reset unchanged counter.
  - Next poll after `8s`.
- If result unchanged:
  - Exponential backoff from `8s` up to max `60s`.
  - Sequence example: `8s -> 16s -> 32s -> 60s -> 60s...`
- If transient polling error (`SurplusException` except permission):
  - Error backoff from `8s` up to max `45s`.
  - Sequence example: `8s -> 16s -> 32s -> 45s -> 45s...`
- If permission error (`PermissionDeniedException`):
  - Stop stream and surface error to UI.

## Notes

- This policy is client-side only and Spark-friendly (no scheduler required).
- Reserve endpoint idempotency (Day 8) remains server-side protection for duplicate writes.
