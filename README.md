# pure-onboard — 璞石新人支持系統

璞石集團室內裝修新人 90 天支持計畫的紀錄系統：計畫 → 執行 → 回報 → 主管回應 → HR 稽核，一筆紀錄不重打。

## 如何跑起來（最短路徑）

前置：Node 22（見 `.nvmrc`）、pnpm 10、一個可用的 Supabase 專案（staging，或用 supabase CLI 本機堆疊——後者需要 Docker）。

```bash
pnpm install --frozen-lockfile          # 1. 安裝依賴
cp .env.example .env.local              # 2. 填入真值（見下表），.env.local 不進 git
pnpm db:push                            # 3. 把 supabase/migrations 推到目標專案
pnpm db:seed                            # 4. 寫入示範資料（依 CLAUDE.md §11）
pnpm dev                                # 5. http://localhost:3000
```

用 seed 帳號登入（帳號欄只填 username，不含 email）：`hr`／`darren`／`mgr_construction`／`ceo`，密碼一律是你在 `.env.local` 設的 `SEED_PASSWORD`。完整帳號清單見 `docs/RUNBOOK.md` 1.5。

`.env.local` 要填的變數（`.env.example` 已列齊佔位值）：

| 變數 | 用途 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 專案網址 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | service role 金鑰（所有資料存取都走它，只在伺服器端） |
| `APP_TIMEZONE` | `Asia/Taipei` |
| `APP_BASE_URL` | 本機填 `http://localhost:3000`；**未設會讓 `/hr` 直接擲錯** |
| `SEED_PASSWORD` | seed 帳號的密碼；未設時 `pnpm db:seed` 中止 |
| `SEED_ALLOWED_PROJECT_REF` | 准許 seed 寫入的專案 ref（本機堆疊填 `local`），防止灌錯專案 |

其他常用指令：

| 指令 | 做什麼 |
|---|---|
| `pnpm lint` / `pnpm typecheck` | ESLint／TypeScript |
| `pnpm test` | Vitest 單元測試 |
| `pnpm test:e2e` | Playwright 煙霧測試（需要可連線的 Supabase） |
| `pnpm build` / `pnpm start` | 正式編譯與啟動 |
| `pnpm db:reset` / `pnpm db:types` | 重置本機資料庫／重新產生 `lib/db/types.ts` |
| `pnpm db:seed --anchor <日期>` | 把示範資料平移到指定日期（驗收前用，見 RUNBOOK 第 2 節） |

## 文件

| 文件 | 內容 | 給誰看 |
|---|---|---|
| [`CLAUDE.md`](CLAUDE.md) | 專案規格與協作規則（資料模型、表單引擎、預警規則、權限矩陣、種子案例）——**單一真相來源** | 工程師 |
| [`docs/PLAN.md`](docs/PLAN.md) | Phase 1 建置計畫、假設清單 A01–A13 與任務拆解 T01–T30 | 工程師、Banson |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | 架構決定紀錄，一列一個決定（日期／決定／理由） | 工程師 |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | 操作手冊：seed 指令、登入與改密碼、`/hr` 每日怎麼讀、建帳號與停用、Supabase／Vercel 設定、已知限制 | HR、admin |

此 repo 為 private。任何金鑰不得進 git；環境變數見 `CLAUDE.md` 第 4 節與 `.env.example`。
