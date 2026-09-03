# pure-onboard｜Phase 1 計畫（PLAN.md）

| 項目 | 內容 |
|---|---|
| 日期 | 2026-09-03 |
| 狀態 | **待核准 Phase 1** |
| 來源 | 本文件由 kit.md「Prompt 0」產出；Banson 回覆「核准 Phase 1」之前，不安裝依賴、不建立 `app/`、`lib/`、`supabase/` 下任何檔案、不執行任何寫入 Supabase 的指令 |
| 已鎖定（不再提問） | C-1：Next.js 15＋Supabase＋Vercel；帳號密碼登入（HR 建）；repo private；HR＝產品負責人、Banson＝維護者；Google Sheet 過渡版 9/11 照跑；費用上限（Supabase Pro US$25／Vercel Pro US$20／Anthropic < US$10 皆為示意） |

---

## 0. 核准摘要（一頁決策）

| 項目 | 內容 |
|---|---|
| 要你決定的 | 只有 **Q1**（2.1）：Phase 1 誠實估時 95h【示意】，對上 C-2 排的一週（每日 2–3h）。建議：驗收拆兩段，先驗 T20「手機可示範」切片，Phase 1 整體落在 9/25 前後 |
| 回「核准 Phase 1」等於同意 | (1) 2.2 的 13 條假設 A01–A13（下表一句話版）；(2) 第 5 節依賴白名單（pnpm 10、Node 22、Next 15、Tailwind v4、zod、date-fns＋@date-fns/tz、supabase CLI、tsx、Vitest、Playwright）；(3) 4.10 對 §5 的具體化（只加 check／索引，不加、不刪欄位）與 2 個新環境變數 `SEED_PASSWORD`、`SEED_ALLOWED_PROJECT_REF`；(4) 3.4 K2 的 §12 例外檔清單（工具鏈與 Next.js 必要檔） |
| 不會做的 | 附錄 A：`/admin`、LINE、AI、production、任何付費方案 |
| 里程碑【示意】 | T09 首次 staging 部署（累計約 30h）→ T20 手機可走 C-3 前三步＋第五步（66.5h）→ T30 總驗收＋PR（95h） |
| 費用 | 0【實際】：Supabase／Vercel 免費方案；出現付費提示即停下回報 |
| 回覆格式 | 「核准 Phase 1」＋Q1 答案（不答＝採建議）＋（若有）「A0x 改為…」 |

假設一句話版（完整內容與代價見 2.2）：

| 編號 | 一句話 |
|---|---|
| A01 | 示範帳號免首次改密碼；CI 用本機 Supabase 堆疊，不碰 staging |
| A02 | `left` 不能登入；`sample` 可登入但不進任何名單與指標；母體只有 `active` |
| A03 | seed 用固定英文 username，另加 `ceo` 與 `e2e_fresh` 帳號；密碼走 `SEED_PASSWORD` 環境變數 |
| A04 | HR 介入清單：逾時未回在主管回應後自動離開；「需 HR 協助」以 7 日視窗離開，Phase 1 不加「已處理」鈕 |
| A05 | 軟刪／還原／編輯日誌對預警的連鎖規則（主要落在 Phase 2） |
| A06 | 指標依賴的兩個字面值受發布驗證保護；system slot 恰好一題 |
| A07 | 停用題不顯示、不驗證、不占 slot |
| A08 | 三指標全期計；預警母體不含 closed；24h 內回應率與主管回應率同分母 |
| A09 | 「第幾天／階段／下一節點」的定義；逾期節點標記排最前 |
| A10 | 重提日誌時預警的狀態機：仍成立的 open 只更新內容、不重置 24h 時鐘 |
| A11 | 空答案一律 `null`；show_if 對 `null` 一律不成立 |
| A12 | `user_select` 存 `profiles.id`、只列 active 名單 |
| A13 | 一行摘要各欄位定義；「連結」指向首頁並依角色導向 |

---

## 1. 對 CLAUDE.md 的理解摘要

1. 系統把「明日計畫 → 今日結算 → 預警 → 主管回應 → HR 稽核」做成一條紀錄；新人一天一筆 `newcomer_daily`，同一筆同時裝「對昨日計畫的結算」與「明日計畫」（§1 原則一）。
2. 題目存在 `form_versions.questions`（jsonb）由 HR 在後台增修（Phase 2）；答案存 `submissions.answers = {[question.key]: string|null}`，不建正規化表（§6）。
3. **slot 機制（§6）**：每個題目可綁一個固定的語意槽（`lib/forms/slots.ts` 共 25 個）。規則與昨日計畫讀取一律「以 slot 找題目 key，再以 key 取答案」，所以 HR 改 label、改 order、甚至在新版中把題目換成不同 key 的新題（舊 key 停用、新題綁同一 slot；key 本身發布後不可改），規則與跨版本讀取都不受影響；規則從不比對自由文字，只比對綁了 slot 的 single_select 值（§1 原則二）。
4. **發布驗證（§6）**防止規則與選項脫鉤：發布前檢查「啟用中規則所需的 slot 各綁恰好一題」與「規則參數的比對值（如 `完成`、`有，尚未回報`）存在於所綁題目的 options」；任一失敗即拒絕並列原因，C-4 明言不放寬。
5. **R1 progress（§7）**：對 i∈{1,2,3}，前一筆日誌 `plan.item{i}.expect == expect_done` 且目前 `result.item{i}.status` 非空且 ∉ `status_done` → 收集；有任何項目就一筆 `R1`（detail.items）。**R2 blocker**：`result.blocker.status == unreported` → 一筆 `R2`（detail.text）。
6. 「前一筆」＝同一新人 `log_date` 小於目前日誌日期、未軟刪的最近一筆；9/2 無前一筆 → 零預警；「昨日無此項」與「跨日」都不觸發 R1（§11 預期）。
7. **重新提交**：同一天重提就重跑規則；`alerts` 以 `(submission_id, rule_key)` 唯一，仍成立的 open 只更新 detail、不再成立的 open → `closed(reason='resubmitted')`、已 responded 的一律保留（§7；狀態機細節見假設 A10）。
8. **R3 缺交、A1 逾時、late** 是讀取時推導的狀態，不物化、不建 alert、不用 cron（§3／§7）；R3 只看 active 新人且過了台北 `daily_cutoff_time`，A1 以牆鐘時間差比 `response_threshold_hours`。
9. 主管回應以「日誌」為單位：提交 `manager_response`（`target_submission_id` 必填）→ 該日誌所有 open alerts 改 responded；`response.status='需 HR 協助'` 另列 HR 介入清單；三指標以「預警」為分子分母（§7）。
10. 權限唯一真相在 `lib/auth/guard.ts`（§10 十列 × 五角色），每個頁面、Server Action、Route Handler 都要呼叫；資料存取只在伺服器端走 service role，RLS 對 anon／authenticated deny-all（§3）。
11. 帳號由 HR 建，以 `{username}@pure.internal` 註冊 Supabase Auth；首次登入強制改密碼；session 30 天（§3）。
12. 時區：所有顯示與 `log_date` 計算用 Asia/Taipei，DB 存 timestamptz，時間工具集中在 `lib/time` 並接受 `now` 參數，§11 的假時鐘案例靠這個（§0／§11）。
13. §11 的種子同時是 Vitest fixture：8 筆日誌、2 筆回應、1 筆週回饋，預期恰好 2 筆預警（嚴雅齡 R1 items 1、3；洪湘庭 R2），指標 9/4 18:00 誤報率 0/1、回應率 1/2。
14. Phase 1 範圍＝Prompt 1 Target 1–9：骨架與 CI、migrations＋seed、Auth＋guard、表單引擎＋渲染器、規則、九個前台頁面、Playwright 煙霧、RUNBOOK／DECISIONS、staging 部署與 PR 截圖；不做 `/admin`、LINE、AI。
15. 工作守則：只做明確要求的變更；新依賴、超出 §5 的結構、花錢的動作都要先問；功能分支 → PR → 人審；每步三行回報（§0）。

---

## 2. 必須先回答的問題與假設清單

### 2.1 必須先回答的問題

經對抗式驗證後，**只有一題會改變範圍與驗收方式、且無法自行假設的問題**（Q1）；其餘原本疑似需要裁決的事項都已收斂為 2.2 的 13 條假設，各附建議答案。Banson 回覆「核准 Phase 1」時請一併回答 Q1（未指名即採建議答案），並視為同意全部假設；若對任一條有異議，請指名編號。

| 編號 | 問題 | 建議 |
|---|---|---|
| Q1 | C-2 把 Prompt 1 排在 9/9–9/15（每日 2–3h，約 15–20h），對上本計畫誠實估時 95h（至 T20 切片約 66.5h）：接受 **Phase 1 驗收拆兩段**（第一段先驗 T20 切片＝C-3 前三步＋第五步；`/ceo` 與其餘區塊第二段）並讓 Phase 1 落在 9/25 前後，或提高每日投入？（對應 3.4 K1） | 拆兩段；Google Sheet 過渡版 9/11 已鎖定照跑，不受影響 |

### 2.2 假設清單

| 編號 | 假設（建議答案） | 依據 | 若假設錯了的代價 |
|---|---|---|---|
| A01（F04） | seed 對 §11 全部示範帳號明確寫入 `must_change_password=false`（`default true` 只適用 HR 後台新建帳號）；另建 seed 帳號 `e2e_fresh`（`must_change_password=true`、`status='sample'`，A02）專供首次改密碼 e2e，seed 重跑時重設其密碼與旗標。GitHub Actions 的 e2e 對 supabase CLI 本機堆疊（`supabase start → db reset → seed`）執行，不打 staging；staging 專供本機開發與 C-3 人工驗收；`supabase` CLI 列入本文件 5.4 待核准 devDependencies。本機無 Docker 時 e2e 只在 CI 跑。 | §3「第一次登入強制改密碼」「本機開發連 staging」「Playwright 煙霧」；§5 `must_change_password bool default true`；§13 idempotent | 若必須讓每個 seed 帳號都走首次改密碼：煙霧測試每次登入都被導到改密碼頁，e2e 改掉密碼後第二次跑登不進去；若 CI 必須打 staging：每次 PR 都重置 HR 正在驗收的資料。改回成本：seed 一行旗標＋CI job 改連線，約半天。 |
| A02（F14） | `guard.ts` 放行 `profiles.status ∈ {active, sample}`；`left` 一律 signOut 並導回 `/login?reason=disabled` 顯示「帳號已停用」。`lib/db/queries` 提供單一 `activeNewcomers()`，今日交件、R3 缺交、待處理預警、HR 介入清單、節點到期、一行摘要 n/n、新人總覽一律以它為母體。誤報率與主管回應率以 alerts 事實全量計（離職者歷史預警仍計入）；缺交率只算 active。`sample`＝測試／示範帳號：可登入（guard 放行，供 e2e 與手機實測），但 `activeNewcomers()`、所有清單、指標、一行摘要一律排除，因此不會出現在今日交件、缺交名單、主管卡片或節點到期清單；Phase 1 只有 `e2e_fresh` 用此值。seed 拆 `01_base`（departments、settings、三範本 v1、banson、hr、ceo）與 `02_fixture`（四主管四新人 `status='active'` 與 §11 範例日誌）；production 是否載入 fixture 由 Phase 3 CUTOVER.md 決定。 | §5 `status enum[active,left,sample]`；§9「停用（status=left）」；§7 R3「active 新人」；§8 各清單；§11／§13 | 若 left 應可登入唯讀：guard 放寬一行。若指標母體應含 left：`lib/metrics` 改一處。若 production 要示範帳號：把 fixture 改 `sample` 即可。代價都在半天內，但若不先定，離職新人會永遠掛在 HR 介入清單。 |
| A03（F16） | seed 固定 username：`banson`(admin)、`hr`(hr)、`ceo`(role=ceo，display_name「CEO」，§11 未列但 C-3 驗收要用)、`mgr_construction`／`mgr_procurement`／`mgr_design`／`mgr_xinyi`（工務主任／採購主管／設計副主任／信義總監）、`darren`／`yen_yaling`／`hsieh_wenhsin`／`hung_hsiangting`、`e2e_fresh`(newcomer，見 A01)。密碼由 `SEED_PASSWORD` 環境變數提供（進 `.env.example` 與 CI secret，不進 git，未設即中止）。Playwright 四條路徑＝newcomer、manager、hr、ceo；admin 沒有 Phase 1 頁面，只由 guard 矩陣測試覆蓋。 | §11 只給顯示名稱；§3「{username}@pure.internal」（GoTrue 不接受中文 local part）；C-3「用 CEO 帳號確認沒有任何按鈕」；Prompt 1「四組測試帳號」 | username 上線由 HR 改，seed 值無長期影響；若 Banson 不要 ceo 示範帳號，C-3 第四步無帳號可驗（要改用 Supabase 後台手建）。 |
| A04（F18） | HR 介入清單兩段皆在 `lib/rules/derived.ts` 讀取時推導：「逾時未回」＝active 新人的 open alert 且 `now − created_at > response_threshold_hours`（主管回應即自動離開）；「需 HR 協助」＝近 7 日內 `response.status='需 HR 協助'` 的回應（含無預警日誌的回應，以 `submitted_at` 視窗自然離開，視窗常數放 derived.ts）。Phase 1 不加「已處理」按鈕（§8 未列）；Phase 2 若 HR 要明確標記，對有 alert 者用既有欄位 `closed_reason='hr_handled'` 並寫 audit。 | §8「HR 介入清單（逾時未回、需 HR 協助）」；§7 closed 原因只定義 resubmitted；§3 時間型狀態讀取時推導 | 若 HR 要「處理完就消失」而非 7 日視窗：Phase 2 加一顆按鈕與 closed_reason，不改表；代價一天。若不定，清單只增不減。 |
| A05（F22） | (1) 所有讀 alerts 的查詢一律 join `submissions` 並過濾 `deleted_at is null`，`lib/db/queries` 提供單一 helper，不直接以 `alerts.user_id` 聚合。(2) 軟刪日誌時該筆 open alerts → `closed(reason='submission_deleted')`，responded 不動。(3) 還原時若同人同日已有未刪列 → Server Action 拒絕「請先刪除另一筆」；還原成功後重跑該筆規則。(4) `lib/rules/run.ts` upsert 語意統一（見 A10）。(5) 編輯／軟刪／還原後除重跑該筆，也自動重跑同一新人 log_date 大於該筆的最近一筆未刪日誌；每次重跑寫 audit。(6) 昨日計畫與 R1「前一筆」只取未刪日誌。fixture 加案例：9/2 嚴雅齡日誌軟刪後重跑 9/3 → R1 應 closed。 | §9「編輯答案；軟刪除；還原；重跑該筆規則」；§5 partial unique `where deleted_at is null`；§6「最近一筆日誌」 | 主要落在 Phase 2；Phase 1 只需查詢原則 (1)(6)。若錯：Phase 2 改 Server Action 順序，不改表。 |
| A06（F27） | `slots.ts` 每個 slot 宣告 `cardinality`（`exactly_one`／`at_most_one`）與 `requiredOptions`。system slot（不受 /admin/rules 開關影響、一律恰好一題）＝`plan.item1.text`、`plan.item1.expect`、`response.status`、`weekly.start_date`；`response.status.requiredOptions=['已讀，無需處理','需 HR 協助']`，發布時必須是該題 options 的子集合，否則拒絕並列缺少值；其餘 slot 至多一題。兩個字面值與 R1／R2 預設參數放 `lib/rules/constants.ts`（seed、settings 預設、metrics 共用），不進 `settings.rules`。比對一律 trim 後精確相等，不做全半形正規化。Vitest：把「已讀，無需處理」改「已讀」後發布應被拒。 | §7 指標硬寫兩個字面值；§6 發布驗證只保護「啟用中的規則所需 slot」；§11 manager_response v1；C-4 | 若 HR 想改這兩個字面值：Phase 2 需改 `constants.ts` 一處並發新版表單（Phase 2 才會碰到）。若不定，改選項文字會讓誤報率靜默變 0%。 |
| A07（F28） | `disabled=true` 的題目：渲染器不顯示、不驗證 required、提交時 `answers[key]` 存 `null`；發布驗證視為不存在（不計入 slot 綁定數、不得作為 show_if 目標、不檢查選項數），但仍受「key 同版本唯一」「已發布 key 不得改型別」約束；停用題保留在 questions 陣列（灰階），編輯器不提供刪除；即時預覽同樣跳過。 | §6 Question 只給 `disabled: boolean`；§9 只有停用沒有刪除；§6「恰好一題」 | Phase 1 三張 v1 沒有 disabled 題，只影響 `validate.ts`／`resolve.ts` 的分支；若錯，改兩個函式與其測試，半天內。 |
| A08（F32） | (a) 三指標與新人總覽的累計預警／回應率／缺交率皆「到職至今全期」；(b) 預警母體只計 `status ∈ {open, responded}`，closed 不計，且排除所屬日誌已軟刪者；(c) 新人母體只計 active；(d) 「近 7 日各部門統計」＝以台北今天為末日往前 7 個日曆日（含今天），每部門一列：應交（active 新人 × 期間工作日數，今天未到 cutoff 不計）、已交、缺交、預警數（期間內 created_at）、已回應數、回應率；(e) 24h 內回應率＝responded 且 `responded_at − created_at ≤ 24h`（固定 24 小時，不隨 `response_threshold_hours` 變動）÷ (open＋responded)，與主管回應率同分母；種子 9/4 18:00 → 1/2。全部在讀取時推導，寫進 `lib/metrics` JSDoc 與 DECISIONS。 | §8「近 7 日各部門統計、三指標、新人總覽」；§7「主管回應率 = 已回應預警 ÷ 全部預警」「與 Google Sheet 過渡版一致」 | 種子資料下全期與近 7 日結果相同，測試分不出；若與 Sheet 過渡版口徑不合，雙軌核對（C-2 週 3）會對不上，改 `lib/metrics` 一處。 |
| A09（F34） | 第幾天＝台北今天 − start_date ＋ 1（日曆天）；階段以 milestones 推導：D30 未完成前「第一階段（D30 前）」、D30 完成或已過而 D60 未完成「第二階段（D60 前）」、同理第三階段、D90 完成或第 91 天起「已滿 90 天」；下一節點＝`done_at is null` 且 `due_date` 最小者，過期顯示「逾期 N 天」；start_date null 顯示「尚未設定到職日」、在未來顯示「第 0 天／尚未到職」；start_date 被改時只重算 `done_at is null` 的節點。「未來 7 天」到期清單依 §8 只列 `due_date ∈ [今天, 今天+7]`，逾期未做者以「逾期」標記排在同一區塊最前。 | §8「第幾天、階段、下一節點日期」「節點到期清單（未來 7 天）」；§2 節點；§5 `start_date date null` | 純顯示與推導，錯了改 `lib/time` 一處；若不定，start_date 為空會顯示 NaN，逾期節點會從所有頁面消失。 |
| A10（F43） | alerts 每個 `(submission_id, rule_key)` 永遠恰一列。重跑（新人重提或 HR 重跑走同一函式 `lib/rules/run.ts`）狀態機：仍成立且 open → 只更新 detail，`created_at` 不動（A1 時鐘不重置）；仍成立且 responded → 整列不動；不成立且 open → `closed`、`closed_at=now`、`closed_by=null`（系統）、`closed_reason='resubmitted'`；不成立且 responded／closed → 不動；先前 closed 現在再成立 → 改回 `open`、`created_at=now`、清空 closed_*／responded_*。以同一交易內「讀取—比對—寫入」實作，記 DECISIONS；tests/unit 為「重提後仍成立」「重提後消失」「closed 後再成立」「改 reason 只更新 detail」各加 fixture。 | §7「upsert alerts…不再成立的 open 預警改 closed…已 responded 的保留」；§5 `unique(submission_id, rule_key)`；A1「now − created_at」 | 若 Banson 要「重提也重置 24h 時鐘」：改 run.ts 一個分支。若不定，主管逾時可被新人重送洗掉，或 §11「恰好一筆 R1」在重提情境出現兩筆。 |
| A11（F45） | answers 一律以 `null` 表「空」。`validate.ts` 寫入前正規化：字串 trim 後為 `''` → `null`；隱藏題、disabled 題、未作答、舊版本沒有此題、匯入未對映 → 一律存 `null` 且 key 保留；讀取時缺 key 視同 null（`getAnswer(key) → string|null` 為 resolve.ts 與 lib/rules 共用）。show_if 真值表：`eq(null)=false`、`neq(null)=false`、`in(null)=false`、`not_empty(null)=false`；非 null 時 eq/neq 字串完全比對、in 做 includes。required 只對「show_if 成立且 disabled=false」的題目檢查。R1「非空」＝`getAnswer` 非 null。fixture：謝文心 9/2 只填項目一 → p2/p3_expect 為 null → 9/3 r2/r3=昨日無此項 → 零預警。 | §6「答案存空」「不顯示、不驗證」；§7「非空」；§11 `blocker_detail show_if blocker neq 沒有` | 若 `neq(null)` 應為 true：鏈式條件下隱藏題會讓下游題跳出並要求必填；改真值表一行＋測試。 |
| A12（F49） | `user_select` 的 `options` 必須恰為 `['newcomer']` 或 `['manager']`（發布驗證擋其他）；答案存 `profiles.id`（uuid 字串）；顯示時以 id 查 `display_name`（找不到顯示「（已移除）」）；選單只列 `status='active'` 且 role 相符者，不依部門縮小；Server Action 驗證提交值必須存在於該 role 的 active 名單。 | §6「user_select：選項來自 profiles（依 role 過濾，options 存 'newcomer'\|'manager'）」；`options?: string[]` | Phase 1 三張 v1 沒有 user_select 題；若要存 username／display_name，改渲染器與驗證各一處。 |
| A13（F57） | 一行摘要：連結＝`APP_BASE_URL` 根路徑（`/` 依登入角色導向 `/me/today`、`/manager`、`/hr`、`/ceo`；未登入導 `/login?next=…`），避免主管點到 `/hr` 被擋；「9/11」＝台北今天 M/D；「4/4 已交」＝已交／應交（active 新人數）；「預警 N 筆：A（進度）、B（卡點）」＝log_date 為台北今天的日誌上所有 `status≠closed` 的 alerts，名單用 display_name，R1→進度、R2→卡點；「待主管回應：X」＝目前全部 `status='open'` 的 alerts 數（含往日）。Phase 1 驗收時由 HR 對照 Sheet 過渡版群組訊息，不合再調字串。 | §8 摘要格式；§4 `APP_BASE_URL` | 格式 Phase 3 推播沿用；錯了改 `lib/metrics/summary.ts` 一個字串函式與其測試。 |

---

## 3. Phase 1 任務拆解

估時單位：小時；每項 ≤ 4h（半天）。「驗收」欄引用 §11（種子預期結果）與 §10（權限矩陣）；「Target」欄對應 Prompt 1 Target State 1–9。所有純函式（`lib/time`、`lib/forms`、`lib/rules`、`lib/metrics`、`lib/auth/guard.ts`）測試先行；頁面任務只驗 UI 接線與權限，不重驗規則。

### 3.1 任務表

| id | 任務 | 檔案路徑 | 依賴 | 估時 | 驗收條件 | Target |
|---|---|---|---|---|---|---|
| T01 | 專案骨架、工具鏈與 CI（Next.js 15、TS、Tailwind v4、shadcn/ui、ESLint 9、Vitest、Playwright、GitHub Actions、`.env.example`） | `package.json`、`pnpm-lock.yaml`、`.nvmrc`、`tsconfig.json`、`next.config.ts`、`postcss.config.mjs`、`eslint.config.mjs`、`vitest.config.ts`、`playwright.config.ts`、`components.json`、`.env.example`、`.github/workflows/ci.yml`、`app/layout.tsx`、`app/globals.css`、`app/page.tsx`、`components/ui/utils.ts`、`components/ui/{button,input,label,card,badge,textarea,radio-group,sheet,table,alert}.tsx`、`tests/unit/smoke.test.ts`、`tests/unit/timezone-lint.test.ts`、`docs/DECISIONS.md` | — | 4 | 只安裝本文件第 5 節白名單依賴（`pnpm install --frozen-lockfile`）。`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:e2e`（暫為 placeholder）本機 exit 0。`ci.yml` 四個 job：lint、typecheck、unit（**TZ 矩陣 `UTC`／`Asia/Taipei`／`America/Los_Angeles`** 三次結果相同）、e2e（先 placeholder，T27 接真流程；job 內含 `pnpm exec playwright install --with-deps chromium`、`next build` 所需 §4 五個變數用 `.env.example` 佔位值或 T03 本機堆疊 `supabase status -o env` 的輸出，不設 staging secrets——A01／5.1：staging 金鑰不進 CI）。`tests/unit/timezone-lint.test.ts` 靜態掃描 `lib/`、`app/` 禁止 `getDate()`／`getHours()`／`getDay()`／`toLocaleDateString(` 出現（`lib/time` 例外）。`vitest.config.ts`：`environment: node`、alias `@`／`@seed`、`include: tests/unit/**`、`esbuild.jsx='automatic'`，不設 `resolve.conditions`（5.4；T08／T14／T18 單元測試只 import 不含 `server-only` 的模組）。`.env.example` 列齊 §4 Phase 1 五個變數＋`SEED_PASSWORD`、`SEED_ALLOWED_PROJECT_REF`，值皆為佔位。`components.json` 的 `aliases.utils` 指向 `@/components/ui/utils`（不產生 §12 以外的 `lib/utils.ts`）。`app/page.tsx` 依角色導向（A13），未登入導 `/login`。`globals.css` 設主要按鈕最小高度 44px。DECISIONS 記一列 §12 例外清單（核准 PLAN 即一併認可）：根目錄設定檔（含 `.nvmrc`、`components.json`）、`.github/workflows`、`middleware.ts`、`supabase/config.toml` 為 Next.js／CI／Supabase CLI 必要檔；`app/layout.tsx`（Next 必要根 layout）、`app/globals.css`（Tailwind v4 入口）、`app/page.tsx`（A13 依角色導向的根路徑）位於 `app/` 根目錄，不在 §12 任何子目錄；`app/(auth)/layout.tsx`、`app/(front)/layout.tsx`（route group 共用 layout，Next 慣例；T07 登出鈕所在）位於 route group 根目錄，同樣不在 §12 子目錄；`README.md`（repo 既有檔案，T29 只更新連結）。 | 1 |
| T02 | migrations：§5 九張表、8 個 enum、索引、check、deny-all RLS（清單見 §4） | `supabase/config.toml`、`supabase/migrations/<ts>_helpers.sql`、`_enums.sql`、`_departments.sql`、`_profiles.sql`、`_forms.sql`、`_submissions.sql`、`_alerts.sql`、`_milestones.sql`、`_settings.sql`、`_audit_log.sql` | T01 | 4 | `supabase start && supabase db reset` 從空庫跑到最新無錯（§13）；再對 staging `supabase db push`。九表欄位名／型別逐一對照 §5；不建 `notification_log`。索引以 `pg_indexes` 查得到且**用 psql 實測擋下重複**：同人同日第二筆未刪 `newcomer_daily`、同 (主管, 新人, week_start) 第二筆週回饋、同 `(submission_id, rule_key)`、同 template 第二筆 `published`／第二筆 `draft`、同 `(template_id, version_no)`、同 `(user_id, kind)` milestones 皆失敗。`form_templates.active_version_id` 複合 FK 在 `form_versions` 建好後以 `alter table` 補上，並以 `on delete set null (active_version_id)`（PG 15+）宣告；psql 實測：刪除未被 active 指向的 draft 版本成功；刪除 active 版本後 `active_version_id` 變 null 且 `form_templates` 列仍在。九表 `enable row level security`、零 policy、`revoke all … from anon, authenticated`，helpers 檔設 `alter default privileges`。`supabase/config.toml` 的 `[db.seed] enabled=false`。 | 2 |
| T03 | CI 資料庫層：本機 supabase 堆疊、migrations job、RLS 整合測試、金鑰邊界靜態測試 | `.github/workflows/ci.yml`、`tests/e2e/rls.spec.ts`、`tests/unit/secrets-boundary.test.ts`、`docs/DECISIONS.md` | T02 | 3 | `ci.yml` 新增 `db` job：`supabase start`（CLI 本機堆疊含 `auth` schema，`profiles.id → auth.users` FK 可建）→ `supabase db reset` → 查 `pg_tables` 得九表、`pg_class.relrowsecurity` 九表皆 true、`pg_policies` 0 列；e2e job 在獨立 runner 上自行執行 `supabase start → supabase db reset → pnpm db:seed`（步驟與 `db` job 相同，複製步驟、不另建 composite action；GitHub Actions 各 job 不共用 runner，無法沿用 `db` job 的堆疊；A01：**CI 不打 staging**），`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 由 `supabase status -o env` 取得並覆寫 T01 的佔位值，GitHub secrets 不放任何 staging 金鑰（只放 `SEED_PASSWORD`，A03）。`tests/e2e/rls.spec.ts`：anon key 與已登入 authenticated token 對九表 select 皆 0 列或 42501，service role 可讀（缺環境變數時 skip）。`tests/unit/secrets-boundary.test.ts`：字串 `SUPABASE_SERVICE_ROLE_KEY` 只准出現在 `lib/db/admin.ts`、`tests/e2e/global-setup.ts`（Playwright 無 `react-server` 條件，不能 import 含 `server-only` 的 `lib/db/admin.ts`，自建 client）、`.env.example`、`ci.yml`；`supabase/seed/**` 不得直接讀此變數，一律 import `lib/db/admin.ts`（5.1）；任何含 `'use client'` 的檔案不得 import `lib/db`。DECISIONS：CI 用本機堆疊、staging 專供開發與驗收。 | 1, 2 |
| T04 | §11 fixture（`01_base`、`02_fixture`、預期結果、假時鐘）與基礎 seed（Auth admin 建帳號、profiles、三張表單 v1、settings、milestones；idempotent、`--verify`、防呆） | `supabase/seed/fixtures/base.ts`、`supabase/seed/fixtures/fixture.ts`、`supabase/seed/fixtures/expected.ts`、`supabase/seed/fixtures/index.ts`、`supabase/seed/seed.ts`、`package.json`、`.env.example`、`docs/DECISIONS.md` | T02、T05、T06 | 4 | `pnpm db:seed` 為 TS 腳本（以 `tsx --conditions=react-server` 執行，5.1；可用 tsconfig `@/*` alias，import T06 的 `lib/db/admin.ts` 時 `server-only` 不 throw——第一次執行即驗證此點；T03 `secrets-boundary` 要求 `supabase/seed/**` 一律經 `lib/db/admin.ts`，故本任務必在 T06 之後），用 `lib/db/admin.ts` 的 service role client 走 `auth.admin.getUserById/createUser/updateUserById`（`email_confirm=true`），不 SQL 直插 `auth.users`。`SEED_PASSWORD` 未設即中止；`NEXT_PUBLIC_SUPABASE_URL` 的 project ref ≠ `SEED_ALLOWED_PROJECT_REF` 即拒絕（本機堆疊 ref 為 `local`）。連跑兩次 `--verify`：各表筆數相同，不同即 exit 1。**base**：departments 4；profiles `banson`、`hr`、`ceo`；form_templates 3、form_versions 3（皆 v1 published、`active_version_id` 指向自己）；settings 4 key（本文件 4.8）。**fixture**：四主管、四新人（`status='active'`、`start_date 2026-09-01`、正確 department／manager）、`e2e_fresh`（`status='sample'`，A02）；示範帳號 `must_change_password=false`，`e2e_fresh` 每次重設為 true 與 `SEED_PASSWORD`（A01／A03）。newcomer_daily v1 恰 19 題，key／label／type／options／required／show_if／slot／order 逐題同 §11（#1 name 不設題）；manager_response v1 2 題、weekly_feedback v1 4 題。milestones 15 筆（四位新人 12＋`e2e_fresh` 3；`milestonesFor('2026-09-01')` → 10/01、10/31、11/30）。`fixture.ts` 含 §11 全部 8 筆日誌、2 筆回應、1 筆週回饋（answers 用 v1 key；時間為 `+08:00` ISO；未指明欄位以 `// assumed` 標記）；`expected.ts` 含 2 筆預期 alerts、本文件 4.9.5 全部四個 `CLOCK_*`（`CLOCK_0903_1800`、`CLOCK_0904_1200`、`CLOCK_0904_1800`、`CLOCK_0904_1830`；T19 一行摘要測試用 `CLOCK_0903_1800`）、預期指標——**本任務尚不寫入 submissions／alerts**（T16）。 | 2 |
| T05 | `lib/time`：台北時區純函式（date-fns＋@date-fns/tz，讀 `APP_TIMEZONE`）＋ `milestonesFor` ＋ 單元測試 | `lib/time/index.ts`、`lib/time/milestones.ts`、`tests/unit/time.test.ts`、`tests/unit/milestones.test.ts` | T01 | 2.5 | 所有函式接受 `now: Date`，模組內不呼叫 `Date.now()`；輸出日期一律 `YYYY-MM-DD`。測試：`taipeiDateOf('2026-09-03T15:59:59Z')='2026-09-03'`、`'2026-09-03T16:00:00Z'='2026-09-04'`；`cutoffInstant('2026-09-04','18:00')='2026-09-04T10:00:00Z'`，`isPastCutoff` 在 `09:59:59Z` false、`10:00:00Z` **true（≥）**；`endOfTaipeiDay('2026-09-03')='2026-09-03T15:59:59.999Z'`；`workdaysBetween('2026-09-01','2026-09-04','mon_fri')=4`、到 `'2026-09-07'`=5、`'mon_sat'` 到 9/7=6；`weekStartMonday('2026-09-04')='2026-08-31'`、`('2026-09-07')='2026-09-07'`；`dayNumber('2026-09-01','2026-09-03')=3`，start_date 在未來 → 0、null → null（A09）；`stageOf(milestones, today)` 四階段（A09）；`nextMilestone` 回 `{kind:'D30', due:'2026-10-01'}`，逾期回 `overdueDays`；`isFriday('2026-09-04')=true`；`milestonesFor('2026-09-01')` = D30 10/01、D60 10/31、D90 11/30。三 TZ 矩陣皆綠。 | 5 |
| T06 | `lib/db`：service role client、auth cookie client、`Database` 型別、查詢層 | `lib/db/admin.ts`、`lib/db/types.ts`、`lib/db/queries/{profiles,forms,submissions,alerts,settings,milestones}.ts`、`lib/auth/session.ts`、`package.json`（`db:types`） | T02 | 3 | `lib/db/admin.ts` 第一行 `import 'server-only'`，唯一讀 `SUPABASE_SERVICE_ROLE_KEY` 的檔（T03 靜態測試綠）；`lib/auth/session.ts` 用 `@supabase/ssr` cookie client（`maxAge=30 天`），只做 `signInWithPassword`／`getUser`／`updateUser`／`signOut`，不查資料表。`types.ts` 由 `supabase gen types` 產生。queries 提供且 typecheck 通過：`getProfileByAuthId`、`activeNewcomers({departmentId?})`（A02 唯一母體）、`listProfiles`、`getActiveVersion(key)`、`getVersionById`、`getLogByDate`、`getPreviousLog(userId, beforeDate)`（`log_date < beforeDate`、`deleted_at is null` 最近一筆）、`listLogs`、`listAlertsWithSubmission({...})`（一律 join submissions 過濾 `deleted_at is null`，A05）、`getSettings()`（只取 `settings` 四列並回傳原始 jsonb，缺列 **丟錯**「settings 未初始化，請執行 seed --base」；`rules` 的形狀驗證不在此做，委派給 `lib/rules/settings.ts`，T11）、`listMilestones`、`listResponsesForSubmissions`、`listWeeklyFeedback`。 | 2, 3 |
| T07 | Auth：`/login`、首次登入強制改密碼、登出、30 天 session、`middleware.ts`、停用帳號處理 | `app/(auth)/layout.tsx`、`app/(auth)/login/page.tsx`、`app/(auth)/login/actions.ts`、`app/(auth)/login/change-password/page.tsx`、`app/(auth)/login/change-password/actions.ts`、`middleware.ts`、`app/(front)/layout.tsx`、`lib/auth/session.ts` | T04、T06 | 4 | `/login` 只有「帳號」「密碼」與登入鈕（≥ 44px），無 email 字樣；Server Action 以 `{username}@pure.internal`（小寫）呼叫 `signInWithPassword`，錯誤一律「帳號或密碼錯誤」。登入後 `must_change_password=true` → 導 `/login/change-password`，直接開任何 (front) 頁都被 `requireRole` 導回（檢查點在 guard，middleware 只刷新 session 與未登入導向）。**改密碼頁規則**：新密碼＋確認密碼兩欄；長度 ≥ 8 且含英文與數字；兩欄不符、與舊密碼相同、Supabase 回錯（弱密碼／過短）皆顯示繁中訊息；Supabase 後台密碼最短長度同步設 8（記 RUNBOOK）。改成功 → service client 設 `must_change_password=false` → `homeFor(role)`：newcomer→`/me/today`、manager→`/manager`、hr／admin→`/hr`、ceo→`/ceo`。`status='left'` 登入 → signOut 並導 `/login?reason=disabled` 顯示「帳號已停用」；`status='sample'`（`e2e_fresh`）可正常登入，只是不進任何母體（A02）。登出鈕在 `(front)/layout.tsx`，清 cookie 回 `/login`。未登入開 `/me/today`、`/manager`、`/hr`、`/ceo` → 302 `/login?next=…`。375px 無橫向捲動。 | 3 |
| T08 | `lib/auth/guard.ts` 實作 §10 矩陣 ＋ 50 格單元測試 ＋ guard 呼叫靜態檢查 | `lib/auth/policy.ts`、`lib/auth/guard.ts`、`tests/unit/guard.test.ts`、`tests/unit/guard-coverage.test.ts` | T06 | 3.5 | 矩陣拆兩檔（皆在 §12 `lib/auth`）：`lib/auth/policy.ts` 為純函式模組，**不含 `server-only`**、不 import `lib/db`／`next/headers`，匯出 Action 十種對應 §10 十列（`log:write_own`、`log:read_own`、`newcomer:read`、`alert:respond_or_weekly`、`roster:manage`、`form:manage`、`rules_settings:manage`、`data:manage`、`csv:export`、`audit:read`）、純函式 `can(actor, action, ctx?)`、`canAccessNewcomer(actor, newcomer)`、`canRespond(actor, newcomer) → {allowed, on_behalf}`；`lib/auth/guard.ts` 第一行 `import 'server-only'`，re-export policy 的三個函式（呼叫端一律 import `guard.ts`，§10「唯一真相」不變）並提供包裝 session 的 `requireRole(roles[])`（未登入 redirect `/login`；角色不符 403 頁；`must_change_password` 導改密碼頁；status='left' 導 `/login?reason=disabled`，`sample` 放行，A02）與 `requireNewcomerAccess(id)`。「同部門」以 `department_id` 相等判定（`manager_id` 不算）。`guard.test.ts` 只 import `lib/auth/policy.ts`（Vitest `environment: node` 下 import `server-only` 即 throw，5.4），表驅動，表長斷言 = 60，算式：10×5＝50 格基底；其中 manager 欄的 3 格「同部門」（看新人日誌、回應預警／填週回饋、匯出 CSV）與 newcomer 欄的 2 格「本人」（填／改自己的日誌、看自己的日誌）各拆 true／false 兩例（+5）；再加 actor `left`、目標新人 `left`、hr on_behalf 三例（+3）；再加 actor `sample`、目標新人 `sample` 兩例（+2）。案例：工務主任對 Darren `newcomer:read`／`alert:respond_or_weekly`／`csv:export` true、對嚴雅齡 false；hr `alert:respond_or_weekly` → `{allowed:true, on_behalf:true}`；admin 同上 on_behalf true；ceo 只有 `newcomer:read`、`csv:export` true；newcomer `log:write_own`／`log:read_own` 只對自己 true；`rules_settings:manage` 僅 admin；`audit:read` 僅 hr／admin；actor `status='left'` 全 false；目標新人 `status='left'` 時 respond false；actor `status='sample'`（`e2e_fresh`）`requireRole` 放行且 `log:write_own` 對自己 true（可登入）；目標新人 `status='sample'` 的 `canAccessNewcomer` 與 active 同判（`sample` 只在 `activeNewcomers()` 母體排除，不在 guard 擋，A02）。`guard-coverage.test.ts` 靜態掃描 `app/**/page.tsx`、`app/**/actions.ts`、`app/api/**/route.ts` 必含 `requireRole(`／`requireNewcomerAccess(`／`can(` 之一（白名單：`app/page.tsx`、`app/(auth)/**`）。 | 3 |
| T09 | 首次 staging 部署（Vercel preview ＋ Supabase staging migrations／seed ＋ Auth 設定 ＋ 手機實測；提早踩雷） | `docs/DECISIONS.md`、`docs/RUNBOOK.md`（初稿：Supabase 專案設定） | T07 | 2 | 功能分支 push 後 Vercel 自動產生 preview URL（production branch 設 main，本次不推 main）；Vercel Preview 設好 §4 五個變數；staging 已 `db push` 到最新且 `pnpm db:seed` 完成。Supabase staging Auth：關閉 Confirm email、關閉公開 signup、密碼最短 8；JWT 到期與 refresh token 設定記錄截圖。**30 天 session 驗證法**：暫把 staging JWT expiry 調到 5 分鐘 → 登入後閒置 10 分鐘再操作仍在線（middleware 刷新有效）→ 調回；結果與截圖附 PR；DECISIONS 明記「30 天本身未實測，列入 10/10 30 天檢討」。用手機（LINE 內建瀏覽器）以 `e2e_fresh` 登入 preview → 導改密碼 → 改完落在 `/me/today`（此時可為佔位頁）。Vercel／Supabase 提示需付費即停下回報（Prompt 1 Stop Conditions）。 | 9 |
| T10 | `lib/forms` 表單引擎核心：schema（zod）、slots（cardinality／requiredOptions）、resolve（show_if 真值表、slot、昨日計畫）、validate ＋ 單元測試 | `lib/forms/schema.ts`、`lib/forms/slots.ts`、`lib/forms/resolve.ts`、`lib/forms/validate.ts`、`lib/rules/constants.ts`、`tests/unit/forms-resolve.test.ts`、`tests/unit/forms-validate.test.ts`、`tests/unit/forms-publish.test.ts` | T04、T05 | 4 | `slots.ts` 以 `as const` 匯出 §6 25 個 slot、`Slot` 型別、每個 slot 的 `cardinality` 與 `requiredOptions`、`RULE_REQUIRED_SLOTS`（A06）。`schema.ts` 用 zod 定義 `Question`／`ShowIf`（op→value 形狀：eq/neq 字串、in 陣列、not_empty 無 value）／六種 type，`parseQuestions(jsonb)` 非法即列出原因。`validatePublish(questions, rules)`：key 唯一、single_select ≥ 2 選項、show_if 指向存在且在前、啟用規則所需 slot 恰一題、參數值 ∈ options、system slot 恰一題、`response.status` options ⊇ requiredOptions、disabled 題不計（A06／A07）、`user_select.options` 恰一元素（A12）。`resolve.ts`：`getAnswer(answers, key)`（缺 key→null）、`evaluateShowIf`（A11 真值表）、`visibleQuestions`（排除 disabled 與條件不成立）、`bySlot(version, answers)`、`readYesterdayPlan(prevLog, prevVersion)`。`validate.ts`：只驗可見題，trim 後空字串→null，隱藏／disabled 題強制 null，回 `{ok, errors:{[key]: 繁中}, normalized}`。測試（fixture＝v1 與 §11 日誌）：`r1_status='持續中'` → `r1_reason` 可見；改回 `'完成'` → 不可見且值清 null；`p2_text` 空 → `p2_expect` 不可見且非必填（§11 該題非 required）；`support='需要'` 且 detail 空 → errors；嚴雅齡 9/2 → 三項 `{text, expect:'完成'}`、top=項目二；謝文心 9/2 → item2、item3 皆 `{null,null}`；`previousLog=null` → 三項皆空；**跨版本案例**（key 發布後不可改，§6）：v2 把 v1 的 `p1_text` 停用（`disabled=true`、slot 清空）、新增 key `tomorrow_1` 綁同一 slot `plan.item1.text` 並倒轉 order；以 v2 寫成的日誌（answers 用 `tomorrow_1`）經 `readYesterdayPlan` 讀出與 v1 日誌相同的 `{text, expect}`（§6 靠 slot 不靠 key）；把「已讀，無需處理」改「已讀」後 `validatePublish` 拒絕；同版本兩題綁同一 slot 拒絕；show_if 指向 disabled 題拒絕。 | 4 |
| T11 | `lib/rules`：R1、R2 純函式、`run.ts`（依 settings 啟用）、`reconcile` 狀態機 ＋ §11 預期結果測試 | `lib/rules/types.ts`、`lib/rules/r1.ts`、`lib/rules/r2.ts`、`lib/rules/run.ts`、`lib/rules/settings.ts`、`tests/unit/rules.test.ts`、`tests/unit/rules-reconcile.test.ts` | T10 | 3.5 | `r1`／`r2` 為純函式 `({current: bySlot, previous: bySlot|null, params}) → AlertDraft[]`；`runRules({current, previous, settings})` 只跑 `settings.rules[R].enabled` 者；`lib/rules/settings.ts` 的 `parseRulesSettings(jsonb)` 以 zod 驗證 `settings.rules` 形狀（4.8），非法時丟錯並列出每條原因（測試：缺 `R1.params.expect_done`、`status_done` 非陣列、未知規則 key 各一例），合法時回傳型別化物件供 `runRules` 使用；`reconcile({existing, drafts, now}) → {insert, updateDetail, close, reopen, untouched}`（A10）。§11 測試全綠：嚴雅齡 9/3 → 恰一筆 R1，`detail.items` 恰為 `[{i:1, plan_text:'請款總表移到新表單', status:'持續中', reason:'案件利潤表工項明細不確定，已問 Patty'},{i:3, plan_text:'鋁門窗宏偉報價', status:'持續中', reason:'宏偉訂金確認中'}]`，無 R2；洪湘庭 9/3 → 恰一筆 R2，`detail.text='Luma 免費版有次數限制，只做了 3 張圖'`，無 R1；Darren 9/3、謝文心 9/3、9/2 四筆 → 零筆；對 fixture 全部日誌依時間序執行，結果深等於 `expected.ts`。參數化：`expect_done='跨日'` 時嚴雅齡不觸發；`R1.enabled=false` → 零筆；`R2.enabled=false` → 洪湘庭零筆。reconcile：(a) 首次 → insert 1；(b) 答案不變重提 → 全 untouched；(c) 只改 `r1_reason` → updateDetail 且 `created_at` 不變；(d) 三項改完成且 open → close reason `resubmitted`；(e) 同 (d) 但 responded → untouched；(f) closed 後再成立 → reopen 且 `created_at=now`；(g) 同日重送三次只留一筆。 | 5 |
| T12 | `lib/rules/derived.ts`：R3 缺交／未到時、A1 逾時／late、HR 介入清單推導 ＋ 假時鐘測試 | `lib/rules/derived.ts`、`tests/unit/derived.test.ts` | T04、T05 | 2 | 純函式、`now` 注入：`logStatus({newcomer, date, hasLog, cutoff, now}) → 'submitted'|'missing'|'pending'|'n/a'`（只對 active 且 `date ≥ start_date` 計）；`alertState({alert, thresholdHours, now}) → 'open'|'overdue'|'responded'|'responded_late'|'closed'`；`listMissing`；`hrInterventionList({alerts, responses, now, thresholdHours, windowDays=7})`（A04）。測試（fixture、alerts `created_at＝submitted_at`）：假時鐘 9/4 18:00 → 洪湘庭 R2 `overdue`；9/4 12:00 → `open`；恰 24h（`09-04T09:06Z`）→ `open`，`09:07Z` → `overdue`（**嚴格 >**）；嚴雅齡 R1 → `responded`，16.12h < 24 非 late；門檻 12h → `responded_late`；9/4 18:30 四人皆 missing、18:00:00 整點即 missing（**≥**）、12:00 皆 pending；查 9/3 皆 submitted；`status='left'`／`'sample'` 不列入（母體＝`activeNewcomers()`，A02）；介入清單 9/4 18:00 含洪湘庭 R2，含「需 HR 協助」回應（自建案例）。 | 5 |
| T13 | `components/forms` 渲染器：六種題型、條件顯示、必填與錯誤、手機尺寸 | `components/forms/FormRenderer.tsx`、`components/forms/fields/{SingleSelect,ShortText,LongText,DateField,NumberField,UserSelect}.tsx`、`components/forms/FieldError.tsx`、`tests/unit/forms-renderer.test.ts`、`tests/unit/fixtures/all-types.ts`、`vitest.config.ts` | T10、T01 | 4 | client component，props：`questions`（已 parse）、`initialAnswers`、`userOptions`（server 傳入 `{id, display_name}[]`，A12）、`action`（Server Action）、`submitLabel`、`beforeQuestion?(q)`（讓 /me/today 在 `r{i}_status` 上方插昨日項目文字，不做第二個渲染器）。不含資料存取；用 `useState`＋`useActionState`，不用 react-hook-form。條件顯示直接呼叫 `lib/forms/resolve`：`blocker='沒有'` 時 `blocker_detail` 消失；`p2_text` 有字時 `p2_expect` 出現。送出前跑 `validate`，錯誤顯示在該題下方並捲到第一個錯誤；Server Action 回傳 errors 亦同樣顯示；送出中 disabled 防重送。single_select 用 radio-group 做成 ≥ 44px 可點列；date 用原生 `<input type=date>`；number `inputmode=numeric`；long_text 用 textarea；user_select 用原生 `<select>`。**六型實渲染驗證**（不在正式頁面加任何 preview 開關：§0 不新增未列功能、§6 `/me/today` 永遠用 newcomer_daily active 版）：`tests/unit/forms-renderer.test.ts` 用 `react-dom/server` 的 `renderToStaticMarkup` 直接渲染 `FormRenderer`，餵 `tests/unit/fixtures/all-types.ts`（六型各一題的 questions 與假 `userOptions`），斷言輸出含 radio 群組（single_select）、文字輸入（short_text）、`<textarea>`（long_text）、`type="date"`、`inputmode="numeric"`（number）、`<select>` 且選項為傳入名單（user_select）；不需 jsdom、不加依賴，只在 `vitest.config.ts` 設 `esbuild.jsx='automatic'`（Next tsconfig 為 `preserve`）。e2e 只對 v1 實際用到的三型（single_select、short_text、date）在 T28 mobile.spec 驗證。 | 4, 6 |
| T14 | 日誌提交管線：`prepareDailyLog` 純函式（台北 log_date、23:59 邊界、驗證、規則、對帳）＋ `applyAlertChanges` 落庫 ＋ Server Action | `lib/forms/submit.ts`、`lib/db/queries/alerts.ts`、`lib/db/queries/submissions.ts`、`app/(front)/me/today/actions.ts`、`tests/unit/submit-log.test.ts` | T06、T08、T11 | 3 | `prepareDailyLog({now, actor, activeVersion, existingToday, previousLog, previousVersion, rawAnswers, settings}) → {log_date, answers, submitted_at, alertPlan} | {errors}` 為純函式（`lib/forms/submit.ts` 只含純函式，不 import `lib/db/*`、不含 `server-only`，`submit-log.test.ts` 與 T18 `respond.test.ts` 只 import 它）；`applyAlertChanges` 明確放在 `lib/db/queries/alerts.ts`（import `lib/db/admin.ts`），只由 `actions.ts` 與 seed 呼叫；`actions.ts` 只做 `requireRole(['newcomer'])`＋`can('log:write_own')`＋prepare＋落庫（順序：submission 以自然鍵 `(template_key, user_id, log_date)` select 後 insert／update——不可用 supabase-js `upsert`，partial unique index 無法做 ON CONFLICT 推斷，4.9.2 → alerts insert／updateDetail／close／reopen）。永遠用 `newcomer_daily` active 版本（§6）。單元：`now=2026-09-03T09:03:00Z` 嚴雅齡 → `log_date='2026-09-03'`、previous 為 9/2、`alertPlan.insert` 一筆 R1；`15:59:00Z` 再提交 → 更新同一筆、`submitted_at` 保留、`updated_at=now`；`16:00:00Z` → `log_date='2026-09-04'` 為新一筆，對 9/3 的編輯回「已超過可修改時間」；必填缺漏回 errors 不落庫；隱藏題為 null。`applyAlertChanges` 新 alert `created_at＝submitted_at`（使 §11「≈16.1h」成立）；以 `on conflict (submission_id, rule_key)` 處理唯一鍵。staging 實測：嚴雅齡填 §11 9/3 → 恰一筆 R1；改三項完成重送 → 變 closed(resubmitted)；洪湘庭 → 恰一筆 R2。 | 5, 4 |
| T15 | `/me/today`：頂部狀態、昨日計畫結算區塊、其餘題目、儲存與成功畫面 | `app/(front)/me/layout.tsx`、`app/(front)/me/today/page.tsx`、`app/(front)/me/today/TodayForm.tsx`、`components/dashboard/NewcomerHeader.tsx`、`components/dashboard/AppNav.tsx` | T07、T08、T13、T14 | 3.5 | `requireRole(['newcomer'])`，manager／hr／ceo 開 → 403。頂部「第 N 天｜階段｜下一節點 D30 2026-10-01」（Darren 於 9/3 顯示第 3 天、第一階段）；start_date 空／未來依 A09 顯示。區塊一：對 `readYesterdayPlan` 每個非空 item 透過 `beforeQuestion` 顯示「昨日項目 i：{text}（預計 {expect}）」再接該 slot 的 status／reason 題；無前一筆時顯示「昨天沒有計畫，請選『昨日無此項』」但三題仍必填（§11 9/2 情境）。區塊二渲染其餘題目。成功後顯示「已儲存」與明日三件事（`plan.item1–3.text`，top 加標記）；當天再開頁載入可編輯。375px 無橫向捲動、主要按鈕 ≥ 44px。以 Darren 在 staging 實填 §11 9/3 → submissions 恰一筆、19 個 key 值正確、隱藏題 null。 | 6, 4 |
| T16 | seed 補齊 §11 範例日誌、預警、主管回應、週回饋（走 `runRules＋applyAlertChanges` 同一路徑）＋ `--anchor` 日期平移（示範用） | `supabase/seed/seed.ts`、`supabase/seed/fixtures/fixture.ts`、`docs/RUNBOOK.md` | T14、T04 | 3.5 | 依 log_date 順序寫入 8 筆日誌（`submitted_at`＝§11 台北時間；以自然鍵 select 後 insert／update——不可用 supabase-js `upsert`，partial unique index 無法做 ON CONFLICT 推斷，4.9.2；`updated_at＝submitted_at`）並對每筆呼叫 `runRules＋applyAlertChanges(now=submitted_at)`（seed 以 `tsx --conditions=react-server` 執行才能 import `lib/db/queries/alerts.ts`，5.1）→ alerts 恰 2 筆（嚴雅齡 R1 `created_at=2026-09-03T09:03:00Z`、items 1 與 3；洪湘庭 R2 open）；寫入 2 筆回應（採購主管→嚴雅齡 9/3 `{status:'已處理', comment:'已請 Patty 給工項對照表；宏偉訂金明早追'}` 9/4 09:10；工務主任→Darren 9/3 `{status:'已讀，無需處理', comment:null}` 9/4 09:20）並把嚴雅齡 R1 改 responded／`responded_at`／`response_submission_id`；1 筆週回饋（工務主任→Darren，`week_start 2026-08-31`，三句同 §11，9/4 17:00）。seed 結果與 `expected.ts` 比對，不符即 exit 1（seed 與規則永不分岐）。`--verify` 連跑兩次：submissions 11、alerts 2、嚴雅齡 R1 仍 responded、洪湘庭 R2 仍 open。**`--anchor YYYY-MM-DD`**（只准 staging／本機）：把 fixture 的 9/3 對映到 anchor 日、其他日期等距平移（start_date、log_date、submitted_at、milestones、`week_start` 以 `weekStartMonday` 重算）；預設不平移（CI／單元測試永遠用固定日期）。RUNBOOK：驗收前一天由 Banson 跑 `pnpm db:seed --anchor <上一個工作日>`，儀表板才不會顯示連續多日缺交。 | 2, 5 |
| T17 | `/manager` 部門新人卡片 ＋ `/manager/newcomer/[id]` 時間軸（唯讀部分；hr／admin 可進） | `app/(front)/manager/layout.tsx`、`app/(front)/manager/page.tsx`、`app/(front)/manager/newcomer/[id]/page.tsx`、`components/dashboard/NewcomerCard.tsx`、`components/dashboard/Timeline.tsx`、`components/dashboard/AlertBadge.tsx` | T08、T12、T16、T10 | 3.5 | `requireRole(['manager','hr','admin'])`；manager 只列同部門 active 新人（§10 列 3：工務主任只見 Darren）；hr／admin 見全部並在頁首標示「HR 代填模式」。卡片：今日計畫（最近一筆日誌 `plan.item1–3.text`）、今日交件狀態（derived R3 以台北現在）、open 預警數、逾時數。`/manager/newcomer/[id]` 先 `requireNewcomerAccess(id)`：工務主任開嚴雅齡 → 403。時間軸每日一列（新到舊）：昨計畫三項與結算並排（用該筆日誌自己的 form_version label，§6）、卡點＋說明、明日計畫、預警（R1→進度、R2→卡點；待回應／逾時／已回應／已關閉）、我的回應（透過 slot 讀；role ∈ {hr, admin} 的回應標「HR 代填」）。seed 下採購主管開嚴雅齡：9/3 列顯示 R1 兩項與 9/4 09:10「已處理」；信義總監開洪湘庭：R2 待回應。375px 每列可讀、無橫向捲動。 | 6 |
| T18 | 主管回應抽屜 ＋ `submitManagerResponse`（open 預警改 responded；on_behalf 由角色推導） | `app/(front)/manager/newcomer/[id]/actions.ts`、`app/(front)/manager/newcomer/[id]/ResponseDrawer.tsx`、`lib/forms/submit.ts`、`tests/unit/respond.test.ts` | T17、T13 | 3 | 每一日列都有「回應」鈕（≥ 44px；有無預警皆可，§11 工務主任對無預警的 Darren 9/3 也回應），開底部 sheet 以 FormRenderer 渲染 manager_response active 版；對象新人與日誌由 UI 帶入、Server Action 以 `target_submission_id` 反查新人（不信任 client 的 `target_user_id`）。`prepareResponse` 純函式測試：嚴雅齡 9/3 有 open R1 → 回應後 responded、`responded_at=now`、`response_submission_id`；Darren 9/3 無 alerts → 仍建回應、alerts 更新 0；hr → `on_behalf=true`（Phase 1 不加欄位，顯示由回應者 role 推導，記 DECISIONS）；工務主任對嚴雅齡 → 拒絕。同一回應者對同一日誌重送 → 更新不新增。responded／closed 不動（§7）。從點「回應」到送出 ≤ 20 秒（e2e 計時）。staging：信義總監回應洪湘庭「需 HR 協助」→ R2 responded 並進 HR 介入清單。 | 6, 5 |
| T19 | `lib/metrics/summary.ts`（一行摘要）＋ `buildHrDashboard(now)` 單一伺服器組裝函式 ＋ 假時鐘測試 | `lib/metrics/summary.ts`、`lib/metrics/dashboard.ts`、`tests/unit/summary.test.ts`、`tests/unit/dashboard.test.ts` | T12、T06 | 3 | `buildDailySummary({date, submitted, expected, todayAlerts, openCount, baseUrl})` 純函式（A13）：假時鐘 9/3 18:00 → 恰為 `9/3 新人日誌｜4/4 已交｜預警 2 筆：嚴雅齡（進度）、洪湘庭（卡點）｜待主管回應：2｜{APP_BASE_URL}/`（應交 4＝`activeNewcomers()`；`e2e_fresh` 為 `sample` 不計，staging 與單元測試同為 4/4，A02）；9/4 18:00 → `0/4 已交`、`預警 0 筆`、`待主管回應：1`。`buildHrDashboard({now, data})` 以純函式組裝今日交件、待處理預警、HR 介入清單（T12）、節點到期（A09），`/hr` 與 `/ceo` 共用（數字必然一致）；測試：9/4 18:00 → 應交 4／已交 0／缺交 4／未到時 0 且缺交名單四人；9/4 12:00 → 未到時 4；待處理預警列洪湘庭 R2；介入清單含洪湘庭 R2；節點到期 9/4 與 9/23 為空、9/24 起列四筆 D30（A09 含端點：9/24＋7＝10/01）。查詢層不得自行比較時間（全部經 `lib/time`／`derived`）。 | 6 |
| T20 | `/hr` 儀表板（一）：今日交件、待處理預警、HR 介入清單、複製一行摘要 ★第一次可在手機示範 | `app/(front)/hr/layout.tsx`、`app/(front)/hr/page.tsx`、`components/dashboard/{TodaySubmissions,AlertList,InterventionList,CopySummaryButton}.tsx` | T19、T18、T16 | 3.5 | `requireRole(['hr','admin'])`；newcomer／manager／ceo 開 `/hr` → 403（C-3 第五步）。三個區塊由 `buildHrDashboard(now)` 餵資料；待處理預警每列連到 `/hr/newcomer/[id]`（T25 前暫連 `/manager/newcomer/[id]`）。`CopySummaryButton` 以 `navigator.clipboard` 複製並顯示「已複製」；clipboard 不可用（LINE 內建瀏覽器）時退回可全選的唯讀文字框。375px 無橫向捲動、按鈕 ≥ 44px。完成並推上分支後可用手機走 C-3 前三步與第五步。 | 6 |
| T21 | `/me/history`：按日期列出自己的預警、主管回應狀態與一句話、週回饋 | `app/(front)/me/history/page.tsx`、`components/dashboard/HistoryList.tsx` | T16、T15 | 3 | `requireRole(['newcomer'])`，只查 `user_id＝自己`（§10 列 2）。log_date 新到舊，每日：日誌摘要（該筆 form_version label）、預警（進度／卡點＋狀態）、主管回應狀態與一句話（slot `response.status`／`response.comment`）、當週週回饋（`week_start＝該日所在週一`）。seed：Darren 9/3 無預警但有「已讀，無需處理」與 8/31 週回饋三行；嚴雅齡 9/3 R1 已回應＋「已處理」＋一句話；洪湘庭 9/3 R2 待回應；嚴雅齡登入看不到 Darren 資料；無日誌顯示「還沒有日誌」。375px 可讀。 | 6 |
| T22 | `/manager/weekly` 週回饋表單 ＋ `/manager` 週五「週回饋未填」提醒 | `app/(front)/manager/weekly/page.tsx`、`app/(front)/manager/weekly/actions.ts`、`app/(front)/manager/page.tsx`、`lib/forms/submit.ts` | T17、T13 | 3 | `requireRole(['manager','hr','admin'])` 且對象新人須 `canAccessNewcomer`（工務主任選不到、送不了嚴雅齡）。對象下拉（同部門 active 新人；hr／admin 全部）＋ FormRenderer 渲染 weekly_feedback active 版；`week_start` 預設本週一。`submitWeeklyFeedback`：`week_start` 由 slot `weekly.start_date` 經 `weekStartMonday` 正規化後寫欄位；同 (主管, 新人, week_start) 已存在 → 更新（不撞 partial unique）。`/manager` 在台北週五（`isFriday`）對本週尚無週回饋的新人卡片顯示「週回饋未填」並連到 `/manager/weekly?newcomer={id}`；seed 下工務主任對 Darren 8/31 週已有 → 該週不提醒（邏輯用假日期單元測試，頁面以真實時間人工驗）。 | 6 |
| T23 | `lib/metrics`：三指標、近 7 日各部門統計、新人總覽 ＋ 單元測試 | `lib/metrics/rates.ts`、`lib/metrics/department.ts`、`lib/metrics/newcomer.ts`、`lib/metrics/index.ts`、`tests/unit/metrics.test.ts` | T12、T16、T05 | 3 | 全部純函式（輸入 alerts／responses／logs／profiles／settings／now，母體依 A02／A08）。`falsePositiveRate`＝已回應預警中回應 `response.status=='已讀，無需處理'` 者 ÷ 已回應；`responseRate`＝responded ÷ (open＋responded)；`within24hRate`＝responded 且 `responded_at − created_at ≤ 24h` ÷ (open＋responded)（固定 24h、與 `responseRate` 同分母，A08(e)；JSDoc 註明分母口徑）；`missingRate(newcomer)`＝1 − 累計日誌 ÷ `workdaysBetween(start_date, today, workweek)`（今天只在過 cutoff 後計入；分母 0 回 null）；`departmentStats7d`；`newcomerOverview`。測試（假時鐘 9/4 18:00）：誤報率 0/1＝0%（Darren 回應無預警不計）、主管回應率 1/2、24h 內 1/2；Darren 缺交率 1−2/4＝50%；9/4 12:00 → 1−2/3；`start_date＝today` 未到 cutoff → null；部門統計採購 2 筆日誌／1 預警／1 回應，信義設計 2／1／0；總覽嚴雅齡累計預警 1、回應率 100%，洪湘庭 1、0%。 | 6, 5 |
| T24 | `/hr` 儀表板（二）：近 7 日各部門統計、三指標、新人總覽、節點到期清單 | `app/(front)/hr/page.tsx`、`components/dashboard/{DepartmentStats,MetricsTiles,NewcomerOverview,MilestoneDue}.tsx` | T23、T20 | 3.5 | 三指標卡（seed、9/4 18:00 之後：0%／50%／50%）；新人總覽每列姓名、部門、第 N 天、階段、下一節點、累計預警、回應率、缺交率，姓名連 `/hr/newcomer/[id]`；近 7 日各部門表；節點到期清單（A09：逾期在前）。表格在自身容器 `overflow-x-auto`，頁面本體不橫向捲動；每區塊有空狀態文字；本頁除複製摘要外無其他寫入操作。 | 6 |
| T25 | `/hr/newcomer/[id]` 90 天總覽＋時間軸 ＋ 該員 CSV 匯出 Route Handler（不含節點紀錄表單） | `app/(front)/hr/newcomer/[id]/page.tsx`、`app/api/export/newcomer/[id]/route.ts`、`lib/db/csv.ts`、`components/dashboard/NinetyDayOverview.tsx`、`tests/unit/csv.test.ts` | T20、T08、T23、T17 | 3.5 | 頁面 `requireRole(['hr','admin'])`；90 天總覽：到職日、第 N 天、階段、三節點日期與狀態（唯讀）、累計日誌／缺交率／累計預警／回應率；Timeline 重用 T17（readOnly，無回應鈕；節點紀錄表單為 Phase 3）。「匯出 CSV」→ GET `/api/export/newcomer/[id]`，Route Handler 內 `requireRole(['manager','hr','ceo','admin'])`＋`canAccessNewcomer`（§10 列 9：newcomer → 403；工務主任對嚴雅齡 → 403；採購主管 → 200；未登入 401）。CSV：UTF-8 BOM、CRLF、`text/csv; charset=utf-8`、`Content-Disposition: attachment; filename={username}-daily.csv`；欄＝`log_date`、`submitted_at`（台北）＋ 該員日誌所用各版本題目 key 的聯集（表頭 `label (key)`，label 取最新含該 key 的版本；key 發布後不可改故同一 key 跨版本穩定；同一 slot 的不同 key——如 T10 案例的 `p1_text` 與 `tomorrow_1`——在 CSV 會是不同欄）＋ `alerts`（`rule_key:status` 以 `;` 串接）＋ `response_status`、`response_comment`；只匯出未刪日誌。`csv.test.ts`：逗號、雙引號、換行、null 跳脫；嚴雅齡兩列，9/3 列 `alerts='R1:responded'`、`response_status='已處理'`。 | 6 |
| T26 | `/ceo` 唯讀儀表板（無任何操作按鈕） | `app/(front)/ceo/layout.tsx`、`app/(front)/ceo/page.tsx`（重用 T20／T24 元件 `readOnly`） | T24 | 2 | `requireRole(['ceo'])`；admin 開 `/ceo` → 403（admin 用 `/hr`）、ceo 開 `/hr`／`/manager` → 403。同一 `buildHrDashboard(now)` 餵資料，只渲染儀表板與新人總覽；不出現複製摘要、回應、匯出與任何連到 `/hr/newcomer` 的連結（§8）。`main` 內 `button`／`form` 元素數 0（登出鈕在導覽列，T27 斷言）。375px 可讀。 | 6 |
| T27 | Playwright 煙霧：主流程（R2 路徑）、未授權存取、首次改密碼 ＋ CI e2e job（本機堆疊） | `tests/e2e/global-setup.ts`、`tests/e2e/fixtures/accounts.ts`、`tests/e2e/flow.spec.ts`、`tests/e2e/authz.spec.ts`、`tests/e2e/first-login.spec.ts`、`playwright.config.ts`、`.github/workflows/ci.yml` | T03、T09、T16、T20、T21、T22、T26 | 4 | `playwright.config.ts`：viewport 375×812、`isMobile`、`webServer` 為 `next build && next start`、`workers=1`。`global-setup`：以 service role 刪除四位 seed 新人 `log_date＝台北今日` 的 submissions、其 alerts、指向它們的回應，再跑 `pnpm db:seed`（§11 資料不變）。`flow.spec`（Target 7，與執行日期無關）：洪湘庭登入 → `/me/today` 結算三項選「昨日無此項」、`blocker='有，尚未回報'`＋detail、`p1` 必填 → 「已儲存」 → 信義總監登入 `/manager` 洪湘庭卡片 open 預警數 = 2（seed 既有的 9/3 R2 永不回應、仍 open 且已逾時，加上本次提交的 R2；不斷言逾時數）→ 時間軸今日列出現「卡點」且狀態為待回應 → 回應「已處理」＋一句話（計時 ≤ 20 秒） → HR 登入 `/hr` 待處理預警不含該筆、複製摘要文字含「洪湘庭」、`/hr/newcomer/[洪湘庭]` 今日列已回應。`authz.spec`：未登入 `/me/today` → `/login`；洪湘庭開 `/hr` → 403；信義總監開 `/manager/newcomer/{Darren}` → 403；洪湘庭 GET `/api/export/newcomer/{Darren}` → 403；ceo 開 `/ceo` main 內 button 0、開 `/hr` → 403；四種角色（newcomer、manager、hr、ceo）各至少一條路徑（§3）。`first-login.spec`：`e2e_fresh` 登入 → 導改密碼 → 改完落 `/me/today` → teardown 以 service role 還原旗標與密碼。CI e2e job 在 lint／typecheck／unit／db 之後，對 e2e job 自建的本機堆疊執行（步驟同 T03 `db` job），失敗上傳 trace；本機與 CI 連跑兩次皆綠。e2e 連續失敗兩次即停下回報。 | 7, 1, 3 |
| T28 | 375px 全頁稽核（scrollWidth、44px 斷言）＋ 自動截圖 ＋ v1 三型渲染驗證 | `tests/e2e/mobile.spec.ts` | T27、T13 | 2 | `mobile.spec` 以四角色逐頁開 `/login`、`/me/today`、`/me/history`、`/manager`、`/manager/newcomer/[id]`（抽屜開啟）、`/manager/weekly`、`/hr`、`/hr/newcomer/[id]`、`/ceo`：斷言 `document.documentElement.scrollWidth ≤ 375`，每個 `[data-primary]` 按鈕 `boundingBox().height ≥ 44`；每頁存一張截圖到 `test-results/`（gitignored，供 PR）。渲染驗證只用正式頁面與 active 版本：`/me/today` 斷言 radio 群組（single_select）與文字輸入（short_text）存在，`/manager/weekly` 斷言 `input[type=date]`（date）存在；六型完整驗證在 T13 的 `forms-renderer.test.ts`，不在 `/me/today` 加 preview 開關。 | 6, 9 |
| T29 | `docs/RUNBOOK.md`（HR 操作手冊）＋ `docs/DECISIONS.md` 補齊 Phase 1 決定 | `docs/RUNBOOK.md`、`docs/DECISIONS.md`、`README.md` | T20、T16、T22 | 2.5 | RUNBOOK 章節：(1) 登入與首次改密碼（密碼規則）、忘記密碼；(2) HR 每日：`/hr` 各區塊怎麼讀（缺交 vs 未到時＝18:00 cutoff、逾時＝24h、HR 介入清單兩種來源與 7 日視窗）、複製一行摘要貼 LINE 群；(3) Phase 1 建帳號兩條路（Target 8）：A. 在 `supabase/seed/fixtures/fixture.ts` 加人後 `pnpm db:seed`（自動建 auth 使用者、profile、三筆 milestones）；B. Supabase 後台 Auth 建 `{username}@pure.internal`（email confirm 勾選）→ `profiles` 補一列（欄位清單）→ 跑 `pnpm db:seed --milestones-only` 補三筆節點；(4) 重設密碼與把 `must_change_password` 設回 true；停用（`status=left`，登入會顯示「帳號已停用」）；(5) 主管路徑：卡片 → 時間軸 → 回應 → 週五週回饋；HR 代填在 `/manager`；(6) Supabase 專案必要設定（關 Confirm email、關公開 signup、密碼最短 8、refresh token）、staging／production、免費專案閒置暫停時的手動喚醒；(7) 驗收前 `--anchor` 平移示範資料；重跑 seed 只重設 `e2e_fresh` 的密碼與 `must_change_password`，示範帳號密碼不動，要重設需加 `--reset-passwords`；(8) 已知限制（Phase 2 才有 /admin，Phase 3 才有通知與節點）。由 HR 照 (2)(3) 實際操作一次不需工程師即通過。DECISIONS 每列日期／決定／理由，至少含：§12 例外檔（含 `app/(auth)/layout.tsx`、`app/(front)/layout.tsx`、`README.md`）；guard 拆 `policy.ts`（純函式）／`guard.ts`（`server-only`）；submissions 以自然鍵 select 後 insert／update、不用 supabase-js upsert（partial unique index 無法做 ON CONFLICT 推斷），alerts 用 `on conflict (submission_id, rule_key)`；shadcn utils 放 `components/ui`；seed 為 TS 腳本走 Auth admin API、以 `tsx --conditions=react-server` 執行（5.1）；`SEED_PASSWORD`／`SEED_ALLOWED_PROJECT_REF`；ceo 與 `e2e_fresh`（`status='sample'`，可登入、不進母體）示範帳號；示範帳號 `must_change_password=false`；CI 用本機堆疊；`alerts.created_at＝submitted_at`；reconcile 狀態機（A10）；同部門以 `department_id`；on_behalf 由角色推導、Phase 2 再議欄位；主管可回應無預警日誌；缺交率分母含今日條件；cutoff ≥、A1 >；30 天 session 作法與未驗證項；milestones 應用層建立；zod／date-fns 選擇；`--anchor` 只准非 CI。 | 8 |
| T30 | §13 完成定義總驗收：staging 最終驗證、PR 描述（測試方式、截圖、staging URL、四組帳號） | `docs/PLAN.md`（勾選）、`docs/DECISIONS.md`、`.env.example` | T25、T28、T29 | 2 | CI lint／typecheck／unit（三 TZ）／db／e2e 全綠；`supabase db reset` 從空庫無錯；`pnpm db:seed --verify` 兩次一致（milestones 15、submissions 11、alerts 2）；staging `/hr` 今日交件應交數為 4（`e2e_fresh` 為 `sample` 不計，A02）；`grep -rho "process.env.[A-Z_]*" app lib supabase tests middleware.ts | sort -u` 每個變數都在 `.env.example`；DECISIONS 已更新。用手機 LINE 內建瀏覽器在 staging preview 走完 C-3 五步（新人填日誌 → 主管看到預警並回應 → HR 看到已回應與複製摘要 → CEO 無按鈕 → 新人開 `/hr` 被擋）。PR 描述含：測試方式、T28 的 9 張 375px 截圖、T09 的 Auth 設定截圖與 session 驗證結果、staging URL、四組測試帳號（`hung_hsiangting`／`mgr_xinyi`／`hr`／`ceo`；密碼另行非 git 管道交付）、Prompt 1 Checkpoints 的檔案變更總表與測試摘要；PLAN.md §3 逐項勾選。PR 開給人審，不合併、不推 main（§0）。 | 9 |

**估時合計：95 小時**（至 T20「第一次可在手機示範」約 66.5 小時）。

### 3.2 Target 覆蓋對照

| Prompt 1 Target | 覆蓋任務 |
|---|---|
| 1 骨架、ESLint、Vitest、Playwright、GitHub Actions | T01、T03、T27 |
| 2 migrations、enum、索引、deny-all RLS、seed 可重跑＝§11 | T02、T03、T04、T06、T16 |
| 3 Auth、首次改密碼、30 天 session、登出、guard 每一格測試 | T06、T07、T08、T09、T27 |
| 4 lib/forms ＋ 渲染器六型、條件、必填、錯誤；只渲染 active 版 | T10、T13（六型以 `renderToStaticMarkup` 單元測試）、T14、T15 |
| 5 R1、R2、derived、提交時 upsert、重提處理、§11 全綠 | T05、T11、T12、T14、T16、T18、T23 |
| 6 九個頁面 375px、按鈕 ≥ 44px | T07、T13、T15、T17–T26、T28 |
| 7 Playwright 煙霧＋未授權被擋 | T27 |
| 8 DECISIONS、RUNBOOK | T29 |
| 9 部署 staging、PR 附手機截圖 | T09、T28、T30 |

### 3.3 建議執行順序

| 層 | 任務 | 目的 |
|---|---|---|
| (1) 地基 | T01 → T02 → T03、T05 → T06 → T04 | 骨架與 CI、schema、CI 本機資料庫、時區工具、DB 存取層、fixture＋基礎 seed（seed 與 T03 `secrets-boundary` 都要 import T06 的 `lib/db/admin.ts`，故 T04 排在 T06 之後）；§11 資料先寫成程式碼供所有測試共用 |
| (2) 進門 | T07、T08 → T09 | 登入、guard 每格測試，然後**立刻部署一次 staging** 把 Vercel／Supabase Auth／LINE 內建瀏覽器這些不在 repo 裡的雷提早踩掉 |
| (3) 切片核心 | T10 → T11、T12 → T13 → T14 → T15 → T16 | 表單引擎與規則純函式先綠，再做渲染器、提交管線、`/me/today`，最後用同一條 `applyAlertChanges` 把 §11 資料 seed 進去 |
| (4) 切片收尾 | T17 → T18 → T19 → T20 ★ | 主管卡片與時間軸 → 回應抽屜 → 儀表板組裝函式 → `/hr` 最小可用區塊。T20 推上分支後，C-3 五步中除 CEO 外皆可在手機上走 |
| (5) 補廣度 | T21、T22、T23 → T24 → T25 → T26 | 歷史、週回饋、指標、`/hr` 其餘、`/hr/newcomer`＋CSV、`/ceo` |
| (6) 收尾 | T27 → T28 → T29 → T30 | e2e（需要所有頁面）、手機稽核與截圖、文件、§13 總驗收與 PR |

可平行的分支：T05 與 T02／T03；T08 與 T07；T10 與 T12；T11 與 T12（皆在 T10 之後）；T21／T22／T23 之間。DAG 無環。

### 3.4 風險與對策

| # | 風險 | 對策 |
|---|---|---|
| K1 | **時程落差**：誠實估 95h，到 T20 切片約 66.5h；C-2 以每日 2–3h 排在 9/9–9/15（約 15–20h），照做不可能 9/15 完成 Target 1–9 | 已列為 2.1 **Q1** 請 Banson 裁決（建議：驗收拆兩段——先驗 T20 切片＝C-3 前三步＋第五步，/ceo 與其餘區塊第二段，Phase 1 落在 9/25 前後）；Google Sheet 9/11 過渡版已鎖定照跑，不受影響。順序設計成任何時點中止都留下可測、可重跑的規則與資料層 |
| K2 | **§12 目錄限制 vs 工具鏈必要檔**：`package.json`、各 config、`middleware.ts`、`.github/workflows/ci.yml`、`supabase/config.toml`、`.nvmrc`、`components.json` 與 `app/` 根目錄的 `app/layout.tsx`／`app/globals.css`／`app/page.tsx`、route group 根目錄的 `app/(auth)/layout.tsx`／`app/(front)/layout.tsx`（T07）不在 §12（§12 只列 `app/` 的子目錄）；T29 更新既有 `README.md` 亦在規格範圍外；shadcn 預設把 `utils.ts` 放 `lib/` 根目錄 | T01 以 `components.json` alias 把 utils 收進 `components/ui`；其餘視為工具鏈／框架必要例外（`app/layout.tsx`＝Next 必要根 layout、`app/globals.css`＝Tailwind 入口、`app/page.tsx`＝A13 依角色導向、`app/(auth)/layout.tsx`／`app/(front)/layout.tsx`＝route group 共用 layout 的 Next 慣例、`README.md`＝既有檔案只更新連結；清單見 T01 驗收欄）記 DECISIONS，並在核准 PLAN 時一併認可，避免中途觸發 §0 停工 |
| K3 | **Supabase Auth 與 session 設定不在 repo**（Confirm email、公開 signup、密碼政策、JWT／refresh token）；30 天 session 真機未證 | T09 提前部署並手機實測登入→改密碼；seed 走 Auth admin API；session 靠 middleware 刷新＋cookie maxAge；T09 以縮短 JWT expiry 驗證刷新有效，DECISIONS 明記 30 天為未實測假設、10/10 檢討；若免費方案做不到就回報，不自行升級 |
| K4 | **時間推導綁真實時鐘**：缺交／未到時 18:00、逾時 24h、週五提醒在頁面無法注入假時鐘；Vercel／CI 為 UTC、本機為台北 | 所有 derived／metrics／dashboard 以 `now` 參數化並用 §11 假時鐘單元測試；CI unit 三 TZ 矩陣＋靜態禁用依賴執行環境時區的 Date API（`getDate()`／`getHours()` 等）；e2e 只斷言與時間無關的事實（R2 路徑、回應、權限）；頁面只驗接線 |
| K5 | **示範資料日期漂移**：§11 固定在 9/2–9/3、start_date 9/1，驗收約 9/15 後儀表板會顯示多日缺交、R2 逾時多日，HR 會誤判系統有錯 | T16 `--anchor` 平移（只准非 CI），RUNBOOK 規定驗收前一天執行；單元測試與 CI 永遠用固定日期 |
| K6 | **CI e2e 與 HR 試用共用 staging**：seed 重跑清掉試用資料、重設密碼、兩個 PR 互相污染 | A01：CI 用 supabase CLI 本機堆疊（T03），staging 只有本機開發與人工驗收；示範帳號密碼固定、只有 `e2e_fresh` 被重設；`workers=1` |
| K7 | **依賴核准反覆中斷**：shadcn 每加元件拉進套件、seed／CLI 需要 `supabase`、date-fns、zod | 本文件第 5 節一次列齊（含預計 shadcn 元件清單）；任務只用清單內元件，需新元件時併入下一次回報一次問完 |
| K8 | **guard 漏呼叫**只靠人審 | T08 `guard-coverage.test.ts` 靜態掃描每個 page／actions／route；T03 `secrets-boundary` 擋金鑰外洩 |
| K9 | Tailwind v4 需 iOS ≥ 16.4（LINE 內建瀏覽器走系統 WebKit） | 驗收時用主管與新人中最舊的手機實測；若出現更舊裝置，當裝置問題提出並記 DECISIONS，不回退 v3 |

---

## 4. migrations 清單（表、索引、enum）與 seed 策略

### 4.1 總則

| 項目 | 決定 |
|---|---|
| 主鍵 | 所有表 `id uuid primary key default gen_random_uuid()`；`settings` 例外，`key text primary key` |
| 時間欄位 | 一律 `timestamptz`；`created_at not null default now()`；只有 `submissions`、`settings` 有 `updated_at`（§5），由 DB trigger 維護（4.6） |
| 日期欄位 | `log_date`、`week_start`、`start_date`、`due_date` 為 `date`，語意是台北日期，由應用層用 `lib/time` 算好再寫入 |
| enum | Postgres enum type；只能 `add value` 不能移除，與「欄位可加不可刪」一致；未來加值要獨立一個 migration（`alter type … add value` 新值不能在同一交易內使用） |
| FK 刪除策略 | 預設 `restrict`；例外：`profiles.id → auth.users` `cascade`（Supabase 慣例）、`alerts.submission_id`、`milestones.user_id` `cascade`、可空參照欄（`manager_id`、`closed_by`、`deleted_by`、`published_by`、`interviewer_id`、`updated_by`）`set null`；`alerts.response_submission_id` 雖可空仍用 `restrict`（與其他 submissions 參照一致；`set null` 會撞 `responded` 列的 check，效果等同 restrict 但錯誤訊息誤導）；`form_templates(active_version_id, id)` 複合 FK 用 `on delete set null (active_version_id)`（PG 15+ 欄位清單語法，4.3） |
| jsonb 形狀 | DB 只用 `jsonb_typeof` 檢查最外層；內部結構由 `lib/forms/schema.ts`（zod）與 `lib/rules/settings.ts`（T11）在應用層驗證 |
| 命名 | snake_case；constraint／index `<table>_<cols>_<pkey/key/fkey/chk/idx>` |
| Phase 1 不建 | `notification_log`（Phase 3）；任何 §5 以外的表 |

### 4.2 enum 清單

| enum | 值 | 用於 |
|---|---|---|
| `user_role` | `newcomer`, `manager`, `hr`, `ceo`, `admin` | `profiles.role` |
| `profile_status` | `active`, `left`, `sample` | `profiles.status` |
| `form_target_role` | `newcomer`, `manager` | `form_templates.target_role` |
| `form_version_status` | `draft`, `published`, `archived` | `form_versions.status` |
| `submission_source` | `app`, `import` | `submissions.source` |
| `alert_status` | `open`, `responded`, `closed` | `alerts.status` |
| `milestone_kind` | `D30`, `D60`, `D90` | `milestones.kind` |
| `milestone_outcome` | `continue`, `watch`, `adjust`, `end` | `milestones.outcome` |

`submissions.template_key`、`alerts.rule_key`、`audit_log.action／entity` 依 §5 維持 `text`。

### 4.3 逐表定義

#### departments

| 欄位 | 型別 | null | 預設／限制 |
|---|---|---|---|
| `id` | uuid | no | PK |
| `name` | text | no | `unique`；`check (length(btrim(name)) > 0)` |
| `sort_order` | int | no | `default 0` |

#### profiles

| 欄位 | 型別 | null | 預設／限制 |
|---|---|---|---|
| `id` | uuid | no | PK；FK `auth.users(id) on delete cascade` |
| `username` | text | no | `unique`；`check (username ~ '^[a-z0-9][a-z0-9_.-]{1,31}$')`（`{username}@pure.internal` 的 local part，強制小寫） |
| `display_name` | text | no | `check (length(btrim(display_name)) > 0)` |
| `role` | `user_role` | no | — |
| `department_id` | uuid | yes | FK `departments(id) on delete restrict` |
| `manager_id` | uuid | yes | FK `profiles(id) on delete set null`；`check (manager_id <> id)` |
| `start_date` | date | yes | —（依 §5 `date null`，不加 check：新人可暫無到職日，A09 顯示「尚未設定到職日」、T05 `dayNumber(null) → null`；Phase 2 `/admin/users` 新增新人的 Server Action 以 zod 要求必填，屬應用層） |
| `status` | `profile_status` | no | `default 'active'` |
| `must_change_password` | boolean | no | `default true` |
| `line_user_id` | text | yes | — |
| `created_at` | timestamptz | no | `default now()` |

索引：`profiles_username_key`、`profiles_department_id_idx`、`profiles_manager_id_idx`、`profiles_role_status_idx (role, status)`。

#### form_templates

| 欄位 | 型別 | null | 預設／限制 |
|---|---|---|---|
| `id` | uuid | no | PK |
| `key` | text | no | `unique`；`check (key ~ '^[a-z][a-z0-9_]*$')` |
| `name` | text | no | — |
| `description` | text | yes | — |
| `target_role` | `form_target_role` | no | — |
| `active_version_id` | uuid | yes | 複合 FK `(active_version_id, id) → form_versions(id, template_id) on delete set null (active_version_id)`（保證 active 版本屬同一 template；`set null` 必須帶欄位清單——PG 15+ 語法，Supabase 支援——否則 Postgres 會把參照欄全部設 null，含 PK `id`，刪除被指向的版本時以 not-null violation 失敗） |
| `created_at` | timestamptz | no | `default now()` |

「active 版本必須是 published」由發布 Server Action 在同一交易內保證。

#### form_versions

| 欄位 | 型別 | null | 預設／限制 |
|---|---|---|---|
| `id` | uuid | no | PK |
| `template_id` | uuid | no | FK `form_templates(id) on delete restrict` |
| `version_no` | int | no | `check (version_no > 0)` |
| `status` | `form_version_status` | no | `default 'draft'` |
| `questions` | jsonb | no | `default '[]'`；`check (jsonb_typeof(questions) = 'array')` |
| `change_note` | text | yes | — |
| `published_at` | timestamptz | yes | `check (status = 'draft' or published_at is not null)` |
| `published_by` | uuid | yes | FK `profiles(id) on delete set null` |
| `created_at` | timestamptz | no | `default now()` |

- `unique (template_id, version_no)`；`unique (id, template_id)`（供複合 FK）。
- 「同一 template 最多一個 draft、一個 published」：

```sql
create unique index form_versions_one_draft_idx
  on public.form_versions (template_id) where status = 'draft';
create unique index form_versions_one_published_idx
  on public.form_versions (template_id) where status = 'published';
```

- partial unique index 不能 deferrable，發布交易語句順序固定：(1) 舊 published → archived，(2) draft → published，(3) `active_version_id` 指向新版。

#### submissions

| 欄位 | 型別 | null | 預設／限制 |
|---|---|---|---|
| `id` | uuid | no | PK |
| `template_key` | text | no | FK `form_templates(key) on delete restrict` |
| `form_version_id` | uuid | no | FK `form_versions(id) on delete restrict` |
| `user_id` | uuid | no | FK `profiles(id) on delete restrict`（填寫者） |
| `target_user_id` | uuid | yes | FK `profiles(id) on delete restrict` |
| `target_submission_id` | uuid | yes | FK `submissions(id) on delete restrict` |
| `log_date` | date | yes | — |
| `week_start` | date | yes | `check (week_start is null or extract(isodow from week_start) = 1)` |
| `answers` | jsonb | no | `default '{}'`；`check (jsonb_typeof(answers) = 'object')` |
| `source` | `submission_source` | no | `default 'app'` |
| `submitted_at` | timestamptz | no | `default now()`（最初提交，重提不改） |
| `updated_at` | timestamptz | no | `default now()`；trigger |
| `deleted_at` | timestamptz | yes | — |
| `deleted_by` | uuid | yes | FK `profiles(id) on delete set null` |
| `delete_reason` | text | yes | `check (deleted_at is null or delete_reason is not null)` |

- 依範本的欄位形狀 check：

```sql
constraint submissions_shape_chk check (
  case template_key
    when 'newcomer_daily'   then log_date is not null and target_user_id is null
                                 and target_submission_id is null and week_start is null
    when 'manager_response' then target_user_id is not null and target_submission_id is not null
                                 and log_date is null and week_start is null
    when 'weekly_feedback'  then target_user_id is not null and week_start is not null
                                 and target_submission_id is null and log_date is null
    else true
  end)
```

- 索引：

| 名稱 | 定義 | 用途 |
|---|---|---|
| `submissions_daily_user_date_uidx` | `unique (template_key, user_id, log_date) where template_key='newcomer_daily' and deleted_at is null` | §5；也服務「昨日計畫」查詢 |
| `submissions_weekly_uidx` | `unique (template_key, user_id, target_user_id, week_start) where template_key='weekly_feedback' and deleted_at is null` | §5 |
| `submissions_daily_date_idx` | `(log_date, user_id) where template_key='newcomer_daily' and deleted_at is null` | 今日交件、缺交名單 |
| `submissions_target_submission_idx` | `(target_submission_id) where target_submission_id is not null` | 找某日誌的回應 |
| `submissions_target_user_idx` | `(target_user_id, submitted_at desc) where target_user_id is not null` | /me/history |
| `submissions_form_version_idx` | `(form_version_id)` | FK 查詢 |

- 軟刪對 alerts 的連鎖不在 DB 做（A05；Phase 2 Server Action）。

#### alerts

| 欄位 | 型別 | null | 預設／限制 |
|---|---|---|---|
| `id` | uuid | no | PK |
| `submission_id` | uuid | no | FK `submissions(id) on delete cascade` |
| `user_id` | uuid | no | FK `profiles(id) on delete restrict`（新人；反正規化，查詢仍須 join submissions，A05） |
| `rule_key` | text | no | `check (rule_key ~ '^[A-Z][0-9]+$')` |
| `detail` | jsonb | no | `default '{}'`；`check (jsonb_typeof(detail) = 'object')` |
| `status` | `alert_status` | no | `default 'open'` |
| `created_at` | timestamptz | no | `default now()`（應用層寫入＝日誌 `submitted_at`） |
| `responded_at` | timestamptz | yes | `check (status <> 'responded' or (responded_at is not null and response_submission_id is not null))` |
| `response_submission_id` | uuid | yes | FK `submissions(id) on delete restrict`（`set null` 會使 `responded` 列違反上列 check，4.1） |
| `closed_at` | timestamptz | yes | `check (status <> 'closed' or closed_at is not null)` |
| `closed_by` | uuid | yes | FK `profiles(id) on delete set null`（系統關閉為 null） |
| `closed_reason` | text | yes | — |

- `unique (submission_id, rule_key)`；索引 `alerts_user_created_idx (user_id, created_at desc)`、`alerts_open_idx (created_at) where status='open'`。
- `detail` 形狀：R1 `{ items: [{ i, plan_text, status, reason }] }`；R2 `{ text }`。

#### milestones

| 欄位 | 型別 | null | 預設／限制 |
|---|---|---|---|
| `id` | uuid | no | PK |
| `user_id` | uuid | no | FK `profiles(id) on delete cascade` |
| `kind` | `milestone_kind` | no | — |
| `due_date` | date | no | — |
| `done_at` | timestamptz | yes | — |
| `interviewer_id` | uuid | yes | FK `profiles(id) on delete set null` |
| `notes` | text | yes | — |
| `outcome` | `milestone_outcome` | yes | — |

- `unique (user_id, kind)`（自動建立 upsert 的 conflict target）；`milestones_due_idx (due_date) where done_at is null`。

#### settings

| 欄位 | 型別 | null | 預設／限制 |
|---|---|---|---|
| `key` | text | no | PK |
| `value` | jsonb | no | — |
| `updated_at` | timestamptz | no | `default now()`；trigger |
| `updated_by` | uuid | yes | FK `profiles(id) on delete set null` |

#### audit_log

| 欄位 | 型別 | null | 預設／限制 |
|---|---|---|---|
| `id` | uuid | no | PK |
| `actor_id` | uuid | no | FK `profiles(id) on delete restrict` |
| `action` | text | no | 例 `user.create`、`form.publish`、`submission.edit` |
| `entity` | text | no | 表名 |
| `entity_id` | text | no | — |
| `before` | jsonb | yes | — |
| `after` | jsonb | yes | — |
| `reason` | text | yes | — |
| `created_at` | timestamptz | no | `default now()` |

- 索引 `audit_log_created_idx`、`audit_log_actor_idx (actor_id, created_at desc)`、`audit_log_entity_idx (entity, entity_id)`；只 insert。

### 4.4 migration 檔案切分與順序

檔名 `supabase/migrations/<YYYYMMDDHHmmss>_<name>.sql`（時間戳以實際建立為準）。每張表的 RLS 與 revoke 寫在自己的檔案裡。

| 序 | 檔名 | 內容 | 依賴 |
|---|---|---|---|
| 1 | `…_helpers.sql` | `set_updated_at()`；`alter default privileges … revoke all on tables/sequences/functions from anon, authenticated` | — |
| 2 | `…_enums.sql` | 8 個 enum | — |
| 3 | `…_departments.sql` | 表、索引、RLS | 1 |
| 4 | `…_profiles.sql` | 表（含 `auth.users` FK、自參照）、check、索引、RLS | 2, 3 |
| 5 | `…_forms.sql` | `form_templates`（先不含 active FK）→ `form_versions` → `alter table` 補複合 FK；partial unique；RLS | 2, 4 |
| 6 | `…_submissions.sql` | 表、shape check、partial unique、索引、trigger、RLS | 4, 5 |
| 7 | `…_alerts.sql` | 表、unique、check、索引、RLS | 4, 6 |
| 8 | `…_milestones.sql` | 表、unique、索引、RLS | 2, 4 |
| 9 | `…_settings.sql` | 表、trigger、RLS（不塞資料，4.9） | 1, 4 |
| 10 | `…_audit_log.sql` | 表、索引、RLS | 4 |

循環 FK（檔 5）先建表後加 FK，不用 deferrable：

```sql
create table public.form_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  target_role public.form_target_role not null,
  active_version_id uuid,                -- FK 於下方補
  created_at timestamptz not null default now()
);
create table public.form_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.form_templates(id),
  -- ...其餘欄位
  unique (template_id, version_no),
  unique (id, template_id)
);
alter table public.form_templates
  add constraint form_templates_active_version_fkey
  foreign key (active_version_id, id)
  references public.form_versions (id, template_id)
  on delete set null (active_version_id);  -- PG 15+：只清 active_version_id，不動 PK id
```

### 4.5 RLS：enable 且對 anon／authenticated deny-all

| 層 | 寫法 | 效果 |
|---|---|---|
| RLS 開啟、零 policy | 每表 `enable row level security`，不建 policy | anon、authenticated 任何操作 0 列／被拒 |
| 撤銷現有 grant | 每表 `revoke all on table public.<t> from anon, authenticated` | 未來誤加 policy 也進不來 |
| 撤銷未來 grant（檔 1） | `alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated`（sequences、functions 同） | 之後新表與 RPC 不外露 |

- 不用 `force row level security`（`service_role` 具 `bypassrls`，force 只影響表擁有者）。
- 伺服器端唯一 DB client 在 `lib/db/admin.ts`（`server-only`）；瀏覽器只持 anon key 且只打 Auth 端點。授權全部在 `lib/auth/guard.ts`。
- 驗證：T03 `rls.spec.ts`（anon／authenticated 對九表皆 0 列或 42501）。

### 4.6 updated_at 維護：DB trigger

```sql
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger submissions_set_updated_at
  before update on public.submissions
  for each row when (old.* is distinct from new.*)
  execute function public.set_updated_at();
-- settings 同樣一個 trigger
```

`when (old.* is distinct from new.*)` 讓 seed 重跑時內容相同的 upsert 不推進 `updated_at`。

### 4.7 milestones 自動建立：應用層（不用 DB trigger）

| 方案 | 優點 | 缺點 |
|---|---|---|
| DB trigger（after insert on profiles） | 任何建帳號路徑都不會漏 | 邏輯藏在 DB，Vitest 測不到；`start_date` 改動要再加 update trigger；trigger 產生的列沒有 audit；與 §3「Server Actions 處理所有寫入」的架構相違（見本表比較） |
| **應用層（選這個）** | 純函式 `lib/time/milestones.ts` → `milestonesFor(startDate)` 可用 §11 案例單元測試；建帳號 Server Action（Phase 2）與 seed（Phase 1）呼叫同一函式並在同一處寫 audit；`start_date` 修改時由 Server Action 明確決定只重算 `done_at is null` 者（A09） | 每條建立路徑都要記得呼叫 |

安全網：`unique (user_id, kind)`＋`upsert on conflict (user_id, kind) do update set due_date`。RUNBOOK 路徑 B（Supabase 後台手建）用 `pnpm db:seed --milestones-only` 為所有 `role='newcomer'` 且有 `start_date` 而缺節點者補齊（T29），不會漏。

### 4.8 settings 必備 key 的初始 jsonb

| key | value | 說明 |
|---|---|---|
| `daily_cutoff_time` | `"18:00"` | 台北 `HH:mm`；R3 用 |
| `response_threshold_hours` | `24` | A1 用 |
| `rules` | 見下 | R1／R2 參數與開關；R3／A1 只放 `enabled` |
| `workweek` | `"mon_fri"` | 第 4 個 key（§7「六日制」、§9 工作日制）；可選 `"mon_sat"` |

```json
{
  "R1": { "enabled": true, "params": { "expect_done": "完成", "status_done": ["完成", "昨日無此項"] } },
  "R2": { "enabled": true, "params": { "unreported": "有，尚未回報" } },
  "R3": { "enabled": true },
  "A1": { "enabled": true }
}
```

預設參數值來自 `lib/rules/constants.ts`（A06，與指標字面值同源）。`lib/rules/settings.ts`（T11）用 zod 驗證 `rules` 形狀，非法時丟錯並列出原因；`settings` 缺列由 `getSettings()`（T06）丟錯「settings 未初始化，請執行 seed --base」；兩者都不靜默補預設。

### 4.9 seed 策略

#### 4.9.1 檔案與單一來源

| 檔案 | 角色 |
|---|---|
| `supabase/seed/fixtures/base.ts` | `01_base`：departments、settings、三範本 v1 questions、`banson`／`hr`／`ceo`；純資料 `as const`，執行期只 `import type` |
| `supabase/seed/fixtures/fixture.ts` | `02_fixture`：四主管、四新人、`e2e_fresh`、§11 8 筆日誌／2 筆回應／1 筆週回饋 |
| `supabase/seed/fixtures/expected.ts` | 預期 alerts、`CLOCK_*` 假時鐘、預期指標（單元測試與 `seed --verify` 共用） |
| `supabase/seed/seed.ts` | 執行腳本（service role）：`--base`（只跑 base；production 也跑）、預設完整模式（base＋fixture；只准 staging／本機／CI）、`--verify`、`--anchor`、`--milestones-only`、`--reset-passwords`（重設示範帳號密碼；預設不動） |
| `supabase/config.toml` | `[db.seed] enabled = false` |

- migration 只放 schema，不塞資料列；production 啟用順序＝`supabase db push` → `pnpm db:seed --base`（Phase 3 CUTOVER 決定是否載 fixture）。
- 執行：`tsx --conditions=react-server --env-file=.env.local supabase/seed/seed.ts`（＝`pnpm db:seed`，5.1／5.9）。不用 Node 原生 type stripping：它不解析 tsconfig `@/*` alias、ESM 匯入須帶 `.ts` 副檔名，seed 走 `runRules＋applyAlertChanges` 會碰到 `lib/**` 內以 `@/` 匯入的模組；`--conditions=react-server` 讓 `lib/db/admin.ts`、`lib/db/queries/*` 的 `import 'server-only'` 解析到該套件的 `react-server` export（空模組），純 Node 下不 throw。

#### 4.9.2 可重跑（idempotent）

| 表 | conflict target | 作法 |
|---|---|---|
| `settings` | `key` | upsert |
| `departments` | `id`（固定 UUID） | upsert；`name` unique 為第二道保險 |
| `profiles` | `id`（＝auth user id） | upsert；示範帳號 `must_change_password=false`，`e2e_fresh` 重設為 true（A01） |
| `form_templates` | `id` | upsert（`active_version_id` 暫 null）→ upsert versions → update `active_version_id` |
| `form_versions` | `id` | upsert；v1 `published`、`published_at='2026-09-01T00:00:00+08:00'`、`published_by=null`、`change_note='初版'` |
| `submissions` | 自然鍵（`(template_key, user_id, log_date)`／`(template_key, user_id, target_user_id, week_start)`／回應以 `(user_id, target_submission_id)`） | 查找後 insert／update；`updated_at＝submitted_at` |
| `alerts` | `(submission_id, rule_key)` | 由 `runRules＋applyAlertChanges(now=submitted_at)` 產生（與 app 同一路徑），再依 §11 設定 responded；與 `expected.ts` 比對 |
| `milestones` | `(user_id, kind)` | `milestonesFor(start_date)` upsert |

- 固定 UUID 規則：`0000000T-0000-4000-8000-0000000000NN`（T＝表代號，NN＝流水號）。
- 順序：settings → departments → auth users＋profiles → forms → submissions（依 log_date）→ alerts → responses → weekly → milestones。
- 防呆：`SEED_ALLOWED_PROJECT_REF` 與 `NEXT_PUBLIC_SUPABASE_URL` 的 ref 不符即中止；完整模式拒絕 `NODE_ENV=production`；`--anchor` 在 `CI=true` 時拒絕。
- 重跑不刪任何列；若自然鍵撞到人工建立的列，印出衝突並中止，不自動刪。

#### 4.9.3 Supabase Auth 使用者建立

| 方案 | 優點 | 缺點 |
|---|---|---|
| SQL 直插 `auth.users` | 純 SQL | 要自填 `encrypted_password`、`auth.identities` 等，GoTrue schema 隨版本變動、官方不支援 |
| **TS 腳本以 service role 呼叫 `auth.admin` API（選這個）** | 官方支援；雜湊、identities、確認狀態由 GoTrue 處理；同一支腳本接著寫 profiles | 需要 `SUPABASE_SERVICE_ROLE_KEY` 與網路 |

流程：`getUserById(fixedId)` 存在 → 示範帳號不動密碼（除非 `--reset-passwords`），`e2e_fresh` 一律 `updateUserById` 重設；不存在 → `createUser({ id, email: '<username>@pure.internal', password: SEED_PASSWORD, email_confirm: true })`；email 已存在但 id 不同 → 中止並印出處理方式。角色只存 `profiles.role`，不寫 `app_metadata`。

#### 4.9.4 seed 內容（§11）

departments（`sort_order` 1–4）：工務、採購、設計、信義設計。

profiles：

| username | display_name | role | department | manager | start_date | must_change_password | 來源 |
|---|---|---|---|---|---|---|---|
| `banson` | Banson | admin | — | — | — | false | base |
| `hr` | HR | hr | — | — | — | false | base |
| `ceo` | CEO | ceo | — | — | — | false | base（A03） |
| `mgr_construction` | 工務主任 | manager | 工務 | — | — | false | fixture |
| `mgr_procurement` | 採購主管 | manager | 採購 | — | — | false | fixture |
| `mgr_design` | 設計副主任 | manager | 設計 | — | — | false | fixture |
| `mgr_xinyi` | 信義總監 | manager | 信義設計 | — | — | false | fixture |
| `darren` | Darren | newcomer | 工務 | `mgr_construction` | 2026-09-01 | false | fixture |
| `yen_yaling` | 嚴雅齡 | newcomer | 採購 | `mgr_procurement` | 2026-09-01 | false | fixture |
| `hsieh_wenhsin` | 謝文心 | newcomer | 設計 | `mgr_design` | 2026-09-01 | false | fixture |
| `hung_hsiangting` | 洪湘庭 | newcomer | 信義設計 | `mgr_xinyi` | 2026-09-01 | false | fixture |
| `e2e_fresh` | 測試新人 | newcomer | 工務 | `mgr_construction` | 2026-09-01 | **true** | fixture（A01／A02；**`status='sample'`**：可登入但不進 `activeNewcomers()`，不寫日誌；staging 與 e2e 的今日交件仍為 4/4、工務主任卡片只有 Darren，與單元測試一致） |

四位新人 `status='active'`；`e2e_fresh` `status='sample'`（A02）。

form_templates＋v1：

| key | name | target_role | v1 題數 | 備註 |
|---|---|---|---|---|
| `newcomer_daily` | 新人每日日誌 | newcomer | 19 | §11 第 2–20 題，`order` 1–19；未指定 required 者 false；`disabled=false` |
| `manager_response` | 主管回應 | manager | 2 | `status`（required）、`comment` |
| `weekly_feedback` | 週回饋 | manager | 4 | `week_start`（date, required）、`good`、`improve`、`next_focus`（皆 required） |

submissions（11 筆；台北 → UTC）：

| 流水 | template_key | user | target | 對象日誌 | log_date／week_start | 台北 | `submitted_at` UTC |
|---|---|---|---|---|---|---|---|
| 01 | newcomer_daily | darren | — | — | 2026-09-02 | 9/2 17:05 | `2026-09-02T09:05:00Z` |
| 02 | newcomer_daily | yen_yaling | — | — | 2026-09-02 | 9/2 17:12 | `2026-09-02T09:12:00Z` |
| 03 | newcomer_daily | hsieh_wenhsin | — | — | 2026-09-02 | 9/2 17:20 | `2026-09-02T09:20:00Z` |
| 04 | newcomer_daily | hung_hsiangting | — | — | 2026-09-02 | 9/2 17:30 | `2026-09-02T09:30:00Z` |
| 05 | newcomer_daily | darren | — | — | 2026-09-03 | 9/3 17:01 | `2026-09-03T09:01:00Z` |
| 06 | newcomer_daily | yen_yaling | — | — | 2026-09-03 | 9/3 17:03 | `2026-09-03T09:03:00Z` |
| 07 | newcomer_daily | hung_hsiangting | — | — | 2026-09-03 | 9/3 17:06 | `2026-09-03T09:06:00Z` |
| 08 | newcomer_daily | hsieh_wenhsin | — | — | 2026-09-03 | 9/3 17:23 | `2026-09-03T09:23:00Z` |
| 09 | manager_response | mgr_procurement | yen_yaling | 06 | — | 9/4 09:10 | `2026-09-04T01:10:00Z` |
| 10 | manager_response | mgr_construction | darren | 05 | — | 9/4 09:20 | `2026-09-04T01:20:00Z` |
| 11 | weekly_feedback | mgr_construction | darren | — | week_start 2026-08-31 | 9/4 17:00 | `2026-09-04T09:00:00Z` |

- fixture 時間以 `+08:00` ISO 書寫；`answers` 依 v1 key；show_if 不成立的題存 `null`（A11）。§11 未寫明的必填答案以 `// assumed` 標記：9/2 四筆結算三項皆「昨日無此項」、`blocker='沒有'`、`support='不需要'`；`top` 未指定者「項目一」；`blocker_detail` 於嚴雅齡 9/3 存 null。
- 週回饋同時寫欄位 `week_start` 與 `answers.week_start`。

alerts（由規則產生，與 `expected.ts` 比對）：

| 流水 | submission | rule_key | status | created_at UTC | responded_at UTC | response_submission | detail |
|---|---|---|---|---|---|---|---|
| 01 | 06（嚴雅齡 9/3） | R1 | responded | `2026-09-03T09:03:00Z` | `2026-09-04T01:10:00Z` | 09 | `{ items: [{i:1, plan_text:"請款總表移到新表單", status:"持續中", reason:"案件利潤表工項明細不確定，已問 Patty"}, {i:3, plan_text:"鋁門窗宏偉報價", status:"持續中", reason:"宏偉訂金確認中"}] }` |
| 02 | 07（洪湘庭 9/3） | R2 | open | `2026-09-03T09:06:00Z` | — | — | `{ text: "Luma 免費版有次數限制，只做了 3 張圖" }` |

- 01 的 `responded_at − created_at`＝16h07m ≈ 16.1h（非 late）；02 在 9/4 18:00 已 24h54m → 逾時未回，12:00 → 18h54m → 待回應。流水 10（Darren 的回應）不掛 alert，不進誤報率分母。

milestones（15 筆）：四位新人各 D30 `2026-10-01`、D60 `2026-10-31`、D90 `2026-11-30`（12 筆）；`e2e_fresh` 另 3 筆（隨 fixture 一併載入 staging 與 CI；因 `status='sample'` 不進節點到期清單）。

#### 4.9.5 假時鐘與預期指標（`expected.ts`）

| 名稱 | 台北 | UTC | 用於 |
|---|---|---|---|
| `CLOCK_0903_1800` | 9/3 18:00 | `2026-09-03T10:00:00Z` | 一行摘要 `4/4 已交｜預警 2 筆｜待主管回應：2` |
| `CLOCK_0904_1200` | 9/4 12:00 | `2026-09-04T04:00:00Z` | R3 皆未到時；A1 待回應 |
| `CLOCK_0904_1800` | 9/4 18:00 | `2026-09-04T10:00:00Z` | A1 洪湘庭逾時；誤報率 0/1、回應率 1/2 |
| `CLOCK_0904_1830` | 9/4 18:30 | `2026-09-04T10:30:00Z` | R3 四人皆缺交 |

#### 4.9.6 `--anchor` 日期平移（示範用，K5）

- `pnpm db:seed --anchor 2026-09-16`：fixture 中「9/3」對映到 anchor，所有 `start_date`、`log_date`、`submitted_at`、`due_date` 等距平移；`week_start` 以 `weekStartMonday` 重算；alerts 由規則重新產生故一致。
- 只准非 CI、非 production；單元測試永遠用固定日期；RUNBOOK 規定驗收前一天執行，anchor 取上一個工作日。

#### 4.9.7 Vitest fixture 與 seed 共用

| 測試檔 | 讀取 | 斷言 |
|---|---|---|
| `tests/unit/rules.test.ts` | `fixture.ts` 日誌、`base.ts` settings、`expected.ts` | 每筆日誌 `runRules(log, prev, settings)` 深等於預期（9/2 四筆為空） |
| `tests/unit/derived.test.ts` | profiles、日誌、預期 alerts、`CLOCK_*` | R3、A1、late、HR 介入清單 |
| `tests/unit/metrics.test.ts`、`dashboard.test.ts`、`summary.test.ts` | 同上＋回應、預期指標 | 三指標、部門統計、總覽、儀表板、一行摘要 |
| `tests/unit/forms-*.test.ts` | v1 questions、日誌 | 發布驗證通過；answers key ⊆ 版本 keys；show_if／slot 讀取；跨版本 |
| `tests/unit/milestones.test.ts` | profiles | `milestonesFor('2026-09-01')` |

- 測試以 tsconfig alias（`@seed/*`）匯入，不打 DB；fixture 以 username／流水號為自然鍵，seed 執行期換 UUID。

### 4.10 本節假設與待裁決（與第 2 節對應）

| # | 項目 | 處理 |
|---|---|---|
| 1 | 4.3 加了 §5 未明寫的 check／FK（`template_key` FK、shape check、`week_start` 週一、`username` 格式、alerts 狀態一致性、`milestones unique(user_id, kind)`、form_versions 兩個 partial unique）；**不對** newcomer 的 `start_date` 加 check（保留 §5 `date null`，A09／T05 處理 null；Phase 2 `/admin/users` 新增新人的 Server Action 以 zod 要求必填，屬應用層） | 不新增或刪除欄位，視為 §5 的具體化；核准 PLAN 即視為核准，否則指名移除 |
| 2 | `settings` 第 4 個 key `workweek` | §7／§9 已提六日制；名稱可改 |
| 3 | 發布、提交日誌＋預警、回應＋更新 alerts 的原子性；supabase-js 無交易 | Phase 1 以「讀取—比對—寫入」順序＋唯一鍵保證（A10）；Phase 2 發布流程若需 RPC 再追加 `…_rpc_<name>.sql` |
| 4 | §10「標註 on_behalf」在 §5 無欄位 | Phase 1 由回應者 role 推導顯示，不加欄位；Phase 2 若需篩選再以追加 migration 加欄位（可加不可刪） |
| 5 | 新增環境變數 `SEED_PASSWORD`、`SEED_ALLOWED_PROJECT_REF` | A03；列入 `.env.example`，與本文件第 5 節一併核准 |
| 6 | seed 新人 `status='active'`、`e2e_fresh` `status='sample'`（可登入、不進母體）、`ceo` 帳號、示範帳號 `must_change_password=false` | A01／A02／A03 |

---

## 5. 打算安裝的 npm 依賴清單與理由（等核准才安裝）

> 狀態：等「核准 Phase 1」後才安裝。本節是 Phase 1 依賴白名單（§0）：表外套件一律先問。版本欄是 2026-09-03 的參考區間，安裝前用 `pnpm view <pkg> version` 核對，安裝後把 lockfile 實際版本回填「實際安裝」欄。

### 5.1 執行環境與套件管理器

| 項目 | 決定 | 理由 |
|---|---|---|
| Node | 22 LTS；`.nvmrc`＝`22`；`engines.node`＝`>=22.18.0 <23` | 本機 v22.22.2；Vercel 支援 22.x；`--env-file` 由 Node 提供，不裝 `dotenv`；上限 `<23` 讓本機、CI、Vercel 同 runtime |
| seed 執行器 | `tsx`（devDependency，5.4）；`db:seed`＝`tsx --conditions=react-server --env-file=.env.local supabase/seed/seed.ts` | 不用 Node 原生 type stripping：它不解析 tsconfig `@/*` alias、ESM 匯入須帶 `.ts` 副檔名，seed 匯入 `lib/rules/run.ts`、`lib/db/queries/alerts.ts` 等以 `@/` 匯入的模組會找不到檔案；`tsx` 讀 tsconfig paths，並把 Node 旗標（`--conditions`、`--env-file`）原樣傳給 Node。`--conditions=react-server` 使 `server-only` 解析到其 `react-server` export（空模組），seed 才能 import `lib/db/admin.ts`／`lib/db/queries/*` 而不 throw（T04 第一次執行即驗證）；seed 的匯入鏈（`lib/db`、`lib/rules`、`lib/forms`、`lib/time`）不含 `react`，此條件不影響其他套件。Playwright 的 `tests/e2e/global-setup.ts` 無此條件，自建 service role client（T03 白名單） |
| 套件管理器 | pnpm 10；`"packageManager": "pnpm@10.33.0"` | 嚴格 node_modules 抓幽靈依賴，是「不得新增未列出依賴」的機械保障；CI 與 Vercel 用 `pnpm install --frozen-lockfile` |
| pnpm build scripts 白名單 | `pnpm.onlyBuiltDependencies`：`supabase`、`esbuild`（`tsx`／`vitest` 帶入）、`@tailwindcss/oxide`、`unrs-resolver`（`eslint-config-next` → `eslint-import-resolver-typescript` 帶入） | pnpm 10 預設不跑 postinstall；`supabase` CLI 靠 postinstall 下載執行檔。不列 `sharp`：5.3／5.4 沒有套件帶入它（Next 15 不再強制安裝），Vercel 建置時由 Next 自動安裝，本機不裝 |
| 骨架指令 | `pnpm dlx create-next-app@15`（TS、Tailwind、ESLint、App Router、alias `@/*`、不用 `src/`）；`pnpm dlx shadcn@3 init` | CLI 鎖主版號；不用 `src/` 因 §12 以 repo 根目錄為準 |
| GitHub Actions | `actions/checkout@v5`、`pnpm/action-setup@v4`、`actions/setup-node@v4`（`node-version-file: .nvmrc`、`cache: pnpm`）；`supabase/setup-cli@v1`；瀏覽器 `pnpm exec playwright install --with-deps chromium` | 五個 job：lint、typecheck、unit（三 TZ 矩陣）、db、e2e；CI 資料庫為本機堆疊（A01），staging 金鑰不進 CI |

### 5.2 關鍵決定

| 議題 | 決定 | 硬理由；放棄的選項 |
|---|---|---|
| Tailwind v3 或 v4 | **v4**：`tailwindcss@^4`＋`@tailwindcss/postcss`；設定在 `app/globals.css` 的 `@theme`，無 `tailwind.config.ts`、`autoprefixer` | shadcn CLI 3 與 create-next-app 15.5 預設就是 v4，選 v3 要走 legacy 路徑；少兩個檔、少兩個依賴。限制：需 Safari 16.4+／Chrome 111+（iOS ≥ 16.4）；驗收用最舊的手機實測（風險 K9） |
| Supabase client 分工 | **兩個 client、兩個檔案**：`lib/db/admin.ts`＝service role（`server-only`）負責全部業務讀寫；`lib/auth/session.ts`＝`@supabase/ssr` cookie client 只做登入／登出／取使用者／改密碼 | §3 deny-all：cookie client 查資料得到的是「空陣列」而非錯誤，最難抓；分檔＋`server-only`＋T03 靜態測試讓混用在 build／CI 被擋 |
| 表單與設定驗證 | **`zod@^4`**；`lib/forms/schema.ts` 定義 `Question`／`ShowIf`／`Slot`，`z.infer` 匯出型別；`validatePublish` 用 `superRefine` | `questions`、`answers`、`settings.rules` 皆 jsonb，`gen types` 只給 `Json`，執行期必須驗形狀；§6 發布驗證是「schema＋跨欄位檢查」，Phase 1 讀取與 Phase 2 發布共用；Server Action 的 `FormData` 需逐欄繁中錯誤。放棄手寫：§6 規則多、Phase 2 還會加 |
| 台北時區工具 | **`date-fns@^4`＋`@date-fns/tz@^1`**；`lib/time` 集中，一律接收 `now: Date`，時區名稱來自 `APP_TIMEZONE`（§4） | 需要：timestamptz→台北日期、cutoff instant、工作日數（五日／六日制）、週一、D30/60/90、顯示格式；`TZDate` 尊重 `APP_TIMEZONE`，`eachDayOfInterval`／`startOfWeek({weekStartsOn:1})`／`addDays` 各一行。放棄只用 Intl：工作日與週起算要自己寫迴圈、且等於忽略 `APP_TIMEZONE`；放棄 Temporal polyfill：Node 22 無原生 Temporal |
| 表單狀態管理 | **不裝 `react-hook-form`**；渲染器用 `useState`＋`useActionState`，show_if／required 共用 `lib/forms` | 題目動態、判斷本來就在 `lib/forms` 給伺服器端用，RHF 是重複機器；shadcn `form` 一併不加 |
| CSV 產生 | **手寫** `lib/db/csv.ts`（約 20 行，Vitest 覆蓋逗號／引號／換行／null／BOM） | Phase 1 只有匯出；BOM＋CRLF 讓 Excel 繁中不亂碼；`papaparse` 等 Phase 2 匯入再評估 |
| 圖示 | `lucide-react`（shadcn init 帶入） | shadcn 元件內部 import，不裝編不過 |
| ESLint | `eslint@^9`（flat config）＋`eslint-config-next`（與 `next` 同 minor）；`lint`＝`eslint .` | Next 15.5 起 `next lint` 棄用；不裝 Prettier（不在 §3）；不裝 `@eslint/eslintrc`：`eslint-config-next@15.5` 直接輸出 flat config（`import next from 'eslint-config-next/core-web-vitals'`），不需 `FlatCompat`；若 create-next-app 骨架產生 FlatCompat 寫法，T01 改寫並記 DECISIONS |
| `date` 題型 UI | 原生 `<input type="date">`，不裝 `calendar`／`react-day-picker`／`popover` | 375px 與 LINE 內建瀏覽器上原生選擇器最可靠 |
| `single_select`／`user_select` UI | `radio-group` 做 ≥ 44px 可點列；`user_select` 用 Tailwind 樣式原生 `<select>`，不裝 shadcn `select` | 回應 20 秒內完成，選項攤開比下拉快；Radix popover select 在 in-app browser 有 focus／捲動問題 |
| 提示訊息 | 不裝 `sonner`／`toast` | 成功／錯誤做成頁面內 `alert`，in-app browser 更穩 |
| Supabase CLI | `supabase` 進 devDependencies（A01） | `db reset`／`db push`／`gen types`／CI 本機堆疊；版本跟 repo 走 |

### 5.3 dependencies（執行期）

| 套件 | 參考版本 | 用途 | 非要不可的理由 | 實際安裝 |
|---|---|---|---|---|
| `next` | `^15.5.0`（留 15.x） | 框架 | §3 | |
| `react`、`react-dom` | `^19.1.0` | Next 15 的 React | `useActionState` 是渲染器回傳欄位錯誤的機制 | |
| `@supabase/supabase-js` | `^2.50.0` | service role client、`auth.admin` | 唯一資料存取路徑（§3） | |
| `@supabase/ssr` | `^0.7.0` | cookie session client、`middleware.ts` | App Router cookie 讀寫與 session 刷新的官方做法 | |
| `server-only` | `^0.0.1` | `lib/db/admin.ts`、`lib/auth/guard.ts`、`lib/db/queries/*` | 誤 import 進 client component 時 build 直接失敗；純 Node 下 import 會 throw，seed 以 `--conditions=react-server` 解析到空模組（5.1），Playwright `global-setup.ts` 不 import 這些檔；Vitest 單元測試只 import 不含它的純函式模組（`lib/auth/policy.ts`、`lib/forms/submit.ts`、`lib/rules`、`lib/forms`、`lib/time`、`lib/metrics`），`vitest.config.ts` 不設 `resolve.conditions:['react-server']`——那會讓 `react` 解析到無 `useState`／`useActionState` 的 react-server 版本，T13 的 `renderToStaticMarkup` 測試反而壞掉 | |
| `zod` | `^4.0.0` | `lib/forms/schema.ts`、Server Action 輸入、`settings.rules` | 5.2 | |
| `date-fns` | `^4.1.0` | `lib/time` | 5.2 | |
| `@date-fns/tz` | `^1.2.0` | `lib/time`（`TZDate`） | 5.2；是官方 `@date-fns/tz`，不是舊的 `date-fns-tz` | |
| `lucide-react` | 0.x（shadcn 帶入） | 圖示 | 5.2 | |
| `radix-ui`（或 shadcn CLI 實際寫入的 `@radix-ui/react-*`） | `^1.4.0` | sheet、radio-group、label、Slot | shadcn 元件 import 目標 | |
| `class-variance-authority` | `^0.7.1` | button／badge variant | 同上 | |
| `clsx` | `^2.1.0` | `cn()` | 同上 | |
| `tailwind-merge` | `^3.0.0` | `cn()`（v3 才支援 Tailwind v4） | 同上 | |

### 5.4 devDependencies

| 套件 | 參考版本 | 用途 | 非要不可的理由 | 實際安裝 |
|---|---|---|---|---|
| `typescript` | `^5.9.0`（留 5.x） | typecheck（`tsc --noEmit`、`strict`） | §3 | |
| `@types/node` | `^22.0.0` | Node 型別 | typecheck | |
| `@types/react`、`@types/react-dom` | `^19.1.0` | React 19 型別 | typecheck | |
| `tailwindcss` | `^4.1.0` | 樣式 | §3 | |
| `@tailwindcss/postcss` | `^4.1.0` | `postcss.config.mjs` 唯一 plugin | 不另列 `postcss`／`autoprefixer` | |
| `tw-animate-css` | `^1.3.0` | shadcn v4 動畫（sheet 開合） | shadcn init 帶入 | |
| `eslint` | `^9.0.0` | lint | §3 | |
| `eslint-config-next` | `^15.5.0` | 規則 | §3 | |
| `vitest` | `^4.0.0` | 單元測試（`environment: node`、alias `@`／`@seed`、`include: tests/unit/**`、`esbuild.jsx='automatic'` 供 T13 渲染器測試；不設 `resolve.conditions`、不 alias `server-only`：單元測試對象一律是不含 `server-only` 的純函式模組——T08 `lib/auth/policy.ts`、T14／T18 `lib/forms/submit.ts`） | §3；不裝 jsdom／testing-library | |
| `@playwright/test` | `^1.55.0` | e2e（375×812、chromium） | §3 | |
| `tsx` | `^4.19.0` | `db:seed`（tsconfig paths、直接執行 TS、Node 旗標透傳） | 5.1：Node 原生 type stripping 不解析 `@/*`、ESM 需 `.ts` 副檔名；沒有 seed 就沒有 §11 資料與 §13 idempotent 驗證 | |
| `supabase` | `^2.20.0` | CLI：`start`、`db reset`、`db push`、`gen types` | A01；§13 從空庫驗證與 CI 本機堆疊 | |

### 5.5 Supabase client 用法（兩個檔案，職責固定）

```
lib/db/admin.ts       import 'server-only'
                      createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
                        { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
                      → 全部業務讀寫：lib/db/queries、Server Actions、Route Handlers、seed
                      （seed 經 tsx --conditions=react-server 執行，server-only 解析為空模組，5.1）。

lib/auth/session.ts   createServerClient<Database>(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
                        { cookies: { getAll, setAll }, cookieOptions: { maxAge: 60 * 60 * 24 * 30 } })
                      → 只做 signInWithPassword、getUser、updateUser({ password })、signOut。

middleware.ts         同 ssr client：刷新 session cookie、未登入導向 /login。不做角色判斷。

lib/auth/guard.ts     requireRole() / canAccessNewcomer()：
                      session 的 getUser() 取 id → admin client 讀 profiles（role、department_id、status、must_change_password）。

lib/auth/policy.ts    can() / canAccessNewcomer() / canRespond()：純函式，無 server-only、不 import lib/db；
                      guard.ts re-export 供呼叫端使用，T08 單元測試只 import 本檔。
```

規則：只有 `lib/auth/session.ts` 與 `middleware.ts` 可 import `@supabase/ssr`；只有 `lib/db/admin.ts` 可讀 `SUPABASE_SERVICE_ROLE_KEY`（T03 靜態測試；唯一例外 `tests/e2e/global-setup.ts`，Playwright 無 `react-server` 條件、不能 import 含 `server-only` 的檔，自建 client）；seed 不自建 client，import `lib/db/admin.ts`。身分驗證一律 `getUser()`。「Session 保持 30 天」由 cookie `maxAge`＋refresh token 實現，Pro 方案 time-box 不用（T09 驗證刷新、DECISIONS 記未實測項）。建帳號走 `auth.admin.createUser({ email: `${username}@pure.internal`, password, email_confirm: true })`。

### 5.6 shadcn/ui 元件清單（CLI 產生到 `components/ui`，非 npm 依賴）

`pnpm dlx shadcn@3 add button input textarea label radio-group card badge sheet table alert`

| 元件 | 用在 | 帶入套件 |
|---|---|---|
| `button` | 所有按鈕；主要按鈕 `data-primary` 且最小高 44px | `radix-ui`（Slot）、`class-variance-authority` |
| `input` | short_text／number／date、登入、改密碼 | — |
| `textarea` | long_text | — |
| `label` | 題目標籤 | `radix-ui`（Label） |
| `radio-group` | single_select | `radix-ui`（RadioGroup） |
| `card` | 卡片、儀表板區塊 | — |
| `badge` | 預警／缺交／late／階段 | `class-variance-authority` |
| `sheet` | 回應抽屜（`side="bottom"`） | `radix-ui`（Dialog） |
| `table` | 新人總覽、介入清單、節點到期 | — |
| `alert` | 成功／錯誤／提醒 | — |

不加入：`form`、`select`、`calendar`／`popover`、`toast`／`sonner`、`dialog`、`dropdown-menu`、`tabs`、`switch`、`checkbox`。

### 5.7 明確不裝（Phase 2／3 或不做）

| 套件 | Phase | 用途 | 現在不裝的理由 |
|---|---|---|---|
| `@dnd-kit/*` | 2 | 題目拖曳排序 | Phase 1 無後台 |
| `papaparse` | 2 | CSV 匯入 | 匯入在 Phase 2 |
| shadcn `dialog`、`select`、`switch`、`tabs`、`dropdown-menu`、`checkbox` | 2 | 後台 | 用不到 |
| `react-hook-form`、shadcn `form` | 2（條件） | 題目編輯抽屜 | 5.2 |
| `sonner` | 2（條件） | toast | 5.2 |
| `@line/bot-sdk` | 3 | LINE 推播 | Phase 3 |
| `@anthropic-ai/sdk` | 3 | D30 底稿 | Phase 3 |
| `dotenv` | — | seed 環境變數 | Node 22 `--env-file` 已涵蓋（`tsx` 改列 5.4 devDependencies，理由見 5.1） |
| `jsdom`、`@testing-library/react` | — | 元件單元測試 | 渲染器六型以 `react-dom/server` 的 `renderToStaticMarkup` 單元測試（T13），頁面接線由 Playwright 覆蓋 |
| `next-themes` | 永不 | 深色模式 | §3 不做 |
| `prettier` | — | 格式化 | 不在 §3 |

### 5.8 版本策略

- 全部 `^` 鎖主版本；不用 `latest`、`*`、tag、git URL；CLI 一次性執行也鎖主版號。
- 0.x 套件（`@supabase/ssr`、`lucide-react`、`class-variance-authority`）升 minor 一律開 PR 並更新本表。
- `next` 留 15.x（§3）；`eslint-config-next` 與 `next` 同 minor；`typescript` 留 5.x。
- `pnpm-lock.yaml` 進 git；CI 與 Vercel `--frozen-lockfile`。
- 每月 `pnpm outdated` 人工看；major 升級單獨 PR 記 DECISIONS。不裝 Dependabot／Renovate。

### 5.9 package.json 片段（供核准時對照）

```json
{
  "name": "pure-onboard",
  "private": true,
  "packageManager": "pnpm@10.33.0",
  "engines": { "node": ">=22.18.0 <23" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "db:types": "supabase gen types typescript --local --schema public > lib/db/types.ts",
    "db:reset": "supabase db reset",
    "db:push": "supabase db push",
    "db:seed": "tsx --conditions=react-server --env-file=.env.local supabase/seed/seed.ts"
  },
  "pnpm": {
    "onlyBuiltDependencies": ["supabase", "esbuild", "@tailwindcss/oxide", "unrs-resolver"]
  }
}
```

環境變數：§4 五個＋`SEED_PASSWORD`、`SEED_ALLOWED_PROJECT_REF`（A03；`.env.example` 佔位）。seed 帳號密碼一律來自 `SEED_PASSWORD`，Playwright 讀同一變數；示範新人 `status='active'`、`e2e_fresh` `status='sample'`（A02）。

---

## 6. CLAUDE.md 的矛盾或缺漏

每條在第 2 節都已列為「假設」（時程問題另列 2.1 Q1）。「原文證據」為 CLAUDE.md 原句摘錄。F 編號為對抗式驗證的原始編號，僅保留有結論者，故不連號。

| id | 類型 | 涉及節 | 原文證據 | 影響 | 建議處置 |
|---|---|---|---|---|---|
| F04 | 矛盾 | §3、§5、§11 | 「第一次登入強制改密碼。」「本機開發連 staging。」「Playwright（煙霧：四種角色各一條路徑）」；`must_change_password bool default true` | 煙霧測試每次登入被導到改密碼頁；e2e 改了密碼第二次跑登不進去；CI 打 staging 會污染 HR 驗收資料 | 已列為假設 **A01**（示範帳號旗標 false、`e2e_fresh` 專供改密碼 e2e、CI 用本機堆疊） |
| F14 | 缺漏 | §3、§5、§7、§8、§9、§11、§13 | `status enum[active,left,sample] default active`；「停用（status=left）」；R3「active 新人」 | `sample` 從未定義；`left` 能否登入未定；各清單與指標母體未定；示範新人跑進 production 未處理 | 已列為假設 **A02** |
| F16 | 缺漏 | §2、§3、§5、§8、§10、§11 | 「profiles：admin「Banson」；hr「HR」…」；「ceo：唯讀，全域」；C-3「用 CEO 帳號確認沒有任何按鈕」 | §11 只給顯示名稱、無 username／密碼、無 ceo 帳號；中文無法組成 `@pure.internal` email | 已列為假設 **A03** |
| F18 | 缺漏 | §5、§7、§8 | 「HR 介入清單（逾時未回、需 HR 協助）」；closed 原因只定義 `resubmitted` | 「需 HR 協助」沒有離開清單的事件，清單只增不減 | 已列為假設 **A04** |
| F22 | 缺漏 | §5、§6、§7、§8、§9 | 「編輯答案…軟刪除…還原；重跑該筆規則」；partial unique `where deleted_at is null` | 還原撞唯一鍵；被刪日誌的 alerts 仍 open；相鄰日誌 R1 前提改變未重跑 | 已列為假設 **A05**（主要 Phase 2；查詢原則 Phase 1 即適用） |
| F27 | 缺漏 | §6、§7、§8、§11 | 「誤報率 = response.status=='已讀，無需處理'…」「發布前驗證…啟用中的規則所需 slot」 | 改 manager_response 的選項文字會通過發布驗證但指標與 HR 清單靜默失效；非規則 slot 無唯一性 | 已列為假設 **A06** |
| F28 | 缺漏 | §6、§9 | Question 只有 `disabled: boolean`；後台「新增／編輯抽屜（…disabled）」只有停用沒有刪除 | 停用題是否占 slot、可否被 show_if 引用、是否驗證未定 | 已列為假設 **A07** |
| F32 | 缺漏 | §5、§7、§8 | 「近 7 日各部門統計、三指標、新人總覽」；「主管回應率 = 已回應預警 ÷ 全部預警」 | 統計期間、closed 是否計入、軟刪與 left 是否排除、「近 7 日」內容未定；與 Sheet 過渡版可能對不上 | 已列為假設 **A08** |
| F34 | 缺漏 | §2、§5、§8、§9 | 「頂部顯示第幾天、階段、下一節點日期」；「節點到期清單（未來 7 天）」；`start_date date null` | 「階段」「第幾天」「下一節點」未定義；逾期節點消失；start_date 空會顯示 NaN | 已列為假設 **A09** |
| F43 | 歧義 | §5、§7、§9 | 「upsert alerts…不再成立的 open 預警改 closed…已 responded 的保留」；`unique(submission_id, rule_key)`；A1「now − created_at」 | `created_at` 是否重置、detail 是否更新、closed 後再成立如何處理、`closed_by` 是誰未定 | 已列為假設 **A10** |
| F45 | 歧義 | §6、§7 | 「條件不成立時該題不顯示、不驗證、答案存空。」「非空」 | 「存空」形狀（null／''／缺 key）與 show_if 對 null 的真值表未定，`neq(null)` 會誤判 | 已列為假設 **A11** |
| F49 | 歧義 | §5、§6 | 「user_select：選項來自 profiles（依 role 過濾，`options` 存 'newcomer'\|'manager'）」；`options?: string[]` | options 形狀、答案存值、名單過濾範圍未定 | 已列為假設 **A12** |
| F57 | 歧義 | §4、§8 | 「`9/11 新人日誌｜4/4 已交｜預警 2 筆：A（進度）、B（卡點）｜待主管回應：X｜連結`」 | 連結指向、X 的範圍、「預警 N 筆」的範圍未定；Phase 3 推播沿用 | 已列為假設 **A13** |

---

## 附錄 A：Phase 1 不做的事（引用 Prompt 1 Forbidden Actions）

| 不做 | 依據 |
|---|---|
| 修改 `CLAUDE.md` | Prompt 1 Forbidden |
| 新增本文件第 5 節白名單以外的依賴 | Prompt 1 Forbidden；§0 |
| 建立 §5 以外的表（含 `notification_log`） | Prompt 1 Forbidden；§5 |
| 實作任何 `/admin` 頁面（名單、表單編輯、規則、資料、設定、稽核） | Prompt 1 Forbidden（Phase 2） |
| 接 LINE Messaging API 或 Anthropic API | Prompt 1 Forbidden（Phase 3） |
| push main；動 production（部署、migrations、seed） | Prompt 1 Forbidden；§0 |
| 節點紀錄表單（`/hr/newcomer/[id]` notes／outcome） | Prompt 1 Target 6「不含節點紀錄表單」（Phase 3） |
| 新增 §6 以外的題型或條件運算子；通用規則引擎；拖曳以外的表單佈局 | §3「不做」；Prompt 2 Forbidden |
| 多語系、深色模式、即時推播 | §3「不做」 |
| Vercel／Supabase 付費方案、任何會花錢的動作 | Prompt 1 Stop Conditions；§0 |

停止條件（遇到即停下回報）：§0 列出的任何情況；migrations 需偏離 §5；e2e 連續失敗兩次；Vercel 部署需要付費方案。

## 附錄 B：回報格式

每完成一個任務（T01–T30）或 Prompt 1 Target 1–9 任一項，輸出三行：

```
✅ 做了什麼：<任務 id>｜<一句話>｜<檔案>｜<測試結果>
⚠️ 風險或未決：<沒有 / 具體項目與需要誰決定>
⏭️ 下一步：<下一個任務 id 與預估時間>
```

全部完成後輸出：檔案變更總表、測試結果摘要（lint／typecheck／unit 三 TZ／db／e2e）、staging URL、四組測試帳號（密碼另行交付）。
