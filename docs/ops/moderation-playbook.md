# Moderation Playbook (Day 24)

## Goal

Respond to abuse or risky behavior quickly while keeping platform neutral and lightweight.

## Moderation Objects

- Listing (`listingId`)
- Enterprise edit token
- Recipient UID (`claimerUid`)

## Trigger Conditions

- Repeated pickup code mismatch
- Suspicious token use / token leak
- Repeated no-show / spam reservations
- Fraudulent or misleading listing content

## Standard Actions

1. Suspend listing
   - Set listing status to `expired` or `completed` as operational stop-gap.
2. Revoke enterprise token
   - Use `POST /enterprise/listings/:listingId/revoke-token`.
3. Rotate enterprise token
   - Use `POST /enterprise/listings/:listingId/rotate-token`.
4. Block abusive recipient UID (temporary)
   - Add UID to denylist collection (future hard enforcement in API).
5. Log abuse signal
   - Write reason-coded record in `abuse_signals`.

## Response SLA (POC)

- SEV1: start within 15 minutes
- SEV2: start within 2 hours
- SEV3: same business day

## Decision Matrix

- First minor offense: warning + monitor
- Repeated offense: temporary block (24-72h)
- Severe abuse/fraud: immediate revoke + indefinite block pending review

## Audit Trail

Every moderation action should include:

- Actor
- Timestamp
- Reason code
- Target object ID
- Result

Store references in incident report and operational notes.
