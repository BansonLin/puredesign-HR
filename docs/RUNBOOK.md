# RUNBOOK — HR 與 admin 操作手冊

> 適用範圍：**Phase 1**（`/login`、`/me`、`/manager`、`/hr`、`/ceo` 與 seed 指令）。`/admin` 後台、LINE 通知、節點紀錄表單與 AI 摘要都還沒有，請先看第 9 節「已知限制」再決定怎麼做。
>
> 本檔給 HR（日常管理者）與 admin（Banson、HR 主管）看。凡是要打指令的段落都寫成可以直接複製貼上的形式；凡是要動資料庫的段落都附 SQL。

| 節 | 內容 | 誰會用到 |
|---|---|---|
| 1 | Seed（示範資料）指令 | admin |
| 2 | 驗收前一天的準備 | admin |
| 3 | 登入與首次改密碼、忘記密碼 | 全員 |
| 4 | HR 每日：`/hr` 怎麼讀、一行摘要貼 LINE | HR |
| 5 | Phase 1 建帳號的兩條路 | HR、admin |
| 6 | 重設密碼、停用帳號 | HR、admin |
| 7 | 主管每天／每週的路徑；HR 代填 | HR、主管 |
| 8 | Supabase 與 Vercel 必要設定 | admin |
| 9 | 已知限制（Phase 2／Phase 3 才有的東西） | 全員 |

---

## 1. Seed（示範資料）指令

seed 由 `supabase/seed/seed.ts` 執行（`pnpm db:seed`），以 service role 寫入 Supabase，內容來自 `supabase/seed/fixtures/`（CLAUDE.md §11）。

### 1.1 前置：`.env.local`

| 變數 | 說明 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 目標專案網址。seed 會取其 `<ref>` 與 `SEED_ALLOWED_PROJECT_REF` 比對，不符即中止 |
| `SUPABASE_SERVICE_ROLE_KEY` | service role 金鑰（只能放 `.env.local`，不得進 git） |
| `SEED_PASSWORD` | 所有 seed 帳號的密碼；未設或空白時 seed 直接中止（`seed 中止：SEED_PASSWORD 未設定…`） |
| `SEED_ALLOWED_PROJECT_REF` | 准許 seed 的專案 ref；supabase CLI 本機堆疊填 `local`，staging 填該專案 ref |

`.env.local` 不存在時 seed 仍會執行（變數改由 shell／CI 提供），會印提示訊息。

### 1.2 指令一覽

| 指令 | 做什麼 | 准許環境 |
|---|---|---|
| `pnpm db:seed --base` | 只寫 base：departments、settings（含 `rules` 預設）、三張範本 v1、`banson`／`hr`／`ceo` 帳號 | 本機、staging、**production**（上線順序：`supabase db push` → `pnpm db:seed --base`） |
| `pnpm db:seed` | base ＋ fixture：四主管、四新人、`e2e_fresh`、milestones（15 筆）、§11 的 8 筆日誌、2 筆主管回應、1 筆週回饋，並由規則產生 2 筆預警 | 本機、staging、CI；`NODE_ENV=production` 時拒絕 |
| `pnpm db:seed --verify` | 連跑兩次（可與 `--base` 或完整模式並用）並比對各表筆數與不變量；base 預期 profiles 3、submissions 0、alerts 0；完整 submissions 11、alerts 2；任一不符即 exit 1 | 同所搭配的模式 |
| `pnpm db:seed --anchor YYYY-MM-DD` | 完整模式，並把 fixture 的「9/3」平移到指定日期（見 1.4） | 只准本機與 staging；`CI=true` 或搭配 `--base`／`--milestones-only` 時拒絕 |
| `pnpm db:seed --milestones-only` | 為所有「有到職日」的新人補齊缺少的 D30／D60／D90（既有列不動） | 本機、staging、production |
| `pnpm db:seed --reset-passwords` | 把所有 seed 帳號的密碼重設為 `SEED_PASSWORD`（預設不動既有密碼；`e2e_fresh` 每次都重設） | 與所搭配的模式相同 |

旗標可以並用，例如 `pnpm db:seed --anchor 2026-09-17 --verify`。不加旗標的 `pnpm db:seed` 會印用法說明以外的完整流程紀錄；打錯旗標時 seed 會印 `用法：pnpm db:seed [--base] …` 並 exit 1。

### 1.3 完整模式寫入什麼、重跑會怎樣

- 日誌走與 `/me/today` 完全相同的路徑：`prepareDailyLog` → 以自然鍵（新人、日期）查找後 insert／update → `applyAlertChanges`，預警由規則即時算出。寫完後 seed 會把資料庫裡的 alerts 與預期（`EXPECTED_ALERTS`）逐筆比對，不符即印出差異並 exit 1。
- 預期結果：嚴雅齡 9/3 一筆 R1（items 1、3），已由採購主管 9/4 09:10 回應 → `responded`；洪湘庭 9/3 一筆 R2 → `open`（9/4 18:00 起逾時未回、進 HR 介入清單）。
- **seed 從不刪任何列**。重跑時：既有的 seed 列以自然鍵找到後改寫成相同內容（實際上不變）；若自然鍵撞到非 seed 建立的列（同名部門、同帳號但不同 id、同一主管對同一日誌有 ≥2 筆回應），seed 會印出衝突並中止，請人工處理後再跑。
- 範本只「缺才插入」：staging 上若 HR 已發布 v2，重跑 seed 不會把 active 版退回 v1；fixture 日誌一律綁 v1。
- seed 帳號密碼：第一次建立時用 `SEED_PASSWORD`；之後重跑不改密碼（除非 `--reset-passwords`）。示範帳號不需首次改密碼，只有 `e2e_fresh` 每次重跑都會被重設密碼與 `must_change_password=true`，因此永遠會被導到改密碼頁。

### 1.4 `--anchor`：把示範資料平移到指定日期

fixture 的日期固定在 2026-09-01（到職）～09-04；`--anchor <日期>` 把「9/3」對映到該日期，其他日期等距平移：

| 欄位 | 平移方式 |
|---|---|
| `profiles.start_date`、`milestones.due_date` | 同天數平移 |
| `submissions.log_date`、`submitted_at` | 同天數平移（時刻不變，仍是台北 17:0x 交件、隔天 09:1x 回應） |
| `submissions.week_start`（週回饋） | 以平移後的提交日重算「當週週一」（`weekStartMonday`），`answers.week_start` 同步 |
| alerts | 由規則重新產生，`created_at`＝平移後日誌的 `submitted_at` |

不帶 `--anchor` 時永遠是固定日期（CI 與單元測試只用固定日期）。

### 1.5 seed 帳號一覽

| 帳號（username） | 顯示名稱 | 角色 | 部門 | 備註 |
|---|---|---|---|---|
| `banson` | Banson | admin | — | base；`--base` 也會建 |
| `hr` | HR | hr | — | base |
| `ceo` | CEO | ceo | — | base |
| `mgr_construction` | 工務主任 | manager | 工務 | fixture |
| `mgr_procurement` | 採購主管 | manager | 採購 | fixture |
| `mgr_design` | 設計副主任 | manager | 設計 | fixture |
| `mgr_xinyi` | 信義總監 | manager | 信義設計 | fixture |
| `darren` | Darren | newcomer | 工務 | fixture，到職日＝fixture 起始日 |
| `yen_yaling` | 嚴雅齡 | newcomer | 採購 | fixture |
| `hsieh_wenhsin` | 謝文心 | newcomer | 設計 | fixture |
| `hung_hsiangting` | 洪湘庭 | newcomer | 信義設計 | fixture |
| `e2e_fresh` | 測試新人 | newcomer | 工務 | `status='sample'`、`must_change_password=true`；可登入但**不進任何名單與指標** |

所有帳號的密碼都是 `SEED_PASSWORD`；登入頁只輸入帳號（不含 `@pure.internal`）。

## 2. 驗收前一天的準備（Banson）

**驗收前一天，由 Banson 對 staging 執行：**

```
pnpm db:seed --anchor <上一個工作日>
```

- `<上一個工作日>` ＝ 驗收當天往前數的第一個工作日（週一驗收就填上週五）。這樣驗收當天儀表板看到的是「昨天 4/4 已交、2 筆預警、1 筆待主管回應」，而不是連續多日缺交。
- 例：驗收日 2026-09-18（週五）→ `pnpm db:seed --anchor 2026-09-17`。四位新人的日誌會落在 9/16、9/17；預警在 9/17 17:03／17:06 產生；採購主管的回應在 9/18 09:10；洪湘庭的 R2 自 9/18 17:06 起顯示逾時未回。
- 先確認 `.env.local` 指向 staging（`SEED_ALLOWED_PROJECT_REF`＝staging ref），完成後看到 `seed  alerts 與預期一致：…` 與 `seed  完成` 即可。
- 想同時確認可重跑：`pnpm db:seed --anchor <日期> --verify`（只在 staging 尚無其他 seed 日期的資料時筆數才會等於預期，見下一點）。
- 注意：seed 不刪列。若之前已用別的 anchor 跑過，舊日期的日誌與預警會留在資料庫（儀表板會多出那幾天），`--verify` 的筆數比對也會因此失敗。需要乾淨的示範資料時，先把 staging 資料庫重置（supabase CLI 對 staging 專案 `db reset`；**絕不對 production 執行**），再 `pnpm db:push`（機器要先 link 過，見 8.3）→ `pnpm db:seed --anchor <日期>`。
- 不得對 production 執行完整模式或 `--anchor`（seed 會拒絕 `NODE_ENV=production`，但 `.env.local` 指錯專案仍靠 `SEED_ALLOWED_PROJECT_REF` 擋）。
- 示範帳號的密碼在重跑時不會被動到。若忘了 `SEED_PASSWORD` 當初設什麼、要把所有示範帳號重設成新密碼，加 `--reset-passwords`（見 6.3）。

## 3. 登入與首次改密碼

### 3.1 登入

1. 開系統網址（staging preview URL 或 production 網址），未登入時任何頁面都會被導到 `/login`。
2. `/login` 只有兩欄：**帳號**與**密碼**。帳號就是 username（例如 `hr`、`darren`），**不要輸入 email**；系統內部才會補成 `{username}@pure.internal`。
3. 帳號或密碼錯誤一律顯示「帳號或密碼錯誤」（不會告訴你是哪一個錯，這是刻意的）。
4. 登入成功後依角色落地：newcomer → `/me/today`、manager → `/manager`、hr／admin → `/hr`、ceo → `/ceo`。
5. Session 保持 30 天，期間在同一支手機上不用重登。登出鈕在每頁頂部導覽列。

### 3.2 首次登入強制改密碼

- HR 新建的帳號 `must_change_password` 預設為 `true`，登入後一律被導到 `/login/change-password`，在改完之前打開任何其他頁面都會被導回來。
- 改密碼頁有兩欄：新密碼、確認新密碼。
- **密碼規則：至少 8 碼，且同時包含英文字母與數字。** 不符會直接在頁面上顯示原因。
- 兩欄不一致、與舊密碼相同、Supabase 判定密碼太弱或太短，都會顯示繁體中文訊息，停在原頁。
- 改成功後 `must_change_password` 自動改為 `false`，並依角色落到自己的首頁。
- 示範帳號（`banson`／`hr`／`ceo`／四主管／四新人）已由 seed 設成 `must_change_password=false`，不會被導到改密碼頁；只有 `e2e_fresh` 每次 seed 後都會走一次首次改密碼流程（供測試用）。

### 3.3 忘記密碼怎麼辦（Phase 1）

Phase 1 **沒有**「忘記密碼」的自助流程（沒有 email 可寄，帳號用的是不存在的 `@pure.internal` 網域）。標準做法：

1. 使用者聯絡 HR。
2. HR 依 6.1 在 Supabase 後台重設該帳號密碼。
3. HR 依 6.2 把該帳號的 `must_change_password` 設回 `true`。
4. HR 用**非 git、非公開群組**的管道（當面、私訊）把臨時密碼交給本人，本人登入後會被強制改成自己的密碼。

> 不要在 LINE 群組貼密碼。臨時密碼也要符合 3.2 的規則（至少 8 碼、含英文與數字），否則使用者改密碼前就先被 Supabase 擋下。

## 4. HR 每日：`/hr` 怎麼讀

`/hr` 只有 hr 與 admin 進得去；newcomer、manager、ceo 開這個網址會看到 403。頁面由上而下是一顆「複製今日一行摘要」按鈕加七個區塊，以下逐一說明「數字從哪裡來」。

所有時間與日期都用台北時區。母體一律是**在職新人**：`status='active'`、有到職日、且今天已經到職的人；`status='sample'` 的測試帳號（`e2e_fresh`）與 `status='left'` 的離職者都不算。**三指標（4.5）也不例外**：Phase 1 的 `/hr` 只載入在職新人的預警，所以離職者的歷史預警不會進到任何一個區塊，包括三指標；這與 PLAN A02 的意圖有出入，見 9.5。

### 4.0 複製今日一行摘要

頁面最上方的「**複製今日一行摘要**」按鈕，格式固定為：

```
9/11 新人日誌｜4/4 已交｜預警 2 筆：嚴雅齡（進度）、洪湘庭（卡點）｜待主管回應：2｜https://<你的網址>/
```

| 欄位 | 定義 |
|---|---|
| `9/11` | 台北今天，`M/D` |
| `4/4 已交` | 今天已交日誌數／應交數（應交＝在職新人數） |
| `預警 N 筆：…` | 掛在**今天日誌**上、狀態不是 `closed` 的預警；名字用顯示名稱，R1 顯示「進度」、R2 顯示「卡點」；零筆時只印 `預警 0 筆` |
| `待主管回應：X` | 目前**全部** `status='open'` 的預警數（含往日累積） |
| 連結 | `APP_BASE_URL` 的根路徑。點進去會依登入角色各自導到 `/me/today`、`/manager`、`/hr`、`/ceo`，主管不會誤點到 `/hr` 被擋 |

**貼 LINE 群組的流程**：按「複製今日一行摘要」→ 按鈕變成「已複製」→ 到 LINE 群組貼上。若在 LINE 內建瀏覽器等不支援自動複製的環境，按鈕下方會出現一個唯讀文字框並顯示「無法自動複製，已為您選取文字，請長按複製」，長按選取複製即可。

> 建議固定在每天 18:00 之後（過了交件時刻）再複製，數字才是當天定案的。

### 4.1 今日交件

四個數字：**應交／已交／缺交／未到時**，下面接「缺交名單」與「未到時名單」。

判定規則（每位在職新人、對「今天」這個日期各判一次）：

- 有日誌 → **已交**
- 沒有日誌，且現在**已到或超過**（`>=`）`settings.daily_cutoff_time`（預設 **18:00** 台北）→ **缺交**
- 沒有日誌，且還沒到 18:00 → **未到時**
- 不是 `active`、沒設到職日、或今天還沒到職 → 不計入應交

所以 **缺交與未到時的分界就是 18:00 這個 cutoff**。12:00 看儀表板時所有沒交的人都是「未到時」，不是缺交；18:00 之後同一批人才會變成「缺交」。要調整這個時刻，Phase 2 的 `/admin/settings` 才有 UI；Phase 1 只能改 `settings` 表（見 9.2）。

### 4.2 待處理預警

掛在日誌上、狀態為 `open`（尚未被主管回應）的預警，每列顯示新人、日誌日期、規則（R1 進度／R2 卡點）與內容摘要，可點進該新人的頁面。已被主管回應（`responded`）或已關閉（`closed`）的不在這裡。

兩條規則只看結構化欄位，不比對自由文字：

- **R1（進度）**：昨天計畫寫「預計完成」的項目，今天結算的狀態既不是「完成」也不是「昨日無此項」。同一天多個項目只產生一筆預警，內容列出是哪幾項。
- **R2（卡點）**：今日卡點選了「有，尚未回報」。

### 4.3 HR 介入清單（兩種來源）

這一區有兩段，來源不同、離開條件也不同：

| 段落 | 進來的條件 | 什麼時候離開 |
|---|---|---|
| **逾時未回** | 在職新人身上還是 `open` 的預警，且「現在 − 預警建立時間」**超過** `settings.response_threshold_hours`（預設 **24 小時**） | 主管一回應就自動離開（預警轉 `responded`），不必手動關掉 |
| **需 HR 協助** | 主管回應時「處理狀態」選了「需 HR 協助」，且該筆回應在**近 7 個日曆日內**（含今天） | 過了 7 日視窗自動離開 |

兩段都是「讀取時推導」，沒有排程、也沒有「已處理」按鈕（Phase 1 不做）。所以：**逾時未回要消失，就去催主管回應；需 HR 協助處理完就等它自己過期**。「需 HR 協助」那段即使那天沒有預警（主管主動留言）也會列出來。

回應者是 hr 或 admin 時，該列的時間會寫成「HR 代填於 …」而不是「主管回應於 …」。

### 4.4 近 7 日各部門統計

以台北今天為最後一天、往前算 7 個日曆日（含今天）。每個部門一列：

| 欄 | 定義 |
|---|---|
| 新人 | 該部門的在職新人數 |
| 應交 | 期間內該部門新人的工作日數總和（`settings.workweek`，預設週一～週五；今天若還沒到 18:00 不計入應交） |
| 已交 | 期間內實際交出的日誌數 |
| 缺交 | 應交 − 已交 |
| 預警 | 期間內建立的預警數 |
| 已回應 | 其中已被回應的數 |
| 回應率 | 已回應 ÷ 預警 |

### 4.5 三指標

分子分母的母體都是「`status ∈ {open, responded}` 且所屬日誌未被軟刪」的預警，**不含 `closed`**，也不含測試帳號（`sample`）的預警。

> **離職者的預警不算。** Phase 1 的 `/hr` 只載入**在職**新人的預警，因此帳號一旦改成 `status='left'`，他的歷史預警會同時退出誤報率、主管回應率與 24h 內回應率——停用某人的當下看到三指標跳動是**正常的**，不是系統壞掉。PLAN A02 要求的「以 alerts 事實全量計、離職者歷史預警仍計入」尚未在頁面層實作（純函式層有保留），這條差異記在 9.5。

| 指標 | 分子 | 分母 |
|---|---|---|
| **誤報率** | 主管回應的「處理狀態」＝「已讀，無需處理」的預警數 | **已回應**的預警數 |
| **主管回應率** | 已回應的預警數 | 全部預警數（open ＋ responded） |
| **24h 內回應率** | 回應時間 − 建立時間 **≤ 24 小時**的預警數 | 與主管回應率**同分母**（還沒回應的 open 也算在分母裡） |

要點：

- 誤報率的分母是「已回應」，不是「全部」。沒人回應時分母為 0，顯示「—」而不是 0%。
- 24h 內回應率的 24 小時是**固定的**，不會隨 `response_threshold_hours` 改動（改了 `response_threshold_hours` 只影響 4.3 的「逾時未回」與 `late` 統計）。
- 三個指標都是「到職至今全期」，不是近 7 日。
- 以 §11 示範資料、台北 9/4 18:00 觀察：誤報率 0/1＝0%、主管回應率 1/2＝50%、24h 內回應率 1/2＝50%。

### 4.6 新人總覽

每位在職新人一列：姓名、部門、第 N 天、階段、下一節點、累計預警、回應率、缺交率。

- **第 N 天**＝台北今天 − 到職日 ＋ 1（日曆天，不是工作日）。沒設到職日會顯示「尚未設定到職日」。
- **階段**由 D30／D60／D90 節點推導；第 91 天起顯示「已滿 90 天」。
- **下一節點**＝還沒完成、到期日最小的那一筆；已過期會標「逾期 N 天」。
- **累計預警／回應率**口徑同 4.5（全期）。
- **缺交率**＝1 −（累計日誌數 ÷ 到職至今的工作日數）。工作日依 `settings.workweek`（預設週一～週五）。今天若還沒到 18:00，今天不計入分母。這一格**只顯示百分比**；要看「缺了幾天／共幾個工作日」請點名字進個別新人頁（4.8）。

### 4.7 節點到期

列出到期日落在**今天到今天＋7 天**的 D30／D60／D90，逾期未做的標「逾期」並排在最前面。Phase 1 只能看，節點紀錄表單（notes／outcome）是 Phase 3。

### 4.8 個別新人：`/hr/newcomer/[id]`

從各區塊點名字進來，可看 90 天總覽、完整時間軸，以及「匯出 CSV」（`/api/export/newcomer/[id]`）。HR 在這頁**只能看**，要回應預警請走 `/manager/newcomer/[id]`（見 7.3）。

這頁的 **90 天總覽**會在缺交率下方多一行註記「缺 N / M 個工作日（計至 yyyy/MM/dd）」，讓你知道百分比是用幾個工作日算出來的；4.6 的新人總覽表格只顯示百分比，沒有這行。

CSV 注意事項見 9.4（防公式注入的前置單引號）。

## 5. Phase 1 建帳號的兩條路

Phase 1 沒有 `/admin/users`，所以新人／主管帳號只有兩種建法。**兩條路都要記得：新人一定要有到職日與三筆節點，否則他不會出現在任何名單與指標裡。**

### 路 A：加進 seed fixture 後跑 `pnpm db:seed`（推薦，會自動建齊）

適合：staging 上要多幾位示範用的人、或人數不多且工程師在旁邊。

1. 編輯 `supabase/seed/fixtures/fixture.ts`，在 `FIXTURE_MANAGERS` 或 `FIXTURE_NEWCOMERS` 陣列裡照現有格式加一筆：

   ```ts
   {
     id: "00000002-0000-4000-8000-0000000000xx", // 固定 UUID，不可與現有重複
     username: "new_person",                     // 小寫英數與 _ . -，2–32 碼
     display_name: "王小明",
     role: "newcomer",                           // 或 "manager"
     department: "工務",                          // 必須是既有部門名稱
     manager_username: "mgr_construction",       // 新人才需要；主管填 null
     start_date: FIXTURE_START_DATE,             // 或 "2026-10-01"
     status: "active",
     must_change_password: false,                // 要走首次改密碼就填 true
   },
   ```

2. **同步更新筆數期望值**：`supabase/seed/fixtures/expected.ts` 的 `EXPECTED_ROW_COUNTS.full` 是硬編碼的，加一位新人要把 `profiles` ＋1、`milestones` ＋3（加主管則只有 `profiles` ＋1）。不改的話，`pnpm db:seed --verify` 會因筆數不符 exit 1，`tests/unit/fixtures.test.ts` 也會紅。
3. 跑 `pnpm db:seed`。seed 會**一次做完三件事**：以 `{username}@pure.internal` 建 Supabase Auth 使用者（已勾 email confirm）、寫入 `profiles` 一列、依到職日建 D30／D60／D90 三筆 `milestones`。
4. 跑 `pnpm test` 確認全綠，再送 PR（§13 完成定義要求 lint／typecheck／unit／e2e 全綠）。
5. 密碼是 `SEED_PASSWORD`。既有帳號重跑不會被改密碼。

> 這條路會動到 repo 的程式碼，要走分支 → PR → 人審（CLAUDE.md §0）。真正上線的名單維護請等 Phase 2 的 `/admin/users`。

### 路 B：Supabase 後台手建（不改程式碼）

適合：production 上要臨時開一個帳號、或工程師不在。

**B-1 建 Auth 使用者**

1. Supabase 後台 → **Authentication → Users → Add user → Create new user**。
2. Email 填 `{username}@pure.internal`（例如 `wang_xiaoming@pure.internal`），**全部小寫**。
3. Password 填臨時密碼（至少 8 碼、含英文與數字）。
4. **勾選 `Auto Confirm User`（email confirm）**。系統沒有真的信箱，不勾的話這個帳號永遠登不進來。
5. 建立後把該使用者的 **UID** 複製下來，下一步要用。

**B-2 在 `profiles` 補一列**

Supabase 後台 → **SQL Editor**，執行（把角括號內容換掉）：

```sql
insert into public.profiles
  (id, username, display_name, role, department_id, manager_id, start_date, status, must_change_password)
values (
  '<B-1 複製的 UID>',
  'wang_xiaoming',
  '王小明',
  'newcomer',
  (select id from public.departments where name = '工務'),
  (select id from public.profiles where username = 'mgr_construction'),
  '2026-10-01',
  'active',
  true
);
```

每個欄位的允許值：

| 欄位 | 必填 | 允許值／格式 |
|---|---|---|
| `id` | ✓ | 必須**等於** B-1 那位 auth 使用者的 UID（外鍵指向 `auth.users.id`） |
| `username` | ✓ | 全域唯一；小寫英數開頭，之後可用英數 `_` `.` `-`，共 2–32 碼（`^[a-z0-9][a-z0-9_.-]{1,31}$`）；必須與 B-1 的 email local part 一致 |
| `display_name` | ✓ | 顯示名稱，不可空白；中文即可（`王小明`、`工務主任`） |
| `role` | ✓ | `newcomer`／`manager`／`hr`／`ceo`／`admin` |
| `department_id` | 建議填 | `departments.id`。主管要看得到新人，兩人的部門必須相同（同部門＝`department_id` 相等）。留 `null` 時新人總覽會顯示「未指派部門」 |
| `manager_id` | 新人建議填 | 該新人主管的 `profiles.id`；主管自己填 `null`（不可指向自己） |
| `start_date` | **新人必填** | `YYYY-MM-DD`。**沒有到職日的新人不會出現在今日交件、缺交名單、主管卡片、新人總覽與任何指標裡**；主管／HR／CEO／admin 填 `null` |
| `status` | ✓ | `active`（正常）／`left`（停用，不能登入）／`sample`（可登入但不進任何名單與指標，只給測試用） |
| `must_change_password` | ✓ | 新建帳號填 `true`，使用者第一次登入會被強制改密碼 |
| `line_user_id` | — | Phase 3 才用，留空 |
| `created_at` | — | 有預設值，不用填 |

**B-3 補三筆節點**

新人一定要有 D30／D60／D90 三筆 `milestones`，否則 `/hr` 的「階段」「下一節點」「節點到期」都是空的。手建 profile 不會自動產生，請跑：

```
pnpm db:seed --milestones-only
```

這個模式會掃過**所有** `role='newcomer'` 且 `start_date` 不是 null 的人，把缺少的節點補上（已存在的列完全不動），最後印出「新人 N 位（有到職日），補齊 M 筆（D30/D60/D90）」。它不會建帳號、不寫日誌，對 production 也可以跑。

**B-4 交付與驗收**

用非公開管道把「帳號 ＋ 臨時密碼」交給本人，請他登入後照 3.2 改密碼。改完之後到 `/hr` 確認：新人總覽出現這個人、第 N 天正確、下一節點是 D30。

## 6. 重設密碼與停用帳號

### 6.1 重設某人的密碼（Supabase 後台）

1. Supabase 後台 → **Authentication → Users**，用 `{username}@pure.internal` 搜尋。
2. 該列右側「⋯」→ **Reset password**（或編輯使用者直接填新密碼）。臨時密碼須至少 8 碼且含英文與數字。
3. 接著一定要做 6.2，否則對方會一直用你給的臨時密碼。

### 6.2 把 `must_change_password` 設回 true

Supabase 後台 → **SQL Editor**：

```sql
update public.profiles
   set must_change_password = true
 where username = '<帳號>';
```

也可以在 **Table Editor → `profiles`** 找到該列，把 `must_change_password` 打勾。設好之後該帳號下次登入會被導到 `/login/change-password`，改完才放行。

### 6.3 一次重設所有 seed 示範帳號的密碼

只適用於本機與 staging 的示範帳號：先把 `.env.local` 的 `SEED_PASSWORD` 改成新密碼，再跑

```
pnpm db:seed --reset-passwords
```

（可與 `--anchor` 等旗標並用）。`e2e_fresh` 不加這個旗標也會每次重設。**不要對 production 跑完整模式**；production 只准 `--base` 與 `--milestones-only`。

### 6.4 停用帳號（離職）

```sql
update public.profiles
   set status = 'left'
 where username = '<帳號>';
```

停用之後：

- 該帳號登入會被登出並導回登入頁，顯示「**帳號已停用，請聯絡 HR。**」；已登入中的 session 下一次開頁面也會被踢出。
- 這個人不再出現在今日交件、缺交名單、主管卡片、HR 介入清單、新人總覽、節點到期與一行摘要裡。
- **資料庫裡的歷史資料完全保留**：他過去的日誌、預警與主管回應仍可在 `/hr/newcomer/[id]` 用直達網址讀取與匯出（人已不在任何名單裡，要自己留網址或用 SQL 查 id）。
- **但三指標會跳動**：Phase 1 的 `/hr` 只載入在職新人的預警，所以停用的當下，這個人的歷史預警會同時退出誤報率、主管回應率與 24h 內回應率（不只是缺交率）。這是目前的行為，不是錯誤；與 PLAN A02 的差異見 9.5。
- 要復職就把 `status` 改回 `active`。若到職日有變，記得同時更新 `start_date` 並跑 `pnpm db:seed --milestones-only`（只補缺的節點；已存在的到期日不會被改，需要改請直接改 `milestones.due_date`）。

> Phase 1 沒有「刪除帳號」的操作，也請**不要**在 Supabase 後台刪 auth 使用者。刪下去只會有兩種結果，兩種都不是你要的：
> - 這個人**還沒有任何日誌或預警**：`profiles` 與 `milestones` 對他是 `on delete cascade`，會被一起刪掉，人與節點就消失了。
> - 這個人**已經有日誌或預警**：`submissions.user_id` 與 `alerts.user_id` 對 `profiles` 是 `on delete restrict`，資料庫會直接**拒絕刪除**並回外鍵錯誤（`submissions_user_id_fkey`），畫面上看起來像是後台壞掉。
>
> 停用一律用 `status='left'`。

## 7. 主管每天／每週的路徑

### 7.1 每天：卡片 → 時間軸 → 回應

1. 主管登入後落在 `/manager`，看到自己部門每位在職新人一張卡片：**今日計畫**（取自這位新人**今天之前**最近一筆日誌裡的「明日項目」，卡片上會註明來源日期）、今日交件狀態（已交／缺交／未到時）、`open` 預警數、是否逾時。
2. 點卡片進 `/manager/newcomer/[id]`：**時間軸**，每天一列，並排顯示「昨日計畫與結算狀態」「臨時新增工作／今日學到」「卡點」「明日計畫」「預警」「主管回應」。
3. 有預警的那一列有「**回應**」按鈕，點開抽屜就是 `manager_response` 表單：**處理狀態**（已讀，無需處理／已處理／需 HR 協助）＋**一句話回饋**。送出後顯示「已送出回應」，該日誌上所有 `open` 預警立刻轉成 `responded`，並從 HR 的「待處理預警」「逾時未回」消失。整個動作設計成 20 秒內可完成。
4. 沒有預警的日子也可以回應（按鈕仍在，抽屜會提示「這天沒有預警，仍可留下一句話給新人。」）。回應過的列按鈕變成「修改回應」。
5. 選「**需 HR 協助**」會讓這筆回應進 HR 介入清單的第二段（近 7 日視窗，見 4.3）。

### 7.2 每週五：週回饋

- 台北時間週五，`/manager` 上本週還沒填週回饋的新人卡片會顯示「**週回饋未填**」，點進去就是 `/manager/weekly?newcomer={id}`。
- `/manager/weekly` 選對象後填三行：**做得好的一件事／要改的一件事／下週重點**，週起始日預設本週一。
- 同一位主管對同一位新人、同一週只會有一筆；再送出是更新，不會重複。
- 新人在 `/me/history` 看得到這筆週回饋。

### 7.3 HR 代填

HR 與 admin 也能進 `/manager`、`/manager/newcomer/[id]` 與 `/manager/weekly`，差別是：

- 頁面上方會出現「**HR 代填模式**」提示，並說明看到的是全部部門的在職新人。
- 在這個模式下送出的回應與週回饋會被標成「**HR 代填**」，新人的 `/me/history`、主管的時間軸與 HR 介入清單都會看到這個標記。
- HR 不能從 `/hr/newcomer/[id]` 直接回應（那頁是唯讀的），要代填請走 `/manager/newcomer/[id]`。

## 8. Supabase 與 Vercel 必要設定（admin）

### 8.1 Supabase 專案設定（staging 與 production 各做一次）

| 設定 | 位置 | 值 | 為什麼 |
|---|---|---|---|
| **Confirm email** | Authentication → Sign In / Providers → Email | **關閉**（Confirm email = off） | 帳號用不存在的 `@pure.internal` 網域，寄不出信也收不到；沒關掉的話新帳號永遠是未驗證、登不進來。後台手建使用者時務必勾 `Auto Confirm User` |
| **公開 signup** | Authentication → Sign In / Providers → Email | **關閉**（Allow new users to sign up = off） | 帳號只由 HR 建；開著等於任何人都能自己註冊 |
| **Minimum password length** | Authentication → Policies（Password settings） | **8** | 與改密碼頁的規則一致（3.2）。設得比 8 小，弱密碼會被前端擋、後端放行，訊息不一致 |
| **JWT expiry** | Authentication → Sessions | 預設 3600 秒即可 | access token 短、由 middleware 自動刷新；不要為了「30 天」把它調長 |
| **Refresh token rotation** | Authentication → Sessions | **開啟**（Reuse interval 10 秒） | 30 天 session 靠 refresh token 續命；關掉會讓使用者每小時被登出 |
| **Session 時長** | Authentication → Sessions | 不設上限（或 ≥ 30 天） | CLAUDE.md §3 要求 session 保持 30 天；應用端的 cookie `maxAge` 已設 30 天，Supabase 端若設更短會提前失效 |
| **RLS** | 由 migrations 設定 | 所有表對 `anon`／`authenticated` deny-all | 資料只能經伺服器端 service role 讀寫；請勿在後台為任何表加開放的 policy |

> **這張表只適用 staging 與 production 這兩個 hosted 專案。** repo 裡的 `supabase/config.toml`（本機 supabase CLI 堆疊與 CI 的 db／e2e job 用的那份）刻意是 `enable_signup = true`、`minimum_password_length = 6`，那是暫時性的測試環境設定，讓測試能自行建帳號；**兩邊不一致是預期的，不要為了對齊而去改任何一邊**。

> **30 天 session 目前只驗證了「刷新機制有效」，沒有真的等 30 天。** 驗證法：暫時把 JWT expiry 調成 5 分鐘 → 登入後閒置 10 分鐘再操作，仍在線 → 調回。真正的 30 天留在上線後檢討時再確認。

**免費專案閒置暫停**：Supabase 免費方案的專案連續 7 天沒有任何流量會被自動暫停（paused），此時網站會出現連線錯誤。喚醒方式：登入 Supabase 後台 → 選到該專案 → 首頁會顯示 **Restore / Resume project** 按鈕 → 按下去等一到兩分鐘，資料不會遺失。要避免暫停，就在驗收前一天先開一次後台，或照第 2 節跑一次 seed。**production 專案不要放著不管超過一週。**

### 8.2 Vercel 環境變數

Preview（staging 分支）與 Production（main）各設一組。**改完環境變數必須重新部署才會生效。**

| 變數 | Vercel 要設嗎 | 值 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ Preview ＋ Production | 對應 Supabase 專案網址（preview 指 staging、production 指 production） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ Preview ＋ Production | 該專案的 anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ Preview ＋ Production | 該專案的 service role 金鑰。**只設在 Vercel 與本機 `.env.local`，絕不進 git** |
| `APP_TIMEZONE` | ✓ Preview ＋ Production | `Asia/Taipei` |
| `APP_BASE_URL` | ✓ Preview ＋ Production | 該環境對外網址，例如 `https://pure-onboard.vercel.app`（結尾有沒有 `/` 都可以） |
| `SEED_PASSWORD` | ✗（只在本機 `.env.local` 與 CI secret） | seed 帳號密碼；Vercel 上的應用程式從不讀它 |
| `SEED_ALLOWED_PROJECT_REF` | ✗（只在本機 `.env.local` 與 CI secret） | 准許 seed 寫入的專案 ref，防止把示範資料灌進錯的專案 |

**`APP_BASE_URL` 未設或留空，`/hr` 會直接擲錯「APP_BASE_URL 未設定」整頁打不開**（不是靜默降級）。這是刻意的：一行摘要的連結若退回成 `/`，貼到 LINE 群組就沒人打得開。所以 preview 建好新環境時，第一件事就是把 `APP_BASE_URL` 設對並重新部署。

### 8.3 上線／建立新環境的順序

```
pnpm exec supabase login                      # 1. 一台機器做一次
pnpm exec supabase link --project-ref <ref>   # 2. 綁定目標專案，會問資料庫密碼
pnpm db:push                                  # 3. 把 migrations 推上去（可從空庫一路跑到最新）
pnpm db:seed --base                           # 4. departments、settings、三張範本 v1、banson/hr/ceo
```

第 1、2 步不能省：`pnpm db:push` 就是 `supabase db push`，沒 link 過的機器不知道要推去哪個專案，會直接失敗。`<ref>` 是 Supabase 專案網址裡的那串 ref（後台 Project Settings → General）。不想 link 也可以改用 `pnpm exec supabase db push --db-url "<connection string>"` 一次性指定（連線字串須 percent-encode）。若是**本機 CLI 堆疊**（Docker），則不用 push，直接 `pnpm db:reset` 重建。

production **做到第 4 步就停**，不要跑完整模式（會灌入示範新人與示範日誌；seed 在 `NODE_ENV=production` 也會拒絕）。staging 接著再跑 `pnpm db:seed` 或 `pnpm db:seed --anchor <日期>`（第 2 節）。

## 9. 已知限制（Phase 1）

### 9.1 Phase 2 才有的東西：`/admin` 後台

以下操作 Phase 1 **沒有 UI**，需要工程師或直接改資料庫：

| 想做的事 | Phase 2 的頁面 | Phase 1 的替代做法 |
|---|---|---|
| 改題目、加題目、發布新版表單 | `/admin/forms` | 沒有替代；請等 Phase 2，不要手改 `form_versions.questions` |
| 新增／編輯／停用帳號、重設密碼 | `/admin/users` | 第 5、6 節（seed fixture 或 Supabase 後台） |
| 部門 CRUD | `/admin/departments` | 直接改 `departments` 表 |
| 改預警規則參數、開關規則 | `/admin/rules` | 沒有替代；改參數會連動表單選項驗證，請等 Phase 2 |
| 改 cutoff、回應門檻、工作日制 | `/admin/settings` | 見 9.2 |
| 改／軟刪／還原日誌、重跑規則、CSV 匯入 | `/admin/data` | 沒有替代 |
| 看稽核紀錄 | `/admin/audit` | `audit_log` 表 Phase 1 尚未有任何寫入者 |

### 9.2 Phase 1 改設定的做法（admin，謹慎）

`settings` 表目前四個 key：`daily_cutoff_time`（`"18:00"`）、`response_threshold_hours`（`24`）、`workweek`（`"mon_fri"` 或 `"mon_sat"`）、`rules`（R1／R2 參數）。Phase 1 只能在 SQL Editor 改，例如把交件時刻改成 17:30：

```sql
update public.settings
   set value = '"17:30"'::jsonb
 where key = 'daily_cutoff_time';
```

改完立刻生效（每次讀取時重新推導，不需要重新部署）。**不要改 `rules` 的比對值**（例如把「完成」改成別的字），那些值必須與表單題目的選項完全一致，Phase 1 沒有驗證把關，改錯會讓預警靜默失效。

### 9.3 Phase 3 才有的東西

- **LINE 通知**：目前一行摘要要由 HR 手動複製貼上（4.0）。
- **節點紀錄表單**：`/hr/newcomer/[id]` 只顯示節點到期，`notes` 與 `outcome` 的填寫介面是 Phase 3；Phase 1 要記錄請暫時記在別處。
- **AI 摘要**。

### 9.4 CSV 匯出的前置單引號

`/hr/newcomer/[id]` 的 CSV 匯出，對任何以 `=` `+` `-` `@` 或 Tab／CR 開頭的儲存格會**在前面加一個單引號**（例如新人寫「-3 樓放樣」會匯出成 `'-3 樓放樣`）。這是為了避免 Excel／Google Sheets 把儲存格當成公式執行（CSV 公式注入）。

- 用 Excel 開的時候會看到那個單引號，屬正常現象，文字本身沒有被改。
- Phase 2 的 `/admin/data` CSV 匯入會在寫回資料庫前把這個單引號還原，所以「本系統匯出 → 本系統匯入」的來回不會累積符號。
- 若要把匯出檔給外部系統吃，請先確認對方能接受這個前置單引號。

### 9.5 其他

- **停用帳號會讓三指標跳動（與 PLAN A02 有出入，待決）。** PLAN 假設 A02 要求「誤報率與主管回應率以 alerts 事實全量計，離職者的歷史預警仍計入」，`lib/metrics/rates.ts` 的純函式也的確不看 `status`；但 `/hr` 頁面把預警母體限縮成 `activeNewcomers()` 的 id，所以離職者的預警根本沒被載入，指標實際上是「只算在職者」。兩種收法各有道理（改頁面查詢母體／正式修訂 A02），Phase 2 一併裁決；在那之前，看到停用某人後指標變動屬正常。
- 沒有多語系、沒有深色模式（CLAUDE.md §3）。
- 缺交、逾時這些時間型狀態都是「打開頁面當下才算」，沒有排程，所以不會有任何主動通知；請養成每天固定時間看 `/hr` 的習慣。
- `e2e_fresh` 這個帳號是給自動化測試用的，看得到但不進任何統計；請不要拿它當真人帳號。
