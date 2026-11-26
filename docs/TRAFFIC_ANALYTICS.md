# Traffic analytics — Phase 2

Phase 2 adds optional website page views, approximate network geography, and daily
operational statistics to [request intelligence](REQUEST_INTELLIGENCE.md). All new
features default to disabled. Analytics do not block business requests, change
authorization, identify individual visitors, or provide a public dashboard.

## Data flow and meanings

The web app can send one initial `page_view` after rendering to
`POST /telemetry/visit`. Its payload uses finite page and campaign categories;
dynamic listing/reservation IDs, edit tokens, raw routes, URL fragments, click IDs,
and search terms are never transmitted. Widget rebuilds do not generate more views.
Sending has a short timeout and no retry, requires no Firebase authentication, and
does not run in demo mode. Global Privacy Control and Do Not Track opt out when
exposed by the browser. Mobile builds use a no-op platform implementation.

The public endpoint applies independent per-network and global in-memory budgets
before parsing, then validates the full versioned schema under a small body limit. It
returns 204 for accepted events and does not write an event document. Origin and
CORS checks are not authentication: fabricated page views remain possible.

Existing `http.request.completed` logs describe the HTTP request. Accepted frontend
events also emit `traffic.visit.accepted`, which describes a website observation,
not a second completion log. API and website totals have separate denominators:
one accepted page view plus three eligible API calls means one page view and three
API requests. Health checks, CORS preflights, and telemetry transport are excluded
from business API totals. No unique-visitor or session metric is implemented.

## Acquisition attribution

The request's existing `source` describes API transport. Website acquisition uses
the client-supplied, sanitized referrer hostname and restricted campaign fields;
it does not overwrite the API source. Both remain unverified metadata.

Acquisition channels are `organic_search`, `social_referral`, `github_referral`,
`ai_referral`, `campaign_referral`, `external_referral`, `internal_navigation`, and
`direct_or_unknown`. Recognized sources include Google, Bing, DuckDuckGo, Meta,
LinkedIn, Reddit, GitHub, ChatGPT, Perplexity, and Claude. An AI referral says nothing
about whether the client is an AI crawler. A browser-looking client is not a proven
human.

Only `utm_source` and `utm_medium` are considered; allowlisted values become bounded
categories, unknown values become `other` or are discarded. Arbitrary campaign
strings, `utm_content`, advertising identifiers, and full source URLs are not
collected. `web/index.html` uses `strict-origin` (origin only; no path or query), preserving map tile access. The client extracts only a host
from `document.referrer` when the browser exposes one; suppressed information stays
`direct_or_unknown`. Referrers can be absent or spoofed.

## Country and ASN resolution

Geographic enrichment is optional and local. The resolver uses only Phase 1's
reliable public network identity, never an independently supplied forwarding header
or a self-reported country. Unresolved Render proxy topology yields unavailable
geography rather than the proxy's apparent location.

Only country, ASN and a bounded network organization label are exposed. No city,
coordinates, postal code, precise address, raw IP, or persistent visitor identifier
is logged or persisted. Network category remains `unknown` unless a separately reviewed,
reliable mapping exists. An ASN, organization, or cloud network does not establish
malicious intent. Geography is approximate network location, not a person's
physical location.

Lookup databases initialize outside the request path. A missing or invalid file,
unsupported address, failed lookup, or cache limit safely produces unavailable or
unknown data. Normal responses do not wait for geolocation HTTP services; visitor
IP addresses are never sent to a new geolocation API. Cache keys use server HMAC
fingerprints, are capacity-bounded, and expire. Raw addresses remain transient.

Database licensing, paths, and provisioning are described below. Do not commit
database binaries, account credentials, or download license keys.

### Optional database provisioning

The local adapter uses the MIT-licensed [`maxmind` Node reader](https://github.com/runk/node-maxmind)
and GeoLite2 Country/ASN `.mmdb` files, which support IPv4 and IPv6. The reader's
license does not license the data. MaxMind currently offers GeoLite data without a
mandatory paid subscription, but downloading requires an account and download
license key. Review the [GeoLite EULA](https://www.maxmind.com/en/geolite/eula)
and its incorporated terms before provisioning or redistributing data or reports.
Attribution is required, notices must remain intact, and redistribution has separate
conditions. This implementation does not obtain an account, accept terms for an
operator, download a database, or redistribute licensed data.

1. Obtain Country and ASN databases through the operator's MaxMind account. Keep
   download credentials in a private operator/build configuration, never Git,
   logs, Flutter defines, or public GitHub Pages artifacts.
2. Preserve the supplied license/copyright notices and required attribution in
   data-backed operational outputs, including a MaxMind attribution link.
3. Provision the files into private local storage accessible to the Render process;
   set `GEO_COUNTRY_DB_PATH` and `GEO_ASN_DB_PATH` to those local paths. A free Render
   filesystem is ephemeral: reprovision during a controlled deployment rather than
   assuming files survive a restart or redeploy. Absent files leave enrichment unavailable.
4. Use MaxMind's documented [GeoIP Update or authenticated download process](https://dev.maxmind.com/geoip/updating-databases/)
   outside incoming requests, replace files atomically, and restart the API to load
   them. No automatic file watcher or runtime downloader is installed.
5. Keep data current. MaxMind requires deletion of old GeoLite databases within
   30 days of a new release and limits downloads to 30/day; follow the provider's
   update schedule. [Official GeoLite integration and updates](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data/)

The resolver caps each file at 32 MiB. Current documented Country/ASN size ranges
suggest roughly 22 MB of raw database buffers together, plus reader/cache overhead;
that is an estimate, not a measured Render memory result. Check peak process memory
with the actual releases before enabling. The cache defaults to 2,000 entries and
requires a valid HMAC fingerprint. Geography reports `disabled`, `unavailable`,
`not_found`, or `resolved`; partial valid country/ASN data may be resolved while
missing fields remain unknown. No organization-name-to-network-category inference
is performed.

No licensed database was downloaded or used for verification of this change;
resolver tests use mocked local readers. Provisioning and geographic accuracy
still require an operator's independent validation.

## Aggregate storage and delivery

In-memory UTC daily buckets separate `api` from `website`. API data includes total,
success/client-error/server-error/aborted counts, rate limits, classifications, risk
levels, verification status, transport channels and coarse network distributions.
Website data includes page views, page/acquisition/campaign categories, coarse browser
and OS families, and network distributions. Each stream keeps country, ASN,
identity-confidence and geographic-status dimensions separately.

Finite enums and bounded country/ASN maps prevent composite-dimension explosion.
Missing values remain `unknown`; excess distinct values become `other`. Network
organization names are not aggregate dimensions. No raw IP, HMAC fingerprint,
Firebase UID, event ID belonging to a visitor, or individual event body is persisted.

Server-only collections:

| Collection | Contents |
|---|---|
| `traffic_daily/{YYYY-MM-DD}` | Schema version, UTC day key, API/website counters and bounded dimensions, server update time |
| `traffic_flushes/{batchId}` | Server-generated flush deduplication marker; no visitor identity |

For example, selected fields after one accepted page view and three successful API
calls would be:

```json
{"schemaVersion":1,"dayKey":"2026-11-25","api":{"totalRequests":3,"success":3,"clientErrors":0,"serverErrors":0,"aborted":0},"website":{"pageViews":1,"channels":{"organic_search":1,"unknown":0}}}
```

This is an illustrative subset, not measured traffic. Stored documents include
the remaining counters and dimension maps described above, plus `updatedAt`.

Periodic flushes detach counter deltas and transactionally combine them with the
daily document and a stable flush marker. Retrying the same batch cannot increment
it twice, including after an ambiguous commit. Concurrent instances merge through
transactions instead of overwriting totals. Flushes do not overlap; pending work,
attempts, backoff, and write consumption are bounded. Pending deltas retain their
original UTC day through retries and midnight rollover. There are at most three
explicit attempts per snapshot, with 250/500 ms backoff; SDK transaction retries
are disabled so attempts remain countable. The default pending window is three
UTC days. An exhausted ambiguous batch is dropped with its existing ID rather than
being restored under a new ID that could double-count a successful commit.

These are best-effort statistics. Capacity eviction, process restarts, crashes,
exhausted budgets, prolonged Firestore outages, or an expired pending day can lose
data. A bounded shutdown flush is attempted but Render termination can interrupt it.
Normal flushes report a configurable deadline; an already submitted transaction retains its slot until settlement, with no overlapping retry. An indefinitely hung SDK operation can still require a service restart. No guaranteed delivery, audit-grade accounting, or cross-instance unique identity is
claimed. Business operations continue when analytics fails.

## Free-tier cost and resource budgets

Default flushing is once per five minutes with no reads or writes for empty work.
For one changed day per interval and one instance, 288 successful daily flushes
would consume approximately 576 document reads and 576 document writes: one daily
document and one marker each. Retries, multiple pending days, exports and cleanup
add consumption. Every explicit attempt reserves two writes against the default
600-write daily budget, including a marker replay that performs no write. At most
300 attempts can therefore start per process/day; each reads at most two documents
and writes at most two. Deduplication markers also use storage and later deletions.

The configured write budget is per process, not a project-wide reservation. Multiple
Render instances multiply limits, and business operations share the same Firestore
project. A restart also resets a process-local budget. Abusive telemetry increases
in-memory counts only within ingestion caps; it does not cause proportional writes.

As checked on 2026-11-25, Firebase's free allocation is one database per project,
1 GiB stored, 50,000 document reads/day, 20,000 writes/day, 20,000 deletes/day, and
10 GiB outbound/month. Quotas reset around midnight Pacific time, independently
from these UTC analytic buckets. TTL deletes require billing and have no free
usage, so Phase 2 uses operator cleanup rather than managed TTL. Confirm the live
project's usage before enabling features. [Official Firestore quotas](https://firebase.google.com/docs/firestore/quotas)

## Configuration and rollout

Render receives three new flags in `render.yaml`, all `false`:

- `ENABLE_FRONTEND_TELEMETRY`: accept public frontend page-view submissions.
- `ENABLE_GEO_ENRICHMENT`: initialize optional local country/ASN lookup.
- `ENABLE_TRAFFIC_AGGREGATION`: aggregate and periodically persist traffic.

Phase 1's `REQUEST_IP_HMAC_SECRET` and verified `TRUST_PROXY_CIDRS` remain the source
of network confidence and pseudonymous cache keys. Generate a random secret as
described in [Phase 1 configuration](REQUEST_INTELLIGENCE.md#configuration-and-render-rollout).
Missing optional configuration degrades safely instead of preventing startup.

| Backend variable | Default | Accepted bound |
|---|---:|---|
| `TRAFFIC_FLUSH_INTERVAL_MS` | 300000 | 60000–3600000 |
| `TRAFFIC_FLUSH_TIMEOUT_MS` | 30000 | 1000–60000 |
| `TRAFFIC_RETENTION_DAYS` | 90 | 7–365 |
| `TRAFFIC_MAX_PENDING_DAYS` | 3 | 1–7 |
| `TRAFFIC_MAX_ASN_BUCKETS` | 100 | 1–100 |
| `TRAFFIC_MAX_COUNTRY_BUCKETS` | 100 | 1–250 |
| `TRAFFIC_WRITE_BUDGET_PER_DAY` | 600 | 2–1000 reserved writes per instance/day |
| `TELEMETRY_MAX_BODY_BYTES` | 2048 | 256–2048 |
| `TELEMETRY_RATE_LIMIT_PER_MINUTE` | 20 | 1–100 per network |
| `TELEMETRY_GLOBAL_RATE_LIMIT_PER_MINUTE` | 300 | 1–1000 per instance |
| `GEO_COUNTRY_DB_PATH`, `GEO_ASN_DB_PATH` | unset | Local files only; no URL |
| `GEO_CACHE_MAX_ENTRIES` | 2000 | 1–10000 |
| `GEO_CACHE_TTL_MS` | 3600000 | 1000–86400000 |

Numeric values outside the bounds use conservative defaults. Boolean flags require
the exact string `true`. Acceptance, enrichment and persistence are independent:
turning on frontend acceptance does not enable storage. Aggregation needs request
context for classification but must not implicitly enable external bot verification.
Enable `ENABLE_REQUEST_INTELLIGENCE` for Phase 1 classification/risk and geographic
fields in API completion logs. Without it, API totals still aggregate with unknown
dimensions; accepted frontend visits can independently use coarse classification
and optional geography. Telemetry transport never contributes to API totals or
Phase 1 behavioral counters and never starts crawler verification.

The frontend compile flag is `BOXMATCH_ENABLE_TELEMETRY=false`. The GitHub Pages
workflow reads its repository variable; only explicit `true` enables submission.
It uses the existing `BOXMATCH_API_BASE_URL`, with no separate analytics service
URL or secret embedded in JavaScript. Do not enable the frontend flag before the
backend endpoint has been validated in a non-production environment.

Before production enablement:

1. Inspect Render's actual proxy chain and forwarding behavior (BM-SEC-04). Configure
   only confirmed trusted CIDRs; never unrestricted proxy trust or a guessed topology.
2. Deploy the server-only analytics rules without changing listing/reservation access.
3. Provision any licensed local databases separately, then test missing/corrupt files,
   reliable IPv4/IPv6 identities, and unknown results without exposing raw addresses.
4. Enable backend features individually in staging. Verify one completion log, separate
   accepted-visit semantics, unchanged auth/rate limits, no per-event writes, flush
   budgets, ambiguous-commit recovery, midnight rollover and shutdown behavior.
5. Enable the web compile flag only after checking privacy signals, duplicate prevention,
   offline/cold-start behavior, safe acquisition payloads and the preserved referrer policy.
6. Review memory/latency, logs and project quota usage before a gradual production rollout.

Production topology, deployed rules, licensed datasets, successful delivery and
geographic accuracy are not established by source tests or this document.

## Operations and troubleshooting

Analytics export is operator-side only; there is no public export endpoint. Use
the Admin credentials already documented for KPI scripts. Exports have a bounded
date range and protect spreadsheet text cells against formula injection.

```sh
cd server
npm run export:traffic:7d
npm run export:traffic:30d
# Or from repository root: node scripts/export_traffic_csv.js 7
```

CSV rows have `dayKey,stream,dimension,key,count,status`. Missing, invalid and unsupported days have an explicit coverage row with an empty count; valid zero observations remain zero. Export accepts 1–90 days and
writes `reports/traffic-daily-START-to-END.csv` under the current directory. Missing
days are explicitly marked, not treated as zero traffic. Only allowlisted counters/dimensions are exported.

Daily aggregates default to 90-day retention. Run cleanup in dry-run mode first,
review the bounded result, then explicitly apply. Retain deduplication markers
longer than any retry/pending window; removing a marker while its batch can retry
would permit duplicate increments. Cleanup never runs on incoming requests.

```sh
# From repository root; default is --dry-run, 90 days and a total limit of 100.
node scripts/cleanup_traffic.js --dry-run --days 90 --limit 100
node scripts/cleanup_traffic.js --apply --days 90 --limit 100
```

Cleanup accepts 7–365 retention days and at most 500 documents total per run,
including both aggregate and flush-marker collections. It uses at most two bounded
queries and deletes only days older than the UTC cutoff. Each delete consumes quota;
rerun deliberately if the bounded report shows more old data remains.

When data is missing, check feature flags, frontend compile settings, GPC/DNT,
demo mode, endpoint 204/invalid/throttled responses, CORS origins, HMAC configuration,
network confidence, local database paths, pending/write budgets and Firestore errors.
Do not infer that a missing page view means no visitor arrived.

## Protected dashboard

The optional [traffic intelligence dashboard](TRAFFIC_DASHBOARD.md) reads these
persisted aggregates through a separately authorized backend API. It does not alter
collection or retention, expose direct client Firestore access, or add arbitrary
cross-dimensional analytics. Dashboard operations are kept separate from public
traffic counts; ordinary unauthorized probes remain observable.

## Coverage limits and later phases

Verification on 2026-11-25 used Node 24 and local Flutter 3.47.2/Dart 3.13.2:
clean backend installation, syntax checks, and the full Jest suite passed;
the production dependency audit reported zero vulnerabilities. Flutter dependency
resolution and analysis passed, all 110 Flutter tests passed, coverage was 87.55%
against the unchanged 80% gate, and both default-disabled and opt-in web release
builds compiled. Browser checks passed for all five default-build smoke/telemetry
tests and four opt-in telemetry tests. External service behavior uses test fixtures;
no licensed geographic database or live production analytics deployment was tested.
Rules regressions inspect the rule source and are not an emulator validation.
The final backend rerun on 2026-11-26 passed **419 tests across 25 suites**, syntax
checks, and a production dependency audit with zero vulnerabilities.

Frontend telemetry sees only clients executing the tracking code and successfully
delivering the event. Static-only crawlers and direct Firestore reads remain outside
complete monitoring. Page views are not unique visitors. Bot verification may
finish after a request, so a real verified bot can first appear unverified or
unavailable. Shared networks and spoofable headers limit attribution, and in-memory
data can be lost. No dashboard, precise location, blocking, CAPTCHA, tracking cookie,
hardware fingerprinting, session ID or paid infrastructure is introduced.

Further phases can evaluate additional operator tools after data quality,
retention, quota use and privacy have been validated in production.


## Passive probe extension

[Passive Security Probe Intelligence](SECURITY_PROBE_INTELLIGENCE.md) optionally adds a bounded `probes` section to the existing daily documents and CSV stream. Requires request intelligence and traffic aggregation; `ENABLE_SECURITY_PROBES=false` by default. Old days remain unobserved rather than zero. No per-request write, fingerprint persistence or enforcement is added. See [overall security architecture](SECURITY_ARCHITECTURE.md).
