# Structured Logging and Reason Taxonomy (v1)

## Log Format

All server logs are JSON lines with a common envelope:

- `ts`: ISO-8601 timestamp
- `level`: `info` | `warn` | `error`
- `event`: event name (for example `http.request.completed`)
- `service`: `boxmatch-server`
- `requestId`: request correlation ID (UUID)

Additional common request fields:

- `method`
- `path`
- `status`
- `latencyMs`
- `reasonCode`

## Event Types

- `http.request.completed`
- `abuse.signal.created`
- `recipient.reserve.failed`
- `enterprise.listing.create.failed`
- `enterprise.token.validate.failed`
- `enterprise.reservation.list.failed`
- `enterprise.listing.update.failed`
- `enterprise.token.rotate.failed`
- `enterprise.token.revoke.failed`
- `enterprise.pickup.confirm.failed`

## Reason Taxonomy

### Success Codes

- `RESERVE_SUCCESS`
- `CREATE_LISTING_SUCCESS`
- `VALIDATE_TOKEN_SUCCESS`
- `LIST_RESERVATIONS_SUCCESS`
- `UPDATE_LISTING_SUCCESS`
- `ROTATE_TOKEN_SUCCESS`
- `REVOKE_TOKEN_SUCCESS`
- `CONFIRM_PICKUP_SUCCESS`

### Validation Codes

- `VALIDATION_CLAIMER_UID_REQUIRED`
- `VALIDATION_QTY_INVALID`
- `VALIDATION_DISCLAIMER_REQUIRED`
- `VALIDATION_CREATE_LISTING_FAILED`
- `VALIDATION_UPDATE_LISTING_FAILED`
- `VALIDATION_UPDATE_LISTING_EMPTY`
- `VALIDATION_CONFIRM_PICKUP_REQUIRED_FIELDS`

### Forbidden/Access Codes

- `VALIDATE_TOKEN_FAILED`
- `LIST_RESERVATIONS_FORBIDDEN`
- `UPDATE_LISTING_FORBIDDEN`
- `ROTATE_TOKEN_FORBIDDEN`
- `REVOKE_TOKEN_FORBIDDEN`
- `CONFIRM_PICKUP_FORBIDDEN`

### Business Rule Failure Codes

- `RESERVE_FAILED_BUSINESS_RULE`
- `CONFIRM_PICKUP_FAILED_BUSINESS_RULE`

### Internal Error Codes

- `RESERVE_FAILED_INTERNAL`
- `CREATE_LISTING_FAILED_INTERNAL`
- `VALIDATE_TOKEN_FAILED_INTERNAL`
- `LIST_RESERVATIONS_FAILED_INTERNAL`
- `UPDATE_LISTING_FAILED_INTERNAL`
- `ROTATE_TOKEN_FAILED_INTERNAL`
- `REVOKE_TOKEN_FAILED_INTERNAL`
- `CONFIRM_PICKUP_FAILED_INTERNAL`

### Abuse Codes

- `ABUSE_ENTERPRISE_TOKEN_MISMATCH`

## Example Log

```json
{
  "ts": "2026-04-01T08:30:00.123Z",
  "level": "warn",
  "event": "http.request.completed",
  "service": "boxmatch-server",
  "requestId": "4d07e5b4-f9b8-4265-a4ce-0f95a0ae1ea4",
  "method": "POST",
  "path": "/enterprise/listings/abc/update",
  "status": 403,
  "latencyMs": 92,
  "reasonCode": "UPDATE_LISTING_FORBIDDEN"
}
```
