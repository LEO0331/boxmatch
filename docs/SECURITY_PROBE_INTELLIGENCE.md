# Passive Security Probe Intelligence / 被動式安全探測情資

## Scope

A defensive, observation-only extension to the existing Express lifecycle, request intelligence, daily aggregation and protected administrator dashboard. It classifies requests for common sensitive-path categories and observes actual response status. It does not introduce decoy files, fake credentials, exposed administrative routes, new public endpoints, automatic blocking, retaliation or active scanning. Unmatched requests retain ordinary Express 404 behavior; existing auth/rate limits remain unchanged.

[Overall security architecture / 整體資安架構](SECURITY_ARCHITECTURE.md)

## Observation semantics

- Fixed target categories: environment files, Git metadata, WordPress, backup files, path traversal, administration tools, configuration, credential files and other existing sensitive-path signals. One primary category per matched request. The classifier uses a bounded transient path (maximum 4096 characters, at most two URI decoding passes); excludes query/fragment contents; never returns the raw path. Non-matching requests are not evidence of safety.
- Eligible API completion events are the existing API stream (health checks, actual telemetry transport, preflight and successful authorized admin operations excluded). Phase 1 produces a category or null. A missing classification field means the request was not observed by this module. A genuine zero is only shown when at least one eligible request was observed and no matches were counted.
- HTTP method and response-outcome buckets (2xx, 3xx, 401, 403, 404, 429, other 4xx, 5xx, aborted, unknown); hourly UTC and daily completion-time trends. A 2xx is a review signal, not proof of disclosure (e.g. a fallback page).
- Existing bot, risk, country/ASN, identity-confidence and geography-status dimensions are reused for probe matches. GeoIP is optional and describes a network endpoint, not a person's location.
- Repeated requests: subsequent matched requests from the same trusted HMAC within a fixed 60-second window beginning at the first match. Multi-category requests: matched requests after at least two distinct target categories have appeared in that window. Correlatable requests have a trusted HMAC. These are request counts, not counts of unique people, attackers, networks or sessions.
- Tracker: at most 2,048 entries per process, incremental cleanup and bounded periodic sweep, eviction on overflow, expiry/reset, no persistence of fingerprints. The observation window is fixed, not rolling; restarts, clock changes, separate instances, NAT and shared networks limit correlation. The cleanup sweep discards expired entries at the next interval; shutdown clears state.

## Persistence and API compatibility

Use the existing `traffic_daily` version-1 documents with optional `probes` section, and the same `traffic_flushes` stable marker and write budget. No new collection or per-request database write. Daily dimensions use fixed keys, with existing bounded country/ASN buckets. The protected overview exposes an optional `probes` object with collection state, observed days, invalid days, totals and daily trends; old responses without it remain valid. CSV adds a `probes` stream, including blank count and `not_observed` or `invalid` status where probe coverage is missing/invalid. Existing API and website metrics remain independent. A historical or disabled day is not automatically zero. Days may have only partial coverage.

No raw IP, URL, request body, raw User-Agent, cookies, authorization headers or fingerprints are stored in probe aggregates or exported. The existing Phase 1 log policy still applies (including HMAC fingerprints); HMAC is pseudonymization, not anonymity. Provider/platform logs may have separate retention policies. Existing retention and cleanup apply (90-day default; operator-run cleanup). No public analytics exposure, new credential, or new Firestore client permission. The existing admin API verifies claims and applies read budgets, no-store, and sanitized CSV.

## Activation / 啟用

Source defaults remain false. Configure Render with exact string values:
- `ENABLE_REQUEST_INTELLIGENCE=true`
- `ENABLE_TRAFFIC_AGGREGATION=true`
- `ENABLE_SECURITY_PROBES=true` (new; defaults false)
- `ENABLE_TRAFFIC_ADMIN=true` for authorized viewing; enable matching `BOXMATCH_ENABLE_TRAFFIC_ADMIN=true` Pages build.

The existing secret, trusted proxy topology and optional bot verification/geography configuration are unchanged. Without valid trusted network identity, correlation remains unavailable; the category/status counts still work. No frontend telemetry flag is required for probes. Deploy reviewed server and frontend, verify normal paths/auth/404, and wait for the existing persistence interval (default five minutes) and dashboard cache to refresh during operator validation. Use only controlled requests against a service you own; do not scan third-party sites.

Rollback by setting `ENABLE_SECURITY_PROBES=false` and redeploying. Existing data remains available to authorized administrators while new probe collection stops. The updated writer preserves historical probe data when disabled; older pre-extension writers may replace the optional section when updating a day. Export retained aggregates before a binary rollback; never disable auth or Firestore rules.

## Testing and operational review

- Unit tests: classifier, encoded paths, malformed/oversized inputs, query isolation, flags, bounded/expired trusted source correlation.
- Integration tests: ordinary 404 and normal business behavior, no per-request database writes, bounded aggregate merge, existing read authorization, missing/invalid/zero coverage and CSV.
- Flutter tests: optional data, historical compatibility, missing-data rendering, protected dashboard.
- Check backend, Flutter, Firestore emulator and applicable browser jobs on the actual PR head before merging. CI is not proof of production observation or latency. No real probe counts are claimed.

## 繁中摘要

安全探測情報以固定類別辨識敏感路徑，紀錄 HTTP 方法、UTC 時段、實際回應結果、可信來源短期重複及跨類型訊號。共用原有 Phase 1／2／3，預設關閉，既有業務權限及回應不變。僅聚合請求計數，不建立誘餌憑證，不儲存原始 IP 或指紋於 Firestore，不主動封鎖。觀測零次與未觀測必須區分；2xx、ASN 及重複指紋皆非入侵或攻擊者身分的證明。
