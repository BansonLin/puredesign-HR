/**
 * `02_fixture` seed data (PLAN 4.9.1/4.9.4): the four managers, four
 * newcomers, the `e2e_fresh` sample account, and every §11 example
 * submission (8 daily logs, 2 manager responses, 1 weekly feedback).
 *
 * Pure data. Natural keys only (username / running number `seq`); `seed.ts`
 * maps them to UUIDs at run time (PLAN 4.9.7). Instants are written as
 * Taipei `+08:00` ISO strings; the UTC equivalents are in PLAN 4.9.4.
 *
 * `answers` use the v1 question keys and always carry every key of the
 * version (A11: hidden / unanswered → `null`). Values §11 does not state are
 * marked `// assumed` (PLAN 4.9.4: 9/2 results all "昨日無此項", `blocker`
 * "沒有", `support` "不需要", unspecified `top` → "項目一").
 *
 * T04 seeds the profiles and milestones; the submissions below are written
 * by T16 through `runRules + applyAlertChanges` (they are already complete
 * here so the unit tests can use them now).
 */
import type {
  ManagerResponseKey,
  NewcomerDailyKey,
  SeedProfile,
  WeeklyFeedbackKey,
} from "./base";

/** Every newcomer starts on this date (§11; "示意值，上線改"). */
export const FIXTURE_START_DATE = "2026-09-01";

/**
 * The fixture day that `--anchor <date>` maps onto (PLAN 4.9.6): the "9/3"
 * logs move to the anchor date and every other date shifts by the same
 * number of days.
 */
export const FIXTURE_ANCHOR_DATE = "2026-09-03";

// ---------------------------------------------------------------------------
// profiles (PLAN 4.9.4, A01/A02/A03)
// ---------------------------------------------------------------------------

export const FIXTURE_MANAGERS = [
  {
    id: "00000002-0000-4000-8000-000000000004",
    username: "mgr_construction",
    display_name: "工務主任",
    role: "manager",
    department: "工務",
    manager_username: null,
    start_date: null,
    status: "active",
    must_change_password: false,
  },
  {
    id: "00000002-0000-4000-8000-000000000005",
    username: "mgr_procurement",
    display_name: "採購主管",
    role: "manager",
    department: "採購",
    manager_username: null,
    start_date: null,
    status: "active",
    must_change_password: false,
  },
  {
    id: "00000002-0000-4000-8000-000000000006",
    username: "mgr_design",
    display_name: "設計副主任",
    role: "manager",
    department: "設計",
    manager_username: null,
    start_date: null,
    status: "active",
    must_change_password: false,
  },
  {
    id: "00000002-0000-4000-8000-000000000007",
    username: "mgr_xinyi",
    display_name: "信義總監",
    role: "manager",
    department: "信義設計",
    manager_username: null,
    start_date: null,
    status: "active",
    must_change_password: false,
  },
] as const satisfies readonly SeedProfile[];

export const FIXTURE_NEWCOMERS = [
  {
    id: "00000002-0000-4000-8000-000000000008",
    username: "darren",
    display_name: "Darren",
    role: "newcomer",
    department: "工務",
    manager_username: "mgr_construction",
    start_date: FIXTURE_START_DATE,
    status: "active",
    must_change_password: false,
  },
  {
    id: "00000002-0000-4000-8000-000000000009",
    username: "yen_yaling",
    display_name: "嚴雅齡",
    role: "newcomer",
    department: "採購",
    manager_username: "mgr_procurement",
    start_date: FIXTURE_START_DATE,
    status: "active",
    must_change_password: false,
  },
  {
    id: "00000002-0000-4000-8000-000000000010",
    username: "hsieh_wenhsin",
    display_name: "謝文心",
    role: "newcomer",
    department: "設計",
    manager_username: "mgr_design",
    start_date: FIXTURE_START_DATE,
    status: "active",
    must_change_password: false,
  },
  {
    id: "00000002-0000-4000-8000-000000000011",
    username: "hung_hsiangting",
    display_name: "洪湘庭",
    role: "newcomer",
    department: "信義設計",
    manager_username: "mgr_xinyi",
    start_date: FIXTURE_START_DATE,
    status: "active",
    must_change_password: false,
  },
] as const satisfies readonly SeedProfile[];

/**
 * First-login e2e account (A01/A02): can log in, must change password on
 * first login, `status='sample'` so it never enters `activeNewcomers()`.
 * Seed resets its password and flag on every run.
 */
export const E2E_FRESH_PROFILE = {
  id: "00000002-0000-4000-8000-000000000012",
  username: "e2e_fresh",
  display_name: "測試新人",
  role: "newcomer",
  department: "工務",
  manager_username: "mgr_construction",
  start_date: FIXTURE_START_DATE,
  status: "sample",
  must_change_password: true,
} as const satisfies SeedProfile;

/** All fixture accounts in insert order (managers before the newcomers that reference them). */
export const FIXTURE_PROFILES = [
  ...FIXTURE_MANAGERS,
  ...FIXTURE_NEWCOMERS,
  E2E_FRESH_PROFILE,
] as const satisfies readonly SeedProfile[];

export type FixtureUsername = (typeof FIXTURE_PROFILES)[number]["username"];
export type FixtureNewcomerUsername = (typeof FIXTURE_NEWCOMERS)[number]["username"];
export type FixtureManagerUsername = (typeof FIXTURE_MANAGERS)[number]["username"];

// ---------------------------------------------------------------------------
// submissions (§11; PLAN 4.9.4 table, seq 01–11)
// ---------------------------------------------------------------------------

export type DailyAnswers = Readonly<Record<NewcomerDailyKey, string | null>>;
export type ResponseAnswers = Readonly<Record<ManagerResponseKey, string | null>>;
export type WeeklyAnswers = Readonly<Record<WeeklyFeedbackKey, string | null>>;

export interface FixtureDailyLog {
  seq: number;
  username: FixtureNewcomerUsername;
  log_date: string;
  /** Taipei `+08:00` ISO date-time. */
  submitted_at: string;
  answers: DailyAnswers;
}

export interface FixtureResponse {
  seq: number;
  username: FixtureManagerUsername;
  target_username: FixtureNewcomerUsername;
  /** `seq` of the daily log this response targets. */
  target_log_seq: number;
  submitted_at: string;
  answers: ResponseAnswers;
}

export interface FixtureWeekly {
  seq: number;
  username: FixtureManagerUsername;
  target_username: FixtureNewcomerUsername;
  week_start: string;
  submitted_at: string;
  answers: WeeklyAnswers;
}

export const FIXTURE_DAILY_LOGS = [
  {
    seq: 1,
    username: "darren",
    log_date: "2026-09-02",
    submitted_at: "2026-09-02T17:05:00+08:00",
    answers: {
      r1_status: "昨日無此項",
      r1_reason: null,
      r2_status: "昨日無此項",
      r2_reason: null,
      r3_status: "昨日無此項",
      r3_reason: null,
      extra_work: null, // assumed
      blocker: "沒有",
      blocker_detail: null,
      learned: null, // assumed
      p1_text: "繼續跟著博凱跑案場",
      p1_expect: "完成",
      p2_text: "看木作功法百科",
      p2_expect: "跨日",
      p3_text: "其他博凱交代我的事項",
      p3_expect: "完成",
      top: "項目一",
      support: "不需要",
      support_detail: null,
    },
  },
  {
    seq: 2,
    username: "yen_yaling",
    log_date: "2026-09-02",
    submitted_at: "2026-09-02T17:12:00+08:00",
    answers: {
      r1_status: "昨日無此項", // assumed
      r1_reason: null,
      r2_status: "昨日無此項", // assumed
      r2_reason: null,
      r3_status: "昨日無此項", // assumed
      r3_reason: null,
      extra_work: null, // assumed
      blocker: "沒有", // assumed
      blocker_detail: null,
      learned: null, // assumed
      p1_text: "請款總表移到新表單",
      p1_expect: "完成",
      p2_text: "裕福門窗報價",
      p2_expect: "完成",
      p3_text: "鋁門窗宏偉報價",
      p3_expect: "完成",
      top: "項目二",
      support: "不需要", // assumed
      support_detail: null,
    },
  },
  {
    seq: 3,
    username: "hsieh_wenhsin",
    log_date: "2026-09-02",
    submitted_at: "2026-09-02T17:20:00+08:00",
    answers: {
      r1_status: "昨日無此項", // assumed
      r1_reason: null,
      r2_status: "昨日無此項", // assumed
      r2_reason: null,
      r3_status: "昨日無此項", // assumed
      r3_reason: null,
      extra_work: null, // assumed
      blocker: "沒有", // assumed
      blocker_detail: null,
      learned: null, // assumed
      p1_text: "改昨天的圖",
      p1_expect: "完成",
      p2_text: null,
      p2_expect: null,
      p3_text: null,
      p3_expect: null,
      top: "項目一", // assumed
      support: "不需要", // assumed
      support_detail: null,
    },
  },
  {
    seq: 4,
    username: "hung_hsiangting",
    log_date: "2026-09-02",
    submitted_at: "2026-09-02T17:30:00+08:00",
    answers: {
      r1_status: "昨日無此項", // assumed
      r1_reason: null,
      r2_status: "昨日無此項", // assumed
      r2_reason: null,
      r3_status: "昨日無此項", // assumed
      r3_reason: null,
      extra_work: null, // assumed
      blocker: "沒有", // assumed
      blocker_detail: null,
      learned: null, // assumed
      p1_text: "宗硯20期3D渲染圖用GPT潤飾",
      p1_expect: "完成",
      p2_text: "宗硯20期3D渲染圖用Luma潤飾",
      p2_expect: "跨日",
      p3_text: null,
      p3_expect: null,
      top: "項目一", // assumed
      support: "不需要", // assumed
      support_detail: null,
    },
  },
  {
    seq: 5,
    username: "darren",
    log_date: "2026-09-03",
    submitted_at: "2026-09-03T17:01:00+08:00",
    answers: {
      r1_status: "完成",
      r1_reason: null,
      r2_status: "持續中",
      r2_reason: null, // assumed (visible but not required; §11 gives no reason)
      r3_status: "完成",
      r3_reason: null,
      extra_work: "文風19 安排木工維修隱藏門",
      blocker: "沒有",
      blocker_detail: null,
      learned: "知道哪裡看施工進度",
      p1_text: "文風19 木工維修敲定",
      p1_expect: "完成",
      p2_text: "跟主任跑案場",
      p2_expect: "跨日",
      p3_text: null,
      p3_expect: null,
      top: "項目一", // assumed
      support: "不需要", // assumed
      support_detail: null,
    },
  },
  {
    seq: 6,
    username: "yen_yaling",
    log_date: "2026-09-03",
    submitted_at: "2026-09-03T17:03:00+08:00",
    answers: {
      r1_status: "持續中",
      r1_reason: "案件利潤表工項明細不確定，已問 Patty",
      r2_status: "完成",
      r2_reason: null,
      r3_status: "持續中",
      r3_reason: "宏偉訂金確認中",
      extra_work: null, // assumed
      blocker: "有，已找人處理中",
      blocker_detail: null, // PLAN 4.9.4: stored null for this log
      learned: null, // assumed
      p1_text: "案件利潤表持續更新",
      p1_expect: "跨日",
      p2_text: "了解各報價單",
      p2_expect: "跨日",
      p3_text: "宏偉訂金確認",
      p3_expect: "完成",
      top: "項目三",
      support: "不需要", // assumed
      support_detail: null,
    },
  },
  {
    seq: 7,
    username: "hung_hsiangting",
    log_date: "2026-09-03",
    submitted_at: "2026-09-03T17:06:00+08:00",
    answers: {
      r1_status: "完成",
      r1_reason: null,
      r2_status: "持續中",
      r2_reason: null, // assumed (visible but not required; §11 gives no reason)
      r3_status: "昨日無此項",
      r3_reason: null,
      extra_work: null, // assumed
      blocker: "有，尚未回報",
      blocker_detail: "Luma 免費版有次數限制，只做了 3 張圖",
      learned: "使用 Luma 聊天功能輔助修圖",
      p1_text: "宗硯20期渲染圖 Luma 改圖",
      p1_expect: "跨日",
      p2_text: null,
      p2_expect: null,
      p3_text: null,
      p3_expect: null,
      top: "項目一", // assumed
      support: "不需要", // assumed
      support_detail: null,
    },
  },
  {
    seq: 8,
    username: "hsieh_wenhsin",
    log_date: "2026-09-03",
    submitted_at: "2026-09-03T17:23:00+08:00",
    answers: {
      r1_status: "完成",
      r1_reason: null,
      r2_status: "昨日無此項",
      r2_reason: null,
      r3_status: "昨日無此項",
      r3_reason: null,
      extra_work: "深周二路農舍立面",
      blocker: "沒有", // assumed
      blocker_detail: null,
      learned: null, // assumed
      p1_text: "畫深周二路農舍立面",
      p1_expect: "跨日",
      p2_text: null,
      p2_expect: null,
      p3_text: null,
      p3_expect: null,
      top: "項目一", // assumed
      support: "不需要", // assumed
      support_detail: null,
    },
  },
] as const satisfies readonly FixtureDailyLog[];

export const FIXTURE_RESPONSES = [
  {
    seq: 9,
    username: "mgr_procurement",
    target_username: "yen_yaling",
    target_log_seq: 6,
    submitted_at: "2026-09-04T09:10:00+08:00",
    answers: {
      status: "已處理",
      comment: "已請 Patty 給工項對照表；宏偉訂金明早追",
    },
  },
  {
    seq: 10,
    username: "mgr_construction",
    target_username: "darren",
    target_log_seq: 5,
    submitted_at: "2026-09-04T09:20:00+08:00",
    answers: {
      status: "已讀，無需處理",
      comment: null,
    },
  },
] as const satisfies readonly FixtureResponse[];

export const FIXTURE_WEEKLY_FEEDBACK = [
  {
    seq: 11,
    username: "mgr_construction",
    target_username: "darren",
    week_start: "2026-08-31",
    submitted_at: "2026-09-04T17:00:00+08:00",
    answers: {
      week_start: "2026-08-31",
      good: "案場紀律好，拍照上傳準時",
      improve: "木工協調要自己先問工班時間",
      next_focus: "文風19 木工維修獨立收尾",
    },
  },
] as const satisfies readonly FixtureWeekly[];
