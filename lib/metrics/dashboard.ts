/**
 * `buildHrDashboard` — the ONE assembler behind `/hr` and `/ceo`
 * (CLAUDE.md §8, PLAN T19): 今日交件, 待處理預警, HR 介入清單, 節點到期 and the
 * facts of the one-line summary come out of a single pure call, so both
 * pages (and the copied summary) always show the same numbers.
 *
 * Pure: the page loads the rows (`activeNewcomers()`, `listLogs()`,
 * `listAlertsWithSubmission()`, `listResponsesForSubmissions()`,
 * `listMilestones()`, `getSettings()`), takes `now = new Date()` once, and
 * hands everything in; nothing here touches `lib/db` or a clock, so the unit
 * tests run the §11 fixture through it with the PLAN 4.9.5 fake clocks.
 * Time-based states are delegated to lib/rules/derived.ts (R3 / A1 / HR
 * intervention) and lib/time (Taipei calendar), never compared here directly.
 *
 * Population (PLAN A02): `newcomers` is `activeNewcomers()`. Alerts,
 * responses and milestones of anyone outside it (left / sample, or an
 * unknown id) are dropped from every section. Rows are generic so the page
 * gets its own row types back in the entries; the `Dashboard*` types below
 * are the minimum columns each row needs (`Tables<'…'>` rows satisfy them).
 *
 * Section definitions:
 *   - 今日交件 (`today`): one row per active newcomer whose `logStatus` for
 *     Taipei today is not `n/a` (started, has a `start_date`) — that is 應交;
 *     `submitted` / `missing` / `pending`(未到時) follow §7 R3 with the
 *     `daily_cutoff_time` setting; `missingList` is the 缺交名單.
 *   - 待處理預警 (`pendingAlerts`): every `open` alert (any log date),
 *     oldest first, with its A1 state (`open` within the threshold,
 *     `overdue` past it) and the R1 → 進度 / R2 → 卡點 label.
 *   - HR 介入清單 (`intervention`): `hrInterventionList` (PLAN A04) —
 *     `overdue` open alerts past `response_threshold_hours`, and `needHr`
 *     responses (`response.status = 需 HR 協助`, resolved by the caller through
 *     `bySlot`) within the last 7 Taipei days.
 *   - 節點到期 (`milestones`): pending (`done_at is null`) milestones with
 *     `due_date ∈ [today, today + 7]` (both ends included, PLAN A09) plus the
 *     overdue pending ones (`due_date < today`), which are flagged
 *     `overdue: true` and sort first (due_date ascending puts them there).
 *     Milestones already done are not listed — the list is HR's to-do.
 *   - `summary`: the five facts of the one-line summary (PLAN A13); the page
 *     adds `APP_BASE_URL` and calls `buildDailySummary`.
 */
import { alertRuleLabel, type DailySummaryFacts, type SummaryAlert } from "@/lib/metrics/summary";
import type { Tables } from "@/lib/db/types";
import {
  alertState,
  hrInterventionList,
  logStatus,
  type HrInterventionList,
  type LogStatus,
  type ResponseLike,
} from "@/lib/rules/derived";
import {
  addDaysTo,
  calendarDaysBetween,
  taipeiDateOf,
  toInstant,
  type DateString,
  type Instant,
} from "@/lib/time";

/** 節點到期清單 looks this many days ahead of today, today and the last day included (§8, A09). */
export const MILESTONE_DUE_WINDOW_DAYS = 7;

const MS_PER_HOUR = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// input rows (minimum columns; `Tables<'…'>` rows satisfy them)
// ---------------------------------------------------------------------------

/** `activeNewcomers()` row. */
export type DashboardNewcomer = Pick<
  Tables<"profiles">,
  "id" | "display_name" | "status" | "start_date"
>;

/** `listLogs()` row (newcomer_daily, non-deleted); only today's rows are used. */
export type DashboardLog = Pick<Tables<"submissions">, "user_id" | "log_date">;

/** `listAlertsWithSubmission()` row (inner join on non-deleted submissions, PLAN A05). */
export type DashboardAlert = Pick<
  Tables<"alerts">,
  "id" | "submission_id" | "user_id" | "rule_key" | "status" | "created_at" | "responded_at"
> & {
  submission: Pick<Tables<"submissions">, "id" | "user_id" | "log_date">;
};

/**
 * `listResponsesForSubmissions()` row with `response.status` already resolved
 * by the caller (`bySlot(version.questions, row.answers)["response.status"]`),
 * exactly as lib/rules/derived.ts expects.
 */
export type DashboardResponse = ResponseLike;

/** `listMilestones()` row. */
export type DashboardMilestone = Pick<
  Tables<"milestones">,
  "id" | "user_id" | "kind" | "due_date" | "done_at"
>;

/** The two settings rows the dashboard needs (validated by the caller). */
export interface DashboardSettings {
  /** `settings.daily_cutoff_time`, `HH:mm` Taipei (default `18:00`). */
  daily_cutoff_time: string;
  /** `settings.response_threshold_hours` (default 24). */
  response_threshold_hours: number;
}

export interface HrDashboardData<
  N extends DashboardNewcomer = DashboardNewcomer,
  L extends DashboardLog = DashboardLog,
  A extends DashboardAlert = DashboardAlert,
  R extends DashboardResponse = DashboardResponse,
  M extends DashboardMilestone = DashboardMilestone,
> {
  /** The population: `activeNewcomers()` (PLAN A02). */
  newcomers: readonly N[];
  /** Daily logs; rows whose `log_date` is not Taipei today are ignored. */
  logs: readonly L[];
  /** Alerts of non-deleted logs, all statuses (closed ones are ignored). */
  alerts: readonly A[];
  /** Manager responses with `response_status` resolved (see `DashboardResponse`). */
  responses: readonly R[];
  /** Milestones of the population (done ones are ignored). */
  milestones: readonly M[];
  settings: DashboardSettings;
}

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

/** R3 state of one expected newcomer for today (never `n/a`: those are not 應交). */
export type TodayLogStatus = Exclude<LogStatus, "n/a">;

export interface TodayRow<N extends DashboardNewcomer> {
  newcomer: N;
  status: TodayLogStatus;
}

/** 今日交件: 應交／已交／缺交／未到時 ＋ 缺交名單 (§8). */
export interface TodaySubmissions<N extends DashboardNewcomer> {
  /** Taipei today. */
  date: DateString;
  /** 應交 = `rows.length` = submitted + missing + pending. */
  expected: number;
  submitted: number;
  missing: number;
  /** 未到時: no log yet and the cutoff has not passed. */
  pending: number;
  /** One row per expected newcomer, in population order. */
  rows: TodayRow<N>[];
  /** 缺交名單, in population order. */
  missingList: N[];
  /** 未到時名單, in population order. */
  pendingList: N[];
}

/** One `open` alert awaiting the manager (待處理預警). */
export interface PendingAlertEntry<N extends DashboardNewcomer, A extends DashboardAlert> {
  alert: A;
  newcomer: N;
  /** A1 state: `overdue` once `now − created_at` exceeds the threshold (strict `>`). */
  state: "open" | "overdue";
  /** 進度 / 卡點 (`alertRuleLabel`). */
  label: string;
  /** `log_date` of the log the alert hangs on. */
  log_date: string | null;
  /** Hours since `created_at`, for display (「已 N 小時未回」). */
  openHours: number;
}

/** One pending milestone due within the window, or overdue. */
export interface MilestoneDueEntry<N extends DashboardNewcomer, M extends DashboardMilestone> {
  milestone: M;
  newcomer: N;
  /** `due_date − today` in calendar days: `0` today, negative when overdue. */
  daysUntil: number;
  /** `true` when `due_date < today` and still not done (「逾期」, sorted first). */
  overdue: boolean;
  /** `today − due_date` when overdue, else `0` (「逾期 N 天」). */
  overdueDays: number;
}

export interface MilestonesDue<N extends DashboardNewcomer, M extends DashboardMilestone> {
  /** Today (window start; overdue entries fall before it). */
  windowStart: DateString;
  /** `today + MILESTONE_DUE_WINDOW_DAYS`, included. */
  windowEnd: DateString;
  /** Overdue first, then by `due_date`; same date in population order. */
  entries: MilestoneDueEntry<N, M>[];
}

export interface HrDashboard<
  N extends DashboardNewcomer = DashboardNewcomer,
  A extends DashboardAlert = DashboardAlert,
  R extends DashboardResponse = DashboardResponse,
  M extends DashboardMilestone = DashboardMilestone,
> {
  /** Taipei today, derived from `now`. */
  today: TodaySubmissions<N>;
  /** 待處理預警: every `open` alert of the population, oldest first. */
  pendingAlerts: PendingAlertEntry<N, A>[];
  /** HR 介入清單 (PLAN A04). */
  intervention: HrInterventionList<N, A, R>;
  /** 節點到期清單 (§8, PLAN A09). */
  milestones: MilestonesDue<N, M>;
  /** Facts of the one-line summary (PLAN A13); add `baseUrl` and call `buildDailySummary`. */
  summary: DailySummaryFacts;
}

// ---------------------------------------------------------------------------
// assembler
// ---------------------------------------------------------------------------

function millis(instant: Instant): number {
  return toInstant(instant).getTime();
}

function compareRuleKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Population lookup: only `active` rows, in input order (PLAN A02). */
function activeById<N extends DashboardNewcomer>(newcomers: readonly N[]): Map<string, N> {
  const byId = new Map<string, N>();
  for (const newcomer of newcomers) {
    if (newcomer.status === "active") byId.set(newcomer.id, newcomer);
  }
  return byId;
}

function buildToday<N extends DashboardNewcomer, L extends DashboardLog>(input: {
  population: ReadonlyMap<string, N>;
  logs: readonly L[];
  date: DateString;
  cutoff: string;
  now: Instant;
}): TodaySubmissions<N> {
  const { population, logs, date, cutoff, now } = input;
  const loggedToday = new Set<string>();
  for (const log of logs) {
    if (log.log_date === date) loggedToday.add(log.user_id);
  }
  const rows: TodayRow<N>[] = [];
  for (const newcomer of population.values()) {
    const status = logStatus({
      newcomer,
      date,
      hasLog: loggedToday.has(newcomer.id),
      cutoff,
      now,
    });
    if (status === "n/a") continue;
    rows.push({ newcomer, status });
  }
  const pick = (status: TodayLogStatus) =>
    rows.filter((row) => row.status === status).map((row) => row.newcomer);
  const missingList = pick("missing");
  const pendingList = pick("pending");
  return {
    date,
    expected: rows.length,
    submitted: rows.length - missingList.length - pendingList.length,
    missing: missingList.length,
    pending: pendingList.length,
    rows,
    missingList,
    pendingList,
  };
}

function buildPendingAlerts<N extends DashboardNewcomer, A extends DashboardAlert>(input: {
  population: ReadonlyMap<string, N>;
  alerts: readonly A[];
  thresholdHours: number;
  now: Instant;
}): PendingAlertEntry<N, A>[] {
  const { population, alerts, thresholdHours, now } = input;
  const nowMs = millis(now);
  const entries: PendingAlertEntry<N, A>[] = [];
  for (const alert of alerts) {
    if (alert.status !== "open") continue;
    const newcomer = population.get(alert.user_id);
    if (!newcomer) continue;
    const state = alertState({ alert, thresholdHours, now });
    if (state !== "open" && state !== "overdue") continue;
    entries.push({
      alert,
      newcomer,
      state,
      label: alertRuleLabel(alert.rule_key),
      log_date: alert.submission.log_date,
      openHours: (nowMs - millis(alert.created_at)) / MS_PER_HOUR,
    });
  }
  entries.sort(
    (a, b) =>
      millis(a.alert.created_at) - millis(b.alert.created_at) ||
      compareRuleKey(a.alert.rule_key, b.alert.rule_key),
  );
  return entries;
}

function buildMilestonesDue<N extends DashboardNewcomer, M extends DashboardMilestone>(input: {
  population: ReadonlyMap<string, N>;
  milestones: readonly M[];
  today: DateString;
}): MilestonesDue<N, M> {
  const { population, milestones, today } = input;
  const windowEnd = addDaysTo(today, MILESTONE_DUE_WINDOW_DAYS);
  const order = new Map([...population.keys()].map((id, index) => [id, index] as const));
  const entries: MilestoneDueEntry<N, M>[] = [];
  for (const milestone of milestones) {
    if (milestone.done_at !== null) continue;
    const newcomer = population.get(milestone.user_id);
    if (!newcomer) continue;
    const daysUntil = calendarDaysBetween(today, milestone.due_date);
    if (daysUntil > MILESTONE_DUE_WINDOW_DAYS) continue;
    entries.push({
      milestone,
      newcomer,
      daysUntil,
      overdue: daysUntil < 0,
      overdueDays: daysUntil < 0 ? -daysUntil : 0,
    });
  }
  entries.sort(
    (a, b) =>
      a.daysUntil - b.daysUntil ||
      (order.get(a.newcomer.id) ?? 0) - (order.get(b.newcomer.id) ?? 0) ||
      compareRuleKey(a.milestone.kind, b.milestone.kind),
  );
  return { windowStart: today, windowEnd, entries };
}

/** Alerts of today's logs that are not closed, oldest first (summary 「預警 N 筆」). */
function todayAlerts<N extends DashboardNewcomer, A extends DashboardAlert>(input: {
  population: ReadonlyMap<string, N>;
  alerts: readonly A[];
  date: DateString;
}): SummaryAlert[] {
  const { population, alerts, date } = input;
  return alerts
    .filter((alert) => alert.status !== "closed" && alert.submission.log_date === date)
    .flatMap((alert) => {
      const newcomer = population.get(alert.user_id);
      return newcomer ? [{ alert, newcomer }] : [];
    })
    .sort(
      (a, b) =>
        millis(a.alert.created_at) - millis(b.alert.created_at) ||
        compareRuleKey(a.alert.rule_key, b.alert.rule_key),
    )
    .map(({ alert, newcomer }) => ({
      display_name: newcomer.display_name,
      rule_key: alert.rule_key,
    }));
}

/**
 * Assemble the HR / CEO dashboard for `now`. See the module comment for what
 * each section means. `now` is taken once by the page (`new Date()`) and
 * passed in; the same `now` drives every section, so the numbers agree.
 */
export function buildHrDashboard<
  N extends DashboardNewcomer,
  L extends DashboardLog,
  A extends DashboardAlert,
  R extends DashboardResponse,
  M extends DashboardMilestone,
>(input: { now: Instant; data: HrDashboardData<N, L, A, R, M> }): HrDashboard<N, A, R, M> {
  const { now, data } = input;
  const today = taipeiDateOf(now);
  const population = activeById(data.newcomers);
  const cutoff = data.settings.daily_cutoff_time;
  const thresholdHours = data.settings.response_threshold_hours;

  const todaySection = buildToday({ population, logs: data.logs, date: today, cutoff, now });
  const pendingAlerts = buildPendingAlerts({
    population,
    alerts: data.alerts,
    thresholdHours,
    now,
  });
  const intervention = hrInterventionList({
    newcomers: [...population.values()],
    alerts: data.alerts,
    responses: data.responses,
    now,
    thresholdHours,
  });
  const milestones = buildMilestonesDue({ population, milestones: data.milestones, today });

  return {
    today: todaySection,
    pendingAlerts,
    intervention,
    milestones,
    summary: {
      date: today,
      submitted: todaySection.submitted,
      expected: todaySection.expected,
      todayAlerts: todayAlerts({ population, alerts: data.alerts, date: today }),
      openCount: pendingAlerts.length,
    },
  };
}
