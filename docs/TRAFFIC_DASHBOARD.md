# Traffic intelligence dashboard

The optional dashboard displays the persisted daily aggregates described in
[traffic analytics](TRAFFIC_ANALYTICS.md). It is an operator tool, not a public
analytics endpoint or a real-time request monitor. Backend and frontend feature
flags default to disabled, and collection can stay disabled while an administrator
reviews previously stored data.

## Access and Firebase setup

The browser uses Firebase email/password sign-in through a separate named Firebase
app and an in-memory Auth instance. It does not replace the default application's
anonymous recipient account or its reservation access. No administrator password,
privileged token or Admin credential belongs in a Flutter define or repository.
The administrative API client requires HTTPS, except for explicit loopback HTTP
development URLs, and refuses redirects carrying authenticated requests.
Dashboard snapshots are kept only in memory and cleared on sign-out or loss of
authorization; stale asynchronous responses cannot restore a signed-out view.

An operator must configure Firebase separately:

1. Enable the Email/Password provider in the existing Firebase project.
2. Create or select an individual account with a linked sign-in provider. Do not
   use an anonymous recipient account as an administrator.
3. Review the project's Auth authorized domains, including the actual GitHub Pages
   hostname and any explicitly approved local development hostname.
4. Grant only the narrowly scoped `trafficAdmin` claim with the operator tool.

The backend verifies each ID token using the existing project's Firebase Admin SDK,
including signature, expiry, project audience/issuer and revoked-token/disabled-user
checks. The `trafficAdmin` claim must be the boolean `true`; anonymous identities
are rejected even if incorrectly given that claim. Frontend guards improve the
experience but do not authorize API access. No privilege is inferred from a request
body, email address or public UID, and the claim grants no business administration
permissions.

### Provisioning and removal

From the repository root, using the existing private Firebase Admin environment
credentials or an explicitly configured Application Default Credential:

```sh
node scripts/manage_traffic_admin.js grant --uid ADMIN_UID
node scripts/manage_traffic_admin.js revoke --uid ADMIN_UID
```

These are examples, not instructions that have been run against a real account.
The tool requires an existing account and linked non-anonymous provider, preserves
unrelated custom claims, and never creates users. Unlinked/custom-token-only
accounts are conservatively rejected because UserRecord alone cannot establish a
non-anonymous linked identity. Disabled accounts cannot receive access but may have
the privilege removed. Run claim-management tools serially: Firebase custom claims
are replaced as a whole, so concurrent operator changes are not an atomic merge.

Granting a claim does not change an already issued token. Sign out and sign in
again, or force a token refresh, before expecting access. Revocation removes the
claim and revokes refresh tokens so protected requests reject older sessions as
well. If the CLI reports failure during revocation, rerun it until both steps
succeed; do not assume existing sessions were invalidated. A disabled user is also
rejected by the backend's revocation check. Other sign-in sessions for that account
are affected by refresh-token revocation, which is why administrators should use
dedicated accounts rather than recipient identities.
An already open page has no server-pushed revocation channel: the browser discovers
authorization loss through token/session updates or its next protected request and
then clears the view. Backend authorization is checked on every request regardless
of what the page currently displays.

## Enabling the interface

Render configuration includes `ENABLE_TRAFFIC_ADMIN=false`. After reviewing a
non-production setup, an operator may enable it without enabling current traffic
collection. Existing CORS allowed origins still apply.

The GitHub Pages build supports `BOXMATCH_ENABLE_TRAFFIC_ADMIN=false`. Its repository
variable enables the compile-time UI only for the explicit string `true`. The
existing `BOXMATCH_API_BASE_URL` selects the backend; there is no separate analytics
service URL or public API secret.

With the UI enabled, use:

```text
https://YOUR_GITHUB_PAGES_HOST/boxmatch/#/admin/login
https://YOUR_GITHUB_PAGES_HOST/boxmatch/#/admin/traffic
```

These routes are outside the public navigation shell and excluded from frontend
visit telemetry. Hash routing preserves refresh/direct navigation under the
`/boxmatch/` base path. Administrator pages apply noindex metadata and retain the
existing no-referrer policy. Neither noindex nor an undisclosed URL is access
control. Authenticated API responses use private/no-store caching headers and are
not intended for service-worker or persistent browser storage.

## API and resource limits

Protected GET endpoints:

```text
/admin/traffic/overview?days=7
/admin/traffic/overview?days=30
/admin/traffic/overview?days=90
/admin/traffic/export?days=7
```

The UI offers the three standard periods. The API accepts integer `days` from 1
to the configured maximum (90 by default), with a 7-day default. Equivalent values
such as `7` and `07` share the same normalized UTC range/cache key. Unknown query
parameters and custom start/end selectors are rejected rather than interpreted as
Firestore queries.

Every request authenticates before cache access, including CSV downloads. Missing
or invalid credentials return 401; an authenticated account without the privilege
returns 403. Disabled functionality, exhausted budgets, backend failures and
timeouts return explicit unavailable/throttled responses rather than fabricated
healthy data. Error bodies and administrative logs omit tokens, account identities,
raw query strings and SDK exception details.

The overview is a versioned, allowlisted projection of `traffic_daily`. It includes
the UTC period, available/missing/invalid/unsupported day coverage, last persisted
timestamp, summary metrics, daily trends, API and website dimensions, geographic
coverage and data-quality flags. Only configured feature booleans are exposed—no
secret, trusted-proxy CIDR or local database path is returned. `traffic_flushes`
and raw request logs are never queried. Both analytics collections remain denied
to all direct Firestore clients, including administrators.

Defaults are intentionally conservative:

| Setting | Default | Bound |
|---|---:|---|
| `ENABLE_TRAFFIC_ADMIN` | `false` | Exact `true` enables |
| `TRAFFIC_ADMIN_CACHE_TTL_MS` | 60000 | 1000–300000 ms |
| `TRAFFIC_ADMIN_CACHE_MAX_ENTRIES` | 32 | 1–32 |
| `TRAFFIC_ADMIN_MAX_QUERY_DAYS` | 90 | 1–90 |
| `TRAFFIC_ADMIN_RATE_LIMIT_PER_MINUTE` | 10 per administrator | 1–30 |
| `TRAFFIC_ADMIN_GLOBAL_RATE_LIMIT_PER_MINUTE` | 60 per process | 1–120 |
| `TRAFFIC_ADMIN_READ_BUDGET_PER_DAY` | 3000 per process | 1–10000 |
| `TRAFFIC_ADMIN_AUTH_CONCURRENCY` | 4 | 1–4 |
| `TRAFFIC_ADMIN_AUTH_TIMEOUT_MS` | 5000 | 100–10000 ms |
| `TRAFFIC_ADMIN_QUERY_CONCURRENCY` | 2 | 1–2 |
| `TRAFFIC_ADMIN_QUERY_TIMEOUT_MS` | 5000 | 100–10000 ms |

The UI offers 7-, 30- and 90-day periods, manual refresh with a 30-second cooldown,
and no high-frequency polling. Equivalent queries share a short-lived in-memory
snapshot and concurrent work. Exports reuse that snapshot rather than reading the
same daily documents again. Authentication and database work have separate bounded
concurrency and timeouts; resource limits are enforced before database work starts.
The query service permits two active database queries and uses sequential batches
of at most 15 daily documents with the real SDK (90 days needs six batch RPCs).
Timed-out work retains its slot until the outstanding
read settles, preventing an unbounded queue of abandoned reads. No further document
reads or cache publication occur after that query times out. Cache storage is bounded
by both entry count and a 16 MiB aggregate size allowance, with 4 MiB per entry.

A cache miss for a 7-/30-/90-day overview reserves up to 7/30/90 document reads,
including missing documents. A cache hit requires no analytics document reads but
still verifies authorization. The default 3,000-read budget therefore admits at
most 428 seven-day, 100 thirty-day, or 33 ninety-day cache misses per process/day
when those are the only queries. Exports share this budget. Failures and retries
must be included in quota monitoring; cached results do not establish guaranteed
delivery or freshness. Firebase Auth verification has its own network checks and is
not included in these Firestore document counts.

The read budget is process-local, resets by UTC day and resets on restart. Multiple
Render instances multiply it; it is not a guaranteed project-wide cap. Dashboard,
collection, export/cleanup and business operations all share the Firebase project's
quotas. The dashboard performs no per-request Firestore writes or subscriptions.

## Reading the dashboard correctly

Website page views and API requests are separate populations. A page view followed
by three API calls is one page view and three API requests, not four visitors.
The dashboard displays existing counters and dimensions only:

- Website: page views, acquisition channels, campaign sources/mediums, page
  categories, browser families and operating-system families.
- API: total/success/client-error/server-error/aborted counts, rate-limited subset,
  traffic classifications, heuristic risk levels, bot verification and source
  channels.
- Network, separately for each stream: countries, ASN identifiers, identity
  confidence and geographic resolution status, retaining unknown/other categories.

API success includes eligible 2xx and 3xx responses. Client/server error rates use
the API denominator; aborted requests remain separate. Rate-limited requests are
already part of client errors and are not added again. Website geographic coverage
uses page views, while API geographic coverage uses API requests. Zero or unavailable
denominators display unavailable rates rather than infinite percentages.
Rates use percentages from 0 to 100, rounded to two decimal places. When no valid
daily documents are available, summary observations remain unavailable, not zero.

Missing or rejected daily documents leave visible gaps. A missing day does not mean
zero traffic. The current UTC day is partial, and persisted data can lag collection
or be stale. Feature-disabled, no-data, partial, stale, lookup-unavailable and backend
failure states are distinct. Malformed counters or unsupported schema versions are
flagged rather than silently converted into valid observations.

Country locations are approximate network locations. ASN labels such as `AS3462`
do not identify an individual or establish malicious intent. Phase 2 does not store
organization names as a daily dimension, so the dashboard does not invent provider
names. Where GeoLite data is provisioned, preserve MaxMind attribution and its
applicable data license; see [dataset provisioning](TRAFFIC_ANALYTICS.md#optional-database-provisioning).

Browser-like requests are not proven humans. A referral from an AI platform is not
the same as an AI crawler. Verified requests are shown as counts, not an undefined
verification “success rate”; verification may finish after a request. Risk levels
are heuristics, not confirmed incidents. The daily schema stores independent
dimensions, so arbitrary combinations such as AI crawlers filtered by country are
not supported. There are no unique visitors, sessions, bounce/conversion rates,
individual attack timelines or per-route error histories.

## CSV and investigation

CSV export requires the same administrator authorization and date range. Downloads
contain only sanitized aggregates, use safe filenames, and retain formula-injection
protection. Missing, invalid or unsupported days are marked explicitly with empty
observation values rather than zero-valued observations. No temporary public file
or public download URL is created. The existing operator-side
`npm run export:traffic:7d` and `npm run export:traffic:30d` remain available; their
CLI missing-day behavior is documented separately from the dashboard download.

For an individual suspicious event, an authorized operator can separately inspect
Render application logs, filtering `http.request.completed` by request ID, status
or normalized security signal. The dashboard does not stream those logs. Minimal
`admin.traffic.access`, `admin.traffic.export` and
`admin.traffic.authorization_denied` events support operational review without
logging unnecessary administrator identity information. Unauthorized/malformed
administrator probes remain observable; successful administrative analytics
operations are excluded from ordinary business API totals and administrator pages
are excluded from public website telemetry.

## Rollout and troubleshooting

Before enabling anything in production:

1. Review the diff and run backend, Flutter, coverage and browser checks. The flags
   remain off in source, and no real administrator has been provisioned by this task.
2. Confirm the Firebase project/provider/authorized domains, dedicated account and
   exact claim. Deploy server-only analytics rules without changing public listing
   or reservation permissions. Verify actual client denial using an emulator or
   an approved environment; source-only rules tests are not emulator evidence.
3. In a controlled environment, test missing/expired/revoked tokens, ordinary and
   anonymous users, disabled accounts, sign-out, claim removal, and a late response
   arriving after logout. Confirm the default recipient identity remains intact.
4. Test empty/partial/stale/malformed daily data, zero denominators, CSV downloads,
   cache hits/misses, budget exhaustion, timeouts, and desktop/tablet/mobile layouts.
5. Inspect private/no-store headers, browser storage and service-worker behavior.
   Review actual shared Firestore usage and memory before enabling the Render and
   Pages flags deliberately.

For 401, sign in again and check token expiry/revocation. For 403, verify a linked
non-anonymous account and the boolean claim, then refresh its token. For 429 or
unavailable data, wait for the cooldown/cache/budget window and inspect operational
logs; repeated refreshes cannot recover missing persisted data. Clearing a UI error
does not prove collection is enabled or the backend is healthy.

The dashboard does not repair historical gaps or change retention. Phase 2's
bounded operator cleanup remains responsible for aggregate/marker retention.
Static-only GitHub Pages crawling and direct Firestore reads remain outside complete
coverage. In-memory collection can lose data on restart/crash; referrers may be
absent or spoofed. Production proxy configuration under BM-SEC-04 still requires
independent verification. No live Firebase, Render or repository setting change,
merge, deployment or production-readiness certification is implied here.
