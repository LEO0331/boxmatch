# Request intelligence — Phase 1

Phase 1 adds optional, observation-only metadata to the existing Express
`http.request.completed` log. It never blocks requests, changes authorization,
adjusts existing rate limits, or writes per-request telemetry to Firestore.
Both feature switches default to `false`.

**Scope:** only requests reaching the Express API are visible. Static-only
crawling of GitHub Pages and direct Firestore reads are outside this system.

[Phase 2 traffic analytics](TRAFFIC_ANALYTICS.md) optionally adds frontend page-view
ingestion, local country/ASN enrichment and daily aggregate persistence. Its flags
are independent and disabled by default. The telemetry transport is excluded from
business API counts and behavioral request counters; a page view is a separate
semantic observation, not another API request or a unique visitor. Phase 1's logging,
authorization and rate-limit behavior remain the baseline when Phase 2 is disabled.

## Architecture and request lifecycle

The reusable modules under `server/observability/` contain configuration parsing,
network identity resolution, context sanitization, traffic classification,
background bot verification, and behavioral scoring. They do not depend on
listing or reservation business logic.

1. Existing middleware generates the request ID and starts one completion record
   before JSON parsing and CORS, so early failures and preflight responses are seen.
2. When enabled, context extraction keeps only sanitized source hosts, coarse
   client categories, a transient suspicious-path flag, and network information.
3. Bot verification checks the cache and may start bounded background work; the
   request never awaits a provider or DNS response.
4. On response finish, the existing logger adds route template, status, latency,
   and enrichment. A connection closed before completion records status `499`
   and `aborted: true`. Finish/close share a guard and emit at most once.

Unmatched requests use `[pre-route-or-unmatched]`, never their raw paths. When
observation is enabled, parser errors return generic messages rather than exposing JSON contents or stacks.
Telemetry failures fall back to the existing completion fields and do not fail
API operations. With intelligence disabled, enrichment and verification do not run
and ordinary completion fields remain unchanged. With observation enabled, early
parser errors retain their HTTP status and return a generic JSON error instead of
Express's default HTML. Disabled mode retains the previous parser response behavior.

## Client and source classification

User-Agent matching provides **claims and heuristics**, not identity or evidence
that a person is present. Coarse classifications are `likely_human`,
`search_engine_crawler`, `ai_crawler`, `social_media_crawler`,
`automated_api_client`, `suspected_scraper`, `suspected_security_scanner`, and
`unknown`. Browser and OS families are reported when recognizable.

| Signatures | Classification / purpose |
|---|---|
| Googlebot, Bingbot, DuckDuckBot, YandexBot, Baiduspider | Search crawler |
| GPTBot, ClaudeBot | AI training crawler |
| OAI-SearchBot, Claude-SearchBot, PerplexityBot | AI search crawler |
| ChatGPT-User, Claude-User | User-triggered agent |
| facebookexternalhit, Twitterbot, LinkedInBot, Discordbot, Slackbot-LinkExpanding | Social link preview |
| Slackbot | General Slack automation |
| curl, wget, Postman, Python requests, Go HTTP client, recognizable headless automation | Automated API client |
| Scrapy/scraper/spider signatures; common scanner tools or sensitive-path probes | Suspected scraper/scanner |

Automation is not inherently malicious. A browser-looking header is only
`likely_human`; headers can be spoofed, changed, absent, or malformed.

Attribution uses a valid referrer host, falling back to a valid Origin host.
Channels are `search_referral`, `social_referral`, `github_referral`, `same_origin`,
`external_referral`, and `direct_or_unknown`. Provider-domain matches require
exact names or subdomain boundaries. Referrer and Origin are untrusted hints,
not proof of a visitor's arrival source; missing headers do not prove direct traffic.
Only HTTP(S) hostnames are retained; paths, credentials, ports, and queries are not.
IP-literal, malformed, control-character, and oversized source values are discarded.

## Network identity and bot verification

The new resolver respects Express's configured `TRUST_PROXY_CIDRS`; it does not
change the existing business identity resolver or rate-limit keys. Forwarding
headers never independently establish a client identity. A valid, public direct
peer or a valid client selected by a configured trusted proxy can be `trusted`.
Untrusted forwarding, private/proxy peers, malformed chains, and unresolved peers
degrade to `proxy` or `unresolved`. IPv4, IPv6, and IPv4-mapped IPv6 are normalized.

Logs contain an HMAC-SHA256 fingerprint and confidence, never the address.
Missing/invalid HMAC secrets produce `ipFingerprint: null` and disable behavioral
correlation. Bot verification separately requires a reliable public client IP;
it does not need to publish a fingerprint.

| Claimed provider | Verification mechanism and official reference |
|---|---|
| Googlebot | Published common-crawler IPv4/IPv6 ranges; [Google verification guide](https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests) |
| DuckDuckBot | Published range feed; [DuckDuckGo documentation](https://duckduckgo.com/duckduckgo-help-pages/results/duckduckbot) |
| GPTBot, OAI-SearchBot, ChatGPT-User | Separate official range feeds; [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots) |
| ClaudeBot, Claude-SearchBot, Claude-User | Shared published range feed; [Anthropic crawler documentation](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler). Matches establish provider network origin; nonmatches remain unverified because coverage may be partial. |
| PerplexityBot | Published ranges; [Perplexity crawler documentation](https://docs.perplexity.ai/docs/resources/perplexity-crawlers) |
| Bingbot | Reverse DNS under `search.msn.com`, then forward resolution back to the original IP; [Bing verification guide](https://www.bing.com/webmasters/help/how-to-verify-bingbot-3905dc26) |
| YandexBot | Forward-confirmed reverse DNS under `yandex.ru`, `yandex.net`, or `yandex.com`; [Yandex verification guide](https://www.yandex.ru/support/webmaster/en/robot-workings/check-yandex-robots) |
| Baiduspider | Forward-confirmed reverse DNS under `baidu.com` or `baidu.jp`; [Baidu verification guide](https://help.baidu.com/question?class=476&id=2996&prod_id=99) |
| Discordbot | Published egress ranges; [Discord documentation](https://support.discord.com/hc/en-us/articles/42500550752919-About-Discord-Link-Previews-and-the-Discordbot) |

Additional signature references: [Meta crawlers](https://developers.facebook.com/documentation/sharing/webmasters/web-crawlers),
[Slack robots](https://api.slack.com/robots), and the `LinkedInBot` token in
[LinkedIn's own robots file](https://www.linkedin.com/robots.txt). These agents stay
unverified in Phase 1. The requested `Twitterbot` signature is retained as a heuristic;
the former official X Cards crawler documentation now redirects to general API
documentation, so its current identity mechanism was not independently confirmed.

Other recognized agents remain `unverified`. `not_applicable` means no known bot
claim; `verified` means the supported network check passed;
`verification_failed` means a completed, authoritative check contradicted the
claim. Cold cache, unreliable identity, saturation, timeout, or provider/DNS
failure produces `verification_unavailable`. Disabled verification returns
`unverified` for claims. Outages never add mismatch risk.

Only predefined HTTPS provider endpoints are fetched; redirects are rejected.
DNS forward queries are allowed only after exact suffix-boundary validation of
reverse answers. No request-supplied URL is fetched. Provider bodies are capped at
1 MiB and 20,000 prefixes. At most four verifications run concurrently; identical
work and shared feed downloads deduplicate. There is no backlog queue. Results
use a bounded expiring cache; unavailable results have at most a 30-second
cooldown, shared at feed level across fresh IPs during provider outages. The finite
set of provider feeds is also cached and CIDRs are parsed once per feed refresh. DNS
verification submits the client address to the system DNS resolver; HTTPS checks
download only provider range lists, without forwarding visitor headers. Normal API responses
use the result currently available and may precede verification completion.

## Risk scoring

Scores are rule-based indicators, **not probabilities** or enforcement decisions.
Signals add once per evaluation, capped at 100:

| Signal | Points |
|---|---:|
| `MISSING_USER_AGENT` | 10 |
| `SUSPICIOUS_PATH` | 25 |
| `HIGH_REQUEST_FREQUENCY`: more than the configured request threshold | 20 |
| `REPEATED_AUTH_FAILURE`: at least the configured 401/403 threshold | 20 |
| `REPEATED_NOT_FOUND`: at least the configured 404 threshold | 15 |
| `BOT_IDENTITY_MISMATCH`: definitive verification failure | 30 |

Levels: 0–29 `low`, 30–59 `suspicious`, 60–100 `high`. Sensitive-path checks cover
WordPress, environment/Git files, PHP administration tools, traversal, and common
configuration probes; the inspected path is not retained. Counters use completed
requests in a sliding observation window. CORS preflights and ordinary health
checks contribute no risk or counters. Behavioral counters require a trusted
identity and valid HMAC fingerprint; proxy/unresolved traffic receives only
stateless signals. Shared public networks can still produce false positives.

Per-network timestamp rings retain only enough observations to test thresholds.
Inactive entries expire, bounded incremental cleanup avoids full-map scans on each
request, and capacity eviction favors recent identities. An aggregate 16 MiB
timestamp-storage budget can reduce the effective identity capacity when thresholds
are raised. Restarts, eviction,
multiple server instances, and HMAC rotation break correlation.

## Configuration and Render rollout

Set environment values on the Render service. Only the two disabled feature flags
are included in `render.yaml`; no real secret belongs in the repository.
Boolean flags enable only for the exact string `true`. Invalid numeric values
fall back to defaults rather than expanding resource limits.

| Variable | Default | Accepted range |
|---|---:|---|
| `ENABLE_REQUEST_INTELLIGENCE` | `false` | `true` / `false` |
| `ENABLE_BOT_VERIFICATION` | `false` | `true` / `false`; requires intelligence enabled |
| `REQUEST_IP_HMAC_SECRET` | unset | 32–4096 UTF-8 bytes; otherwise fingerprinting disabled |
| `REQUEST_RISK_WINDOW_MS` | 60000 | 1000–300000 |
| `REQUEST_RISK_RATE_THRESHOLD` | 60 | 1–1000 |
| `REQUEST_RISK_AUTH_FAILURE_THRESHOLD` | 5 | 1–1000 |
| `REQUEST_RISK_NOT_FOUND_THRESHOLD` | 10 | 1–1000 |
| `REQUEST_INTELLIGENCE_MAX_ENTRIES` | 10000 | 1–10000; also limited by timestamp-storage budget |
| `BOT_VERIFICATION_TIMEOUT_MS` | 2000 | 100–10000 |
| `BOT_VERIFICATION_CACHE_MAX_ENTRIES` | 1000 | 1–10000 |
| `BOT_VERIFICATION_CACHE_TTL_MS` | 3600000 | 1000–86400000 |

Generate a fresh secret locally, then store its output as a Render secret:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Use the same secret across instances only when correlation is intended. Rotate
by replacing the secret and restarting; old fingerprints cannot be correlated
with new ones through these logs. Treat fingerprints as pseudonymous network
identifiers, restrict log access, and choose a short operational retention period.

Before enabling production observation:

1. Verify Render's actual proxy chain and how it replaces/appends forwarding
   headers. BM-SEC-04 is not resolved by assuming a topology. Configure only
   confirmed proxy CIDRs; never unrestricted trust or an arbitrary forwarding header.
2. Enable intelligence with a secret and leave bot verification off initially.
   Confirm expected confidence behind the real proxy and no raw identifiers in logs.
3. Exercise success, 401/403, 429, 404, malformed JSON, OPTIONS, and an aborted
   connection. Confirm one completion record and unchanged authorization/rate limits.
4. Optionally enable verification; check cold-cache behavior, DNS/HTTPS egress,
   timeout behavior, memory, and latency before retaining it.

This feature has not established production readiness or verified the deployed
Render topology. There is no automatic merge or deployment in this implementation.

## Logs and inspection

Existing fields remain compatible. An enabled completion event includes:

```json
{"event":"http.request.completed","requestId":"example-uuid","method":"GET","path":"/health","status":200,"latencyMs":12,"network":{"ipFingerprint":null,"identityConfidence":"proxy"},"source":{"referrerDomain":null,"originDomain":null,"channel":"direct_or_unknown"},"client":{"type":"browser","browser":"Chrome","os":"Windows","claimedBot":null,"purpose":null},"security":{"classification":"likely_human","verificationStatus":"not_applicable","riskScore":0,"riskLevel":"low","signals":[]}}
```

In Render logs, filter on `http.request.completed`, a request ID,
`"riskLevel":"high"`, or a signal such as `BOT_IDENTITY_MISMATCH`. For downloaded
JSON-line application logs, inspect high-risk observations with:

```sh
jq 'select(.event == "http.request.completed" and .security.riskLevel == "high")' api.jsonl
```

The enrichment allowlist excludes raw IPs, User-Agent strings, request URLs and
query strings, full source URLs, bodies, cookies, tokens, pickup codes, and raw
exception messages/stacks. Existing business audit events remain separate and
unchanged. Request intelligence introduces no request-level database writes,
Redis, geolocation subscription, or paid service.

## Verification

On 2026-11-25, Node 24 clean installation (`npm ci`), backend syntax check
(`npm run lint`), and all **274 Jest tests across 16 suites** passed. The production
dependency audit reported **zero vulnerabilities**. Tests mock provider HTTP/DNS
and Firebase, exercise the API over local HTTP, and include complete business flows
while telemetry initialization, capture, or completion throws. No live Render/Firebase
smoke test or deployed proxy validation was performed. The production smoke script
requires a separately provisioned API target and is not run against public data here.

## Protected operator access

The optional [traffic dashboard](TRAFFIC_DASHBOARD.md) visualizes persisted
Phase 2 aggregates through an independently authorized API. It does not expose raw
request logs or change observation-only risk scoring. Authorized analytics
operations do not inflate public traffic totals; unauthorized administrator probes
retain normal request observation and security controls.

## Trade-offs and later phases

In-memory heuristics favor low cost and predictable resource use over complete
history. Provider feeds and DNS can be stale or unavailable, UA detection misses
disguised automation, and provider-network membership does not cryptographically
prove a specific bot's purpose. Headers and attribution remain spoofable.

Later phases may evaluate aggregate metrics, dashboards, broader provider support,
and independently reviewed enforcement. Frontend tracking, hardware fingerprinting,
geolocation/ASN enrichment, CAPTCHA, and blocking are outside Phase 1.

## Administrative analytics integration

Authorized, normalized dashboard operations are excluded from behavioral counters and ordinary API aggregates; denied and malformed probes remain observable. The web application uses `strict-origin` for map tile compatibility, suppressing referrer paths and queries.
