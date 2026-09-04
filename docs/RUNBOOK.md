# RUNBOOK — HR 與 admin 操作手冊

> 初稿（T16）：本檔目前只完成「第 1 節 seed 指令」與「第 2 節 驗收前一天的準備」。其餘章節在 T29 補齊（章節骨架先列在第 3 節）。

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

旗標可以並用，例如 `pnpm db:seed --anchor 2026-09-17 --verify`。

### 1.3 完整模式寫入什麼、重跑會怎樣

- 日誌走與 `/me/today` 完全相同的路徑：`prepareDailyLog` → 以自然鍵（新人、日期）查找後 insert／update → `applyAlertChanges`，預警由規則即時算出。寫完後 seed 會把資料庫裡的 alerts 與預期（`EXPECTED_ALERTS`）逐筆比對，不符即印出差異並 exit 1。
- 預期結果：嚴雅齡 9/3 一筆 R1（items 1、3），已由採購主管 9/4 09:10 回應 → `responded`；洪湘庭 9/3 一筆 R2 → `open`（9/4 18:00 起逾時未回、進 HR 介入清單）。
- **seed 從不刪任何列**。重跑時：既有的 seed 列以自然鍵找到後改寫成相同內容（實際上不變）；若自然鍵撞到非 seed 建立的列（同名部門、同帳號但不同 id、同一主管對同一日誌有 ≥2 筆回應），seed 會印出衝突並中止，請人工處理後再跑。
- 範本只「缺才插入」：staging 上若 HR 已發布 v2，重跑 seed 不會把 active 版退回 v1；fixture 日誌一律綁 v1。
- seed 帳號密碼：第一次建立時用 `SEED_PASSWORD`；之後重跑不改密碼（除非 `--reset-passwords`）。示範帳號不需首次改密碼，只有 `e2e_fresh` 會被導到改密碼頁。

### 1.4 `--anchor`：把示範資料平移到指定日期

fixture 的日期固定在 2026-09-01（到職）～09-04；`--anchor <日期>` 把「9/3」對映到該日期，其他日期等距平移：

| 欄位 | 平移方式 |
|---|---|
| `profiles.start_date`、`milestones.due_date` | 同天數平移 |
| `submissions.log_date`、`submitted_at` | 同天數平移（時刻不變，仍是台北 17:0x 交件、隔天 09:1x 回應） |
| `submissions.week_start`（週回饋） | 以平移後的提交日重算「當週週一」（`weekStartMonday`），`answers.week_start` 同步 |
| alerts | 由規則重新產生，`created_at`＝平移後日誌的 `submitted_at` |

不帶 `--anchor` 時永遠是固定日期（CI 與單元測試只用固定日期）。

## 2. 驗收前一天的準備（Banson）

**驗收前一天，由 Banson 對 staging 執行：**

```
pnpm db:seed --anchor <上一個工作日>
```

- `<上一個工作日>` ＝ 驗收當天往前數的第一個工作日（週一驗收就填上週五）。這樣驗收當天儀表板看到的是「昨天 4/4 已交、2 筆預警、1 筆待主管回應」，而不是連續多日缺交。
- 例：驗收日 2026-09-18（週五）→ `pnpm db:seed --anchor 2026-09-17`。四位新人的日誌會落在 9/16、9/17；預警在 9/17 17:03／17:06 產生；採購主管的回應在 9/18 09:10；洪湘庭的 R2 自 9/18 17:06 起顯示逾時未回。
- 先確認 `.env.local` 指向 staging（`SEED_ALLOWED_PROJECT_REF`＝staging ref），完成後看到 `seed  alerts 與預期一致：…` 與 `seed  完成` 即可。
- 想同時確認可重跑：`pnpm db:seed --anchor <日期> --verify`（只在 staging 尚無其他 seed 日期的資料時筆數才會等於預期，見下一點）。
- 注意：seed 不刪列。若之前已用別的 anchor 跑過，舊日期的日誌與預警會留在資料庫（儀表板會多出那幾天），`--verify` 的筆數比對也會因此失敗。需要乾淨的示範資料時，先把 staging 資料庫重置（supabase CLI 對 staging 專案 `db reset`；**絕不對 production 執行**），再 `supabase db push` → `pnpm db:seed --anchor <日期>`。
- 不得對 production 執行完整模式或 `--anchor`（seed 會拒絕 `NODE_ENV=production`，但 `.env.local` 指錯專案仍靠 `SEED_ALLOWED_PROJECT_REF` 擋）。

## 3. 其餘章節（T29 補）

- 帳號與名單：新增新人、停用、重設密碼、部門維護（`/admin/users`、`/admin/departments`）
- 表單：建立草稿、編輯題目、發布與驗證錯誤的處理（`/admin/forms`）
- 規則參數與系統設定（`/admin/rules`、`/admin/settings`；僅 admin）
- 資料維護：改答案、軟刪除、還原、重跑規則、CSV 匯出／匯入（`/admin/data`）
- 稽核紀錄（`/admin/audit`）
- Supabase 後台設定：Auth 密碼最短長度須設為 8（與改密碼規則一致，DECISIONS D-16）、關閉 email 驗證
- 部署與環境：Vercel staging／production、環境變數清單
