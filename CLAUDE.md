# pure-onboard — 璞石新人支持系統

## 0. 你的角色與工作方式
你是本 repo 的主責工程師（senior full-stack，正確性優先於巧妙）。使用者是 CEO Banson（產品裁決者，非工程師）與 HR（產品負責人、日常管理者）。
- 只做被明確要求的變更。不要新增未列出的功能、抽象層、檔案或依賴。
- 每完成一個步驟輸出三行回報：✅ 做了什麼／⚠️ 風險或未決／⏭️ 下一步。
- 遇到下列情況必須停下來問，不得自行決定：刪除檔案；新增任何 npm 依賴；修改資料表結構超出第 5 節；接入新的外部服務；兩條實作路徑會影響架構；同一錯誤修兩次仍失敗；需要動到本規格範圍外的東西；任何會花錢的動作。
- 測試先行：`lib/rules` 與 `lib/forms` 必須有 Vitest 單元測試，並用第 11 節的種子案例當固定 fixture。
- 不要推送到 main。功能分支 → PR → 等人審。不要自行部署到 production。
- 若已安裝 `/pure-grill` 技能，在任何 Phase 開工前先用它盤問需求。
- 介面語言：繁體中文（台灣用語）。程式碼、識別字、commit message：英文。
- 時區：所有顯示與「日誌日期」計算用 Asia/Taipei；資料庫存 timestamptz。

## 1. 背景與目標（為什麼做）
璞石集團（室內裝修）每位新人有 90 天支持計畫。現行做法：新人每天填兩張 Tally 表、HR 匯出成 Excel 貼 LINE 群組、主管各自下載。問題：新人重打、HR 當轉運站、主管無回應欄位、預警靠文字比對誤報率高。
本系統把「計畫→執行→回報→主管回應→HR 稽核」做成一條紀錄，並讓 HR 在後台隨時新增或調整問題而不必改程式。
三條設計原則（違反任何一條就是做錯）：
1. 一筆紀錄不重打：新人一天一表，今日結算與明日計畫在同一筆。
2. 預警只算結構化欄位：規則綁「語意槽（slot）」，不比對自由文字。
3. HR 稽核不轉運：HR 看儀表板與稽核清單，不匯出、不貼檔。

## 2. 角色與名詞
- newcomer 新人：填每日日誌。
- manager 主管：看自己部門新人；對預警回應；週五填三行週回饋。
- hr 人資：全域檢視、名單維護、表單編輯、資料維護、節點面談。
- ceo：唯讀，全域。
- admin：hr 的超集，可改規則參數與系統設定（Banson、HR 主管）。
- 日誌 daily log：新人一天一筆，內含「今日結算（對昨日計畫）」與「明日計畫」。
- 預警 alert：由規則自動產生，掛在一筆日誌上，需要主管回應。
- 回應 response：主管針對一筆日誌的回覆（狀態＋一句話）。
- 週回饋 weekly feedback：主管每週一筆，三行。
- 節點 milestone：D30／D60／D90 面談與裁決。
- 語意槽 slot：表單題目與規則之間的固定介面（第 6 節）。

## 3. 技術棧（已鎖定，不要提出替代）
- Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui；Server Actions 與 Route Handlers 處理所有寫入。
- Supabase：Postgres、Auth（email+password）。SQL migrations 放 `supabase/migrations/`，種子放 `supabase/seed/`。
- 資料存取只在伺服器端，使用 service role；RLS 對 anon 與 authenticated 一律 deny-all（防止用 anon key 讀資料）。權限判斷集中在 `lib/auth/guard.ts`（`requireRole()`／`canAccessNewcomer()`），每個 Server Action 與頁面都必須呼叫。
- 帳號：HR 在後台建立，輸入「帳號」與顯示名稱；系統以 `{username}@pure.internal` 註冊 Supabase Auth（關閉 email 驗證），登入頁只顯示「帳號／密碼」。第一次登入強制改密碼。Session 保持 30 天。
- 部署：Vercel（staging = preview branch，production = main）。Supabase 兩個專案：staging／production。本機開發連 staging。
- 時間型狀態（缺交、逾時）一律在讀取時推導，不用 cron 物化；Phase 3 才加排程做通知。
- 測試：Vitest（單元）＋ Playwright（煙霧：四種角色各一條路徑）。GitHub Actions 跑 lint、typecheck、unit、e2e。
- 不做：多語系、深色模式、即時推播（Phase 3 前）、通用規則引擎、拖曳以外的表單佈局功能。

## 4. 環境變數
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, APP_TIMEZONE=Asia/Taipei, APP_BASE_URL
Phase 3 才加：LINE_CHANNEL_ACCESS_TOKEN, LINE_GROUP_ID, ANTHROPIC_API_KEY, AI_MODEL
`.env.example` 必須列齊；任何金鑰不得進 git。repo 從第一天就是 private。

## 5. 資料模型（Postgres；表名固定，欄位可加不可刪）
departments(id, name unique, sort_order)
profiles(id uuid PK = auth.users.id, username unique, display_name, role enum[newcomer,manager,hr,ceo,admin], department_id FK null, manager_id FK profiles null, start_date date null, status enum[active,left,sample] default active, must_change_password bool default true, line_user_id text null, created_at)
form_templates(id, key unique text, name, description, target_role enum[newcomer,manager], active_version_id FK form_versions null, created_at)
  固定三個 key：newcomer_daily／manager_response／weekly_feedback。
form_versions(id, template_id FK, version_no int, status enum[draft,published,archived], questions jsonb, change_note text, published_at, published_by FK profiles, created_at)
  unique(template_id, version_no)。同一 template 同時最多一個 draft、一個 published。
  questions jsonb = Question[]，見第 6 節。
submissions(id, template_key text, form_version_id FK, user_id FK profiles(填寫者), target_user_id FK null(主管回應／週回饋的對象新人), target_submission_id FK submissions null(主管回應對象日誌), log_date date null, week_start date null, answers jsonb, source enum[app,import] default app, submitted_at timestamptz, updated_at, deleted_at null, deleted_by, delete_reason)
  partial unique index：(template_key, user_id, log_date) where template_key='newcomer_daily' and deleted_at is null
  partial unique index：(template_key, user_id, target_user_id, week_start) where template_key='weekly_feedback' and deleted_at is null
alerts(id, submission_id FK, user_id FK(新人), rule_key text, detail jsonb, status enum[open,responded,closed], created_at, responded_at null, response_submission_id FK null, closed_at null, closed_by null, closed_reason text null)
  unique(submission_id, rule_key)
milestones(id, user_id FK, kind enum[D30,D60,D90], due_date, done_at null, interviewer_id FK null, notes text, outcome enum[continue,watch,adjust,end] null)
settings(key text PK, value jsonb, updated_at, updated_by)
  必備 key：daily_cutoff_time("18:00")、response_threshold_hours(24)、rules(第 7 節參數)
audit_log(id, actor_id FK, action text, entity text, entity_id text, before jsonb, after jsonb, reason text, created_at)
  後台所有寫入（名單、表單發布、規則、資料改刪、匯入）必須寫一筆。
notification_log(id, channel, target, payload jsonb, status, sent_at)　— Phase 3 才建。
新人到職時自動建立三筆 milestones（start_date + 30／60／90）。

## 6. 表單引擎（後台可隨時增修題目的核心）
Question 結構（存在 form_versions.questions）：
{ key: string(英數底線，發布後不可改), label: string, type: 'single_select'|'short_text'|'long_text'|'date'|'number'|'user_select', options?: string[](single_select 用；值即標籤), required: boolean, help?: string, placeholder?: string, show_if?: { question_key: string, op: 'eq'|'neq'|'in'|'not_empty', value?: string|string[] }, slot?: Slot|null, order: number, disabled: boolean }
規則：
- show_if 只能指向同一版本內 order 較小的題目；條件不成立時該題不顯示、不驗證、答案存空。
- user_select：選項來自 profiles（依 role 過濾，`options` 存 'newcomer'|'manager'）。
- 渲染：依 published 版本；新人開啟「今日日誌」時永遠用 newcomer_daily 目前 active 版本。
- 答案存 submissions.answers = { [question.key]: string | null }。不建正規化 answers 表。
- 發布（publish）：draft → published，舊 published → archived，template.active_version_id 指向新版。發布前驗證（任一失敗即拒絕並列出原因）：key 唯一且已發布過的 key 不得改型別；single_select 至少 2 個選項；show_if 指向存在且在前的題目；第 7 節啟用中的規則所需 slot 各綁定恰好一題；規則參數中的比對值必須存在於所綁題目的 options。
- 編輯 draft 的任何動作即時存檔；「複製目前發布版為新草稿」是建立草稿的唯一途徑。
- 舊 submissions 永遠綁原版本；顯示歷史時用該版本的 label。
Slot 清單（固定，程式碼 `lib/forms/slots.ts` 為單一來源）：
plan.item1.text, plan.item1.expect, plan.item2.text, plan.item2.expect, plan.item3.text, plan.item3.expect, plan.top_priority, plan.support.need, plan.support.detail,
result.item1.status, result.item1.reason, result.item2.status, result.item2.reason, result.item3.status, result.item3.reason, result.extra_work, result.blocker.status, result.blocker.detail, result.learned,
response.status, response.comment,
weekly.start_date, weekly.good, weekly.improve, weekly.next_focus
讀取「昨日計畫」：找同一新人 log_date 小於今天的最近一筆日誌，用 slot 取 plan.itemN.text／expect；跨版本也能讀，因為靠 slot 不靠 key。

## 7. 預警規則（只有這些；參數存 settings.rules，admin 可改）
共同：規則是 `lib/rules/*.ts` 的純函式，輸入（目前日誌、前一筆日誌、設定），輸出 Alert[]；提交日誌時同步執行並 upsert alerts；新人重新提交同一天日誌時重跑，不再成立的 open 預警改 closed(reason='resubmitted')，已 responded 的保留。
R1 progress｜參數 { expect_done:'完成', status_done:['完成','昨日無此項'] }
  對 i∈{1,2,3}：前一筆 plan.item{i}.expect == expect_done 且 目前 result.item{i}.status 非空且不在 status_done → 收集項目。有任何項目 → 一筆 alert(rule_key='R1', detail={items:[{i, plan_text, status, reason}]})。
R2 blocker｜參數 { unreported:'有，尚未回報' }
  result.blocker.status == unreported → alert(rule_key='R2', detail={text: result.blocker.detail})。
R3 missing｜推導狀態，不建 alert：active 新人在日期 D 無日誌且現在 ≥ D 的 daily_cutoff_time（台北）→ 缺交；未到時刻顯示「未到時」。
A1 escalation｜推導狀態：alert.status='open' 且 now − created_at > response_threshold_hours → 逾時未回（HR 介入清單）；responded 且 responded_at − created_at > 門檻 → 標記 late（只影響統計）。
主管回應：提交 manager_response（target_submission_id 必填）→ 該日誌所有 open alerts 改 responded、寫 responded_at 與 response_submission_id；response.status 為「需 HR 協助」時在 HR 清單另列。
指標定義（HR 儀表板；與 Google Sheet 過渡版一致）：
- 誤報率 = response.status=='已讀，無需處理' 的預警 ÷ 已回應預警
- 主管回應率 = 已回應預警 ÷ 全部預警；另顯示 24h 內回應率
- 缺交率 = 1 − 累計日誌數 ÷ 到職至今工作日數（週一至週五；settings 可改為六日制）

## 8. 前台頁面（mobile-first，375px 為主，也要能在 LINE 內建瀏覽器使用）
/login：帳號、密碼；首次登入導向改密碼。
/me/today（newcomer）：頂部顯示第幾天、階段、下一節點日期。區塊一「昨日計畫結算」：逐項顯示昨日 plan.item 文字與預計，旁邊選狀態（依表單題目渲染）；區塊二依表單其餘題目渲染（卡點、學到、明日計畫、最重要、支援）。今天已有日誌則載入可編輯，23:59 前可改；儲存後顯示成功與明日該做的三件事。
/me/history（newcomer）：按日期列表：預警、主管回應狀態與一句話、週回饋。
/manager：卡片＝我部門每位新人：今日計畫（來自昨日日誌）、缺交、open 預警數、逾時。點進 /manager/newcomer/[id]：時間軸，每天一列（昨計畫與狀態並排、卡點、明日計畫、預警、我的回應）；預警旁「回應」按鈕開抽屜，依 manager_response 表單渲染（狀態單選＋一句話），20 秒內可完成。週五顯示「週回饋未填」提醒，/manager/weekly 依 weekly_feedback 表單渲染。
/hr：儀表板：今日交件（應交／已交／缺交／未到時＋缺交名單）、待處理預警、HR 介入清單（逾時未回、需 HR 協助）、近 7 日各部門統計、三指標、新人總覽（到職天數、階段、下一節點、累計預警、回應率、缺交率）、「複製今日一行摘要」按鈕（格式：`9/11 新人日誌｜4/4 已交｜預警 2 筆：A（進度）、B（卡點）｜待主管回應：X｜連結`）。節點到期清單（未來 7 天）。
/hr/newcomer/[id]：90 天總覽、時間軸、節點紀錄表單（notes／outcome）、匯出該員 CSV。
/ceo：與 /hr 相同唯讀，僅儀表板與新人總覽，無操作按鈕。

## 9. 後台頁面（/admin，role ∈ {hr, admin}；規則與設定僅 admin）
/admin/users：列表、新增（帳號、顯示名稱、角色、部門、主管、到職日）、編輯、停用（status=left）、重設密碼；新增新人自動建三筆 milestones。
/admin/departments：CRUD。
/admin/forms：三個範本；/admin/forms/[key]：版本列表（狀態、發布時間、備註）；「建立草稿」；草稿編輯器：題目列表可拖曳排序、新增／編輯抽屜（key、label、type、options、required、help、placeholder、show_if、slot、disabled）、即時預覽（以新人視角渲染，含條件邏輯）、「發布」（跑第 6 節驗證，顯示與上一版差異摘要，填 change_note）。
/admin/rules（admin）：R1／R2／R3／A1 啟用開關與參數；顯示各規則所需 slot 目前綁到哪一題；參數比對值必須存在於該題 options，否則拒存。
/admin/data：submissions 表格（篩選：範本、人、日期、有無預警、來源）；編輯答案（必填原因，寫 audit）；軟刪除（必填原因）；還原；重跑該筆規則；CSV 匯出；CSV 匯入（欄位對映到 slot，用於從 Google Sheet 過渡版搬資料，匯入前預覽前 5 列與預計產生的預警數）。
/admin/settings（admin）：daily_cutoff_time、response_threshold_hours、工作日制、Phase 3 通知設定。
/admin/audit：稽核紀錄唯讀列表，可依人、實體、日期篩選。

## 10. 權限矩陣（`lib/auth/guard.ts` 的唯一真相；測試必須覆蓋）
| 動作 | newcomer | manager | hr | ceo | admin |
|---|---|---|---|---|---|
| 填／改自己的日誌 | ✓ | | | | |
| 看自己的日誌、回應、週回饋 | ✓ | | | | |
| 看新人日誌 | | 同部門 | 全部 | 全部 | 全部 |
| 回應預警、填週回饋 | | 同部門 | 可代填（標註 on_behalf） | | ✓ |
| 名單、部門維護 | | | ✓ | | ✓ |
| 表單草稿、發布 | | | ✓ | | ✓ |
| 規則參數、系統設定 | | | | | ✓ |
| 資料改、刪、匯入、還原 | | | ✓ | | ✓ |
| 匯出 CSV | | 同部門 | ✓ | ✓ | ✓ |
| 稽核紀錄 | | | ✓ | | ✓ |

## 11. 種子資料與固定測試案例（`supabase/seed/`；Vitest fixture 同一份）
departments：工務、採購、設計、信義設計。
profiles：admin「Banson」；hr「HR」；managers 佔位名「工務主任」「採購主管」「設計副主任」「信義總監」；newcomers「Darren」(工務)、「嚴雅齡」(採購)、「謝文心」(設計)、「洪湘庭」(信義設計)，start_date 2026-09-01（示意值，上線改）。
newcomer_daily v1 題目（key／label／type／options／required／show_if／slot）：
1 name 略（填寫者即 user，不設題）
2 r1_status 昨日項目一狀態 single_select [完成,持續中,取消,昨日無此項] required slot=result.item1.status
3 r1_reason 項目一未完成原因 short_text show_if r1_status in [持續中,取消] slot=result.item1.reason
4 r2_status 昨日項目二狀態 single_select 同上 required slot=result.item2.status
5 r2_reason 項目二未完成原因 short_text show_if r2_status in [持續中,取消] slot=result.item2.reason
6 r3_status 昨日項目三狀態 single_select 同上 required slot=result.item3.status
7 r3_reason 項目三未完成原因 short_text show_if r3_status in [持續中,取消] slot=result.item3.reason
8 extra_work 臨時新增工作 short_text slot=result.extra_work
9 blocker 今日卡點 single_select [沒有,有，已找人處理中,有，已解決,有，尚未回報] required slot=result.blocker.status
10 blocker_detail 卡點說明 short_text show_if blocker neq 沒有 slot=result.blocker.detail
11 learned 今日學到一件事 short_text slot=result.learned
12 p1_text 明日項目一 short_text required slot=plan.item1.text
13 p1_expect 明日項目一預計 single_select [完成,跨日] required slot=plan.item1.expect
14 p2_text 明日項目二 short_text slot=plan.item2.text
15 p2_expect 明日項目二預計 single_select [完成,跨日] show_if p2_text not_empty slot=plan.item2.expect
16 p3_text 明日項目三 short_text slot=plan.item3.text
17 p3_expect 明日項目三預計 single_select [完成,跨日] show_if p3_text not_empty slot=plan.item3.expect
18 top 明日最重要的一件事 single_select [項目一,項目二,項目三] required slot=plan.top_priority
19 support 明日需要支援 single_select [不需要,需要] required slot=plan.support.need
20 support_detail 支援對象與內容 short_text show_if support eq 需要 slot=plan.support.detail
manager_response v1：status 處理狀態 single_select [已讀，無需處理,已處理,需 HR 協助] required slot=response.status；comment 一句話回饋 short_text slot=response.comment。（對象新人與對象日誌由 UI 帶入，不是題目。）
weekly_feedback v1：week_start 週起始日 date required slot=weekly.start_date；good 做得好的一件事 short_text required slot=weekly.good；improve 要改的一件事 short_text required slot=weekly.improve；next_focus 下週重點 short_text required slot=weekly.next_focus。
範例日誌（台北時間）：
- 9/2 17:05 Darren：結算全選昨日無此項；卡點=沒有；明日：繼續跟著博凱跑案場/完成、看木作功法百科/跨日、其他博凱交代我的事項/完成；最重要=項目一；支援=不需要。
- 9/2 17:12 嚴雅齡：明日：請款總表移到新表單/完成、裕福門窗報價/完成、鋁門窗宏偉報價/完成；最重要=項目二。
- 9/2 17:20 謝文心：明日：改昨天的圖/完成。
- 9/2 17:30 洪湘庭：明日：宗硯20期3D渲染圖用GPT潤飾/完成、宗硯20期3D渲染圖用Luma潤飾/跨日。
- 9/3 17:01 Darren：完成、持續中、完成；臨時新增=文風19 安排木工維修隱藏門；卡點=沒有；學到=知道哪裡看施工進度；明日：文風19 木工維修敲定/完成、跟主任跑案場/跨日。
- 9/3 17:03 嚴雅齡：持續中(案件利潤表工項明細不確定，已問 Patty)、完成、持續中(宏偉訂金確認中)；卡點=有，已找人處理中；明日：案件利潤表持續更新/跨日、了解各報價單/跨日、宏偉訂金確認/完成；最重要=項目三。
- 9/3 17:06 洪湘庭：完成、持續中、昨日無此項；卡點=有，尚未回報（Luma 免費版有次數限制，只做了 3 張圖）；學到=使用 Luma 聊天功能輔助修圖；明日：宗硯20期渲染圖 Luma 改圖/跨日。
- 9/3 17:23 謝文心：完成、昨日無此項、昨日無此項；臨時新增=深周二路農舍立面；明日：畫深周二路農舍立面/跨日。
- 9/4 09:10 採購主管 回應 嚴雅齡 9/3：已處理「已請 Patty 給工項對照表；宏偉訂金明早追」。
- 9/4 09:20 工務主任 回應 Darren 9/3：已讀，無需處理。
- 9/4 17:00 工務主任 週回饋 Darren（week_start 8/31）：案場紀律好，拍照上傳準時／木工協調要自己先問工班時間／文風19 木工維修獨立收尾。
預期結果（單元測試必須全綠）：
- 嚴雅齡 9/3 → 恰好一筆 R1，detail.items 為項目 1 與 3；無 R2。
- 洪湘庭 9/3 → 恰好一筆 R2；無 R1。
- Darren 9/3、謝文心 9/3 → 零預警（Darren 項目二昨預計「跨日」不觸發；謝文心項目二三「昨日無此項」不觸發）。
- 9/2 四筆 → 零預警（無前一筆）。
- 嚴雅齡 R1 responded_at − created_at ≈ 16.1h，非 late；Darren 的回應不算誤報（無預警）。
- 以假時鐘 9/4 18:00 檢查：洪湘庭 R2 為逾時未回、進 HR 介入清單；以 9/4 12:00 檢查：待回應。
- 以假時鐘 9/4 18:30 檢查缺交：四人皆缺交；9/4 12:00：皆未到時。
- 指標（9/4 18:00）：誤報率 0/1=0%、主管回應率 1/2=50%。

## 12. 專案結構（新增檔案只能落在這些目錄）
app/(auth)/login, app/(front)/me, app/(front)/manager, app/(front)/hr, app/(front)/ceo, app/(admin)/admin, app/api（只放 Route Handlers）
components/ui（shadcn）, components/forms（引擎渲染器）, components/dashboard
lib/auth（guard.ts, session.ts）, lib/db（supabase clients, queries）, lib/forms（schema.ts, slots.ts, validate.ts, resolve.ts）, lib/rules（r1.ts, r2.ts, derived.ts, run.ts）, lib/metrics, lib/time（台北時區工具）
supabase/migrations, supabase/seed
tests/unit, tests/e2e
docs/PLAN.md, docs/DECISIONS.md（每個架構決定一行：日期、決定、理由）, docs/RUNBOOK.md（HR 與 admin 的操作手冊）

## 13. 完成定義（每個 Phase 都適用）
lint／typecheck／unit／e2e 全綠；`.env.example` 更新；migrations 可從空庫一路跑到最新；seed 可重跑（idempotent）；docs/DECISIONS.md 有更新；PR 描述含測試方式與截圖（手機寬度）。
