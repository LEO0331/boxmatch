# Pilot Day SOP (Day 22)

## Before Event (T-1 day)

1. Verify Render API `/health` is green.
2. Verify Firebase project quota and Firestore read/write trend.
3. Confirm venue seed list for event day is correct.
4. Prepare enterprise QR/link cards for posting flow.
5. Assign roles:
   - Ops lead
   - On-site enterprise support
   - Incident responder

## Event Start (T+0)

1. Announce posting guideline to exhibitors:
   - clear pickup point
   - accurate quantity
   - expiry time required
2. Validate first 3 listings manually as calibration.
3. Track first reservations for handoff friction.

## During Event

1. Every 60 minutes:
   - check health monitor
   - sample 5 active listings for data quality
2. Every incident must be logged in incident template.
3. If token leak suspected:
   - rotate token immediately
   - if unresolved, revoke token and reissue listing

## End of Event

1. Export 7-day KPI CSV and attach to event folder.
2. Run incident review (15 minutes max).
3. Capture top 3 blockers and owner for follow-up.

## Exit Criteria

- No critical unresolved incident
- KPI export completed
- Pilot notes recorded within 24 hours
