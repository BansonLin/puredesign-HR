/**
 * Expected results for the §11 fixture (PLAN 4.9.4 alerts table, 4.9.5
 * clocks and metrics). Shared by the unit tests (`rules`, `derived`,
 * `metrics`, `summary`, `fixtures`) and by `seed.ts --verify` (T16 compares
 * the alerts it produced against `EXPECTED_ALERTS`).
 *
 * Instants here are UTC ISO strings (what the database returns); the Taipei
 * times are in the comments. Clocks are `Date` objects so they can be passed
 * straight into `lib/time` / `lib/rules` as `now`.
 */
import { FIXTURE_NEWCOMERS, FIXTURE_START_DATE } from "./fixture";

// ---------------------------------------------------------------------------
// alerts (PLAN 4.9.4)
// ---------------------------------------------------------------------------

export interface ExpectedAlert {
  /** `seq` of the daily log the alert hangs on. */
  log_seq: number;
  username: string;
  rule_key: "R1" | "R2";
  status: "open" | "responded" | "closed";
  /** = the log's `submitted_at` (UTC). */
  created_at: string;
  responded_at: string | null;
  /** `seq` of the manager_response submission, when responded. */
  response_seq: number | null;
  detail: Record<string, unknown>;
}

export const EXPECTED_ALERTS = [
  {
    log_seq: 6, // 嚴雅齡 9/3 17:03
    username: "yen_yaling",
    rule_key: "R1",
    status: "responded",
    created_at: "2026-09-03T09:03:00Z",
    responded_at: "2026-09-04T01:10:00Z", // 9/4 09:10, seq 09
    response_seq: 9,
    detail: {
      items: [
        {
          i: 1,
          plan_text: "請款總表移到新表單",
          status: "持續中",
          reason: "案件利潤表工項明細不確定，已問 Patty",
        },
        {
          i: 3,
          plan_text: "鋁門窗宏偉報價",
          status: "持續中",
          reason: "宏偉訂金確認中",
        },
      ],
    },
  },
  {
    log_seq: 7, // 洪湘庭 9/3 17:06
    username: "hung_hsiangting",
    rule_key: "R2",
    status: "open",
    created_at: "2026-09-03T09:06:00Z",
    responded_at: null,
    response_seq: null,
    detail: { text: "Luma 免費版有次數限制，只做了 3 張圖" },
  },
] as const satisfies readonly ExpectedAlert[];

/** Daily logs (by `seq`) that must produce zero alerts: all of 9/2, Darren 9/3, 謝文心 9/3. */
export const EXPECTED_ALERT_FREE_LOG_SEQS = [1, 2, 3, 4, 5, 8] as const;

/** 嚴雅齡 R1: responded_at − created_at = 16h07m (≈ 16.1h, not late at a 24h threshold). */
export const YEN_R1_RESPONSE_LAG_MS = (16 * 60 + 7) * 60 * 1000;

// ---------------------------------------------------------------------------
// fake clocks (PLAN 4.9.5)
// ---------------------------------------------------------------------------

/** 9/3 18:00 Taipei — one-line summary `4/4 已交｜預警 2 筆｜待主管回應：2`. */
export const CLOCK_0903_1800 = new Date("2026-09-03T10:00:00Z");
/** 9/4 12:00 Taipei — R3: nobody missing yet (未到時); A1: 洪湘庭 R2 still 待回應. */
export const CLOCK_0904_1200 = new Date("2026-09-04T04:00:00Z");
/** 9/4 18:00 Taipei — A1: 洪湘庭 R2 overdue; false-alarm 0/1, response rate 1/2. */
export const CLOCK_0904_1800 = new Date("2026-09-04T10:00:00Z");
/** 9/4 18:30 Taipei — R3: all four newcomers missing for 9/4. */
export const CLOCK_0904_1830 = new Date("2026-09-04T10:30:00Z");

// ---------------------------------------------------------------------------
// derived states (§7 R3 / A1) at each clock
// ---------------------------------------------------------------------------

export const ALL_NEWCOMER_USERNAMES = FIXTURE_NEWCOMERS.map((p) => p.username);

/** R3 for log date 9/4 (cutoff 18:00): `usernames` of newcomers counted as 缺交. */
export const EXPECTED_MISSING_0904 = {
  at_1200: [] as readonly string[],
  at_1830: ALL_NEWCOMER_USERNAMES,
} as const;

/** A1 for 洪湘庭 R2 (created 9/3 17:06, threshold 24h). */
export const EXPECTED_ESCALATION = {
  /** 9/4 12:00 → 18h54m open: 待回應, not in the HR list. */
  at_1200: { overdue: false, hr_intervention: [] as readonly string[] },
  /** 9/4 18:00 → 24h54m open: 逾時未回, in the HR list. */
  at_1800: { overdue: true, hr_intervention: ["hung_hsiangting"] as readonly string[] },
} as const;

// ---------------------------------------------------------------------------
// metrics (§7 definitions) and the one-line summary
// ---------------------------------------------------------------------------

/** At CLOCK_0904_1800 (all responses and the weekly feedback are in). */
export const EXPECTED_METRICS_0904_1800 = {
  /** 誤報率 = 「已讀，無需處理」 responded alerts ÷ responded alerts. Darren's response has no alert. */
  false_alarm: { numerator: 0, denominator: 1, rate: 0 },
  /** 主管回應率 = responded ÷ all alerts. */
  response_rate: { numerator: 1, denominator: 2, rate: 0.5 },
  /** 24h 內回應率: the only response (16h07m) is within the threshold. */
  response_within_threshold: { numerator: 1, denominator: 2, rate: 0.5 },
  /** Late (responded after the threshold) alerts: none. */
  late_alerts: 0,
} as const;

/** `9/3 新人日誌｜4/4 已交｜預警 2 筆：嚴雅齡（進度）、洪湘庭（卡點）｜待主管回應：2｜連結` */
export const EXPECTED_SUMMARY_0903_1800 = {
  date_label: "9/3",
  expected: 4,
  submitted: 4,
  missing: [] as readonly string[],
  alerts: 2,
  alert_lines: ["嚴雅齡（進度）", "洪湘庭（卡點）"] as readonly string[],
  awaiting_response: 2,
} as const;

// ---------------------------------------------------------------------------
// milestones and table row counts (seed --verify)
// ---------------------------------------------------------------------------

/** `milestonesFor(FIXTURE_START_DATE)` (§11: 10/01, 10/31, 11/30). */
export const EXPECTED_MILESTONE_DUE_DATES = {
  start_date: FIXTURE_START_DATE,
  D30: "2026-10-01",
  D60: "2026-10-31",
  D90: "2026-11-30",
} as const;

/**
 * Row counts after a seed run on an empty database. `base` = `--base`;
 * `full` = base + fixture. `submissions` / `alerts` are written by T16
 * (11 = 8 logs + 2 responses + 1 weekly; alerts = `EXPECTED_ALERTS.length`).
 */
export const EXPECTED_ROW_COUNTS = {
  base: {
    departments: 4,
    settings: 4,
    form_templates: 3,
    form_versions: 3,
    profiles: 3,
    milestones: 0,
    submissions: 0,
    alerts: 0,
  },
  full: {
    departments: 4,
    settings: 4,
    form_templates: 3,
    form_versions: 3,
    profiles: 12,
    milestones: 15,
    submissions: 11,
    alerts: 2,
  },
} as const;
