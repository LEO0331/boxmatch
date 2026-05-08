# Boxmatch 系統設計審查（繁中）

## 1) 範圍與目標
- 產品目標：在展場情境中，快速媒合企業剩食（便當/飲料）給有需要的人，且交付點限定在公開區域。
- MVP 約束：
  - Firebase 維持 Spark 方案。
  - 不依賴付費 Firebase Functions/排程。
  - 企業端維持低摩擦（免登入、token 編輯連結）。

## 2) 現行架構
- Client：Flutter（Web + Mobile）
- Backend API：Render 上的 Node.js + Express
- Data/Auth：Firestore + Firebase Auth（匿名與 ID Token 相容遷移）
- CI/CD：GitHub Actions + Render Deploy Hook + GitHub Pages

權限邊界：
- 所有高權限寫入統一走後端（Admin SDK），不讓前端直寫：
  - listing 建立/更新/rotate/revoke
  - reservation 預約/取消/完成確認
  - abuse signal 回報
- Firestore rules 封鎖受保護集合的 client write。

## 3) 資料模型與選型理由

### 3.1 主要集合
- `venues`
- `listings`
- `reservations`
- `abuse_signals`
- `verified_enterprises`
- `badge_rules`
- `idempotency_keys`
- `kpi_daily`, `kpi_summary`（可選 `kpi_events`）

### 3.2 為什麼這樣設計（與替代方案）

1. `venues` 獨立集合（策展式場館資料）
- 為何選這個：
  - 場館資料穩定、可重用。
  - 容易 seed、快取與 map/list 統一篩選。
  - 避免 listing 自由輸入造成場館名稱漂移。
- 替代：
  - 每筆 listing 直接存 venue 文字。
- 取捨：
  - 文字直存一開始最簡單，但後續一致性與查詢能力差。

2. `listings` 採頂層集合（非 nested 在 venue 底下）
- 為何選這個：
  - 全域 active feed（跨場館）查詢更直接。
  - map/list 混合呈現與時間篩選更好做。
  - `expiresAt`/`status` 索引策略清楚。
- 替代：
  - `/venues/{venueId}/listings/{listingId}` 子集合。
- 取捨：
  - 子集合在單場館維度有局部優勢，但跨場館查詢與分析成本較高。

3. `reservations` 採頂層集合，帶 `listingId` + `claimerUid`
- 為何選這個：
  - 同時支援「企業看某 listing 的預約」與「使用者看我的預約」。
  - recipient 每日上限/風控查詢更直接。
- 替代：
  - nested 在 listing 下。
- 取捨：
  - nested 直覺但 recipient 端我的預約會變多次查詢，擴充性較差。

4. `idempotency_keys` 獨立集合
- 為何選這個：
  - 保證 reserve 重試不重複下單（弱網/超時常見）。
  - 不需額外導入 Redis 仍可達到可接受的去重能力。
- 替代：
  - 只在 reservation 上存 request hash。
  - 用 Redis/in-memory 去重。
- 取捨：
  - reservation 單點 hash 對跨失敗情境較脆弱；
  - Redis 增加成本與運維，不適合 POC 免費期。

5. `verified_enterprises` 獨立集合
- 為何選這個：
  - 信任/審核生命週期與 listing 解耦。
  - 方便人工審核、後續 admin 工具接入。
- 替代：
  - 在 listing 上直接放 `enterpriseVerified` 並由 client 帶入。
- 取捨：
  - 直接帶 flag 容易被濫用且治理困難。

6. `badge_rules/default` 設定文件
- 為何選這個：
  - badge 門檻可後端調整，不需發新版 App。
  - 統一 web/mobile 顯示邏輯，避免前端硬編碼漂移。
- 替代：
  - Flutter 前端硬編碼門檻。
- 取捨：
  - 短期省事，長期維運成本高、策略更新慢。

7. `kpi_daily` + `kpi_summary` 聚合文件
- 為何選這個：
  - Spark 成本友善、實作輕量。
  - 足夠支撐 POC KPI 追蹤與週報。
- 替代：
  - 一開始就上 BigQuery 事件倉儲。
- 取捨：
  - BigQuery 分析能力強，但 POC 階段成本與治理負擔較重。

## 4) API 與安全設計取捨

### 4.1 企業端免登入 token 模式
- 現行：
  - 編輯連結含 token；DB 只存 hash（`editTokenHash`）；提供 rotate/revoke。
- 為何：
  - 展場現場人員上手最快、摩擦最低。
- 風險：
  - 連結外流風險（分享/截圖/歷史紀錄）。
- 緩解：
  - hash 驗證、token 輪替與撤銷、結構化日誌、風險處理 SOP。
- 替代：
  - 企業完整帳號制（email/SSO/角色權限）。
- 取捨：
  - 安全性更強，但導入與運營複雜度顯著提高。

### 4.2 recipient 身份模式（相容遷移）
- 現行：
  - 同時支援 `Authorization: Bearer <ID token>` 與舊 `claimerUid`。
- 為何：
  - 降低舊版客戶端切換風險。
- 風險：
  - legacy 模式抗偽造能力較弱。
- 緩解：
  - 可用 `REQUIRE_ID_TOKEN=true` 進入強制 token 模式。
- 替代：
  - 立即全面切 token-only。
- 取捨：
  - 安全升級快，但可能造成既有流程斷裂。

### 4.3 後端權威寫入
- 現行：
  - 所有關鍵寫入由後端 Admin SDK 執行。
- 為何：
  - 可集中做驗證、交易性庫存扣減、風控與審計。
- 替代：
  - 前端直寫 + 複雜 rules。
- 取捨：
  - 前端直寫看似省後端，但規則複雜、可維護性與安全演進都差。

## 5) 可靠性與效能取捨
- 已採用：
  - reserve idempotency key
  - Firestore transaction 防超賣
  - Flutter timeout + retry
  - enterprise polling backoff
  - app 啟動 health 預熱
- 適配原因：
  - 在免費層 cold start 與弱網條件下，以低成本提升成功率。
- 已知限制：
  - Render free 仍有冷啟動延遲。
  - 尚未做 queue/worker 分離。
- 替代：
  - 付費常駐服務、訊息佇列、快取鎖。
- 取捨：
  - 可改善延遲與吞吐，但會提高固定成本與維運負擔。

## 6) 為何符合 Spark POC 策略
- 避開 Firebase Functions Blaze 需求。
- 保持系統簡潔、可測、可示範。
- 保留擴充路徑：
  - 可切 token-only，
  - 可拆服務模組，
  - 可把 KPI 轉倉儲分析，
  - 可升級企業帳號制。

## 7) Deep-Dive 問答準備

### Q1：為什麼不直接用 Firebase Functions？
- 目前核心是成本與方案限制；Render API 能維持 server-authoritative 同時不升級 Spark。

### Q2：為什麼 reservation 不做 listing 子集合？
- 「我的預約」與跨 listing 查詢在頂層集合更直接，成本與複雜度更低。

### Q3：如何防止多人同時搶單造成超賣？
- reserve 走 transaction 原子扣減 `quantityRemaining`，再加 idempotency 防重覆寫入。

### Q4：企業免登入怎麼建立信任？
- 這是低摩擦信任模型：token proof + hash 驗證 + rotate/revoke + verified 集合 + 未驗證上限。
- 若要更強身份保證，下一步是企業帳號與審核流程。

### Q5：recipient 端如何控濫用？
- 每 UID 每日上限、idempotency、abuse signal、moderation SOP。
- 並已預留切換成強制 ID token 的路徑。

### Q6：badge 規則為什麼放 Firestore？
- PM/Ops 可即時調整門檻，不必等 App 發版；web/mobile 可同步一致。

### Q7：目前最大的上線風險是什麼？
- 免費後端冷啟動延遲。
- 企業 token 連結外流。
- 相容期若過長，legacy uid 風險會被放大。

### Q8：正式擴張時怎麼升級最乾淨？
- 先關閉 legacy（`REQUIRE_ID_TOKEN=true`）。
- 導入 enterprise account + RBAC。
- 加入快取/佇列與更完整 observability。
- 視流量拆分 read/write 與事件管線。

## 8) 審查簡報建議話術
- 先講約束：「我們是 free-tier POC，但關鍵寫入仍走後端權威模型」。
- 再講身份策略是「相容遷移」而非終態。
- 逐一說明每個集合對應的查詢場景與治理價值。
- 最後收斂到清楚升級路徑（auth、效能、營運三軸）。
