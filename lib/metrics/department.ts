/**
 * 近 7 日各部門統計 (CLAUDE.md §8, PLAN T23, A08(d)): one row per
 * department — 應交, 已交, 缺交, 預警數, 已回應數, 回應率 — over the last
 * seven Taipei calendar days, today included (`[today − 6, today]`).
 *
 * Pure: the page loads `departments`, `activeNewcomers()`, `listLogs()`
 * (the window, or everything), `listAlertsWithSubmission()` and the two
 * settings, takes `now = new Date()` once, and hands them in.
 *
 * Definitions, per newcomer of the population (A02: `active` only; `left` /
 * `sample` and anyone without `department_id` are not in any row), then
 * summed per department:
 *   - 應交 = workdays (`settings.workweek`) in
 *     `[max(start_date, windowStart), countedThrough]`, where
 *     `countedThrough` is today once the cutoff has passed, else yesterday
 *     (A08(d) 「今天未到 cutoff 不計」; same helper as 缺交率);
 *   - 已交 = the newcomer's logs dated inside that same range (a log written
 *     today before the cutoff shows up after it);
 *   - 缺交 = max(0, 應交 − 已交) — a log on a non-workday never goes negative;
 *   - 預警數 = A08(b) population alerts (`open` / `responded`, log not
 *     deleted) of the newcomer whose `created_at` falls on a Taipei day in
 *     `[windowStart, today]`;
 *   - 已回應數 = those with `status = responded`; 回應率 = 已回應 ÷ 預警數.
 * Departments without newcomers still get a row (all zeros, `rate: null`).
 * Rows follow `departments.sort_order`, then `name`.
 */
import type { Tables } from "@/lib/db/types";
import {
  alertPopulation,
  countedThrough,
  ratio,
  type MetricAlert,
  type Ratio,
} from "@/lib/metrics/rates";
import {
  addDaysTo,
  calendarDaysBetween,
  taipeiDateOf,
  workdaysBetween,
  type DateString,
  type Instant,
  type Workweek,
} from "@/lib/time";

/** The window covers this many Taipei calendar days, today included (A08(d)). */
export const DEPARTMENT_STATS_WINDOW_DAYS = 7;

/** `departments` row. */
export type DepartmentRow = Pick<Tables<"departments">, "id" | "name" | "sort_order">;

/** `activeNewcomers()` row. */
export type DepartmentNewcomer = Pick<
  Tables<"profiles">,
  "id" | "status" | "start_date" | "department_id"
>;

/** `listLogs()` row (newcomer_daily, non-deleted). */
export type DepartmentLog = Pick<Tables<"submissions">, "user_id" | "log_date">;

/** `listAlertsWithSubmission()` row. */
export type DepartmentAlert = MetricAlert;

export interface DepartmentSettings {
  /** `settings.daily_cutoff_time`, `HH:mm` Taipei. */
  daily_cutoff_time: string;
  /** `settings.workweek`. */
  workweek: Workweek;
}

export interface DepartmentStatsRow<D extends DepartmentRow = DepartmentRow> {
  department: D;
  /** Active newcomers of the department (population size). */
  newcomers: number;
  /** 應交. */
  expected: number;
  /** 已交. */
  submitted: number;
  /** 缺交 = max(0, 應交 − 已交). */
  missing: number;
  /** 預警數 (created within the window). */
  alerts: number;
  /** 已回應數. */
  responded: number;
  /** 回應率 = 已回應 ÷ 預警數 (`rate: null` when there are no alerts). */
  responseRate: Ratio;
}

export interface DepartmentStats7d<D extends DepartmentRow = DepartmentRow> {
  /** `today − (DEPARTMENT_STATS_WINDOW_DAYS − 1)`. */
  windowStart: DateString;
  /** Taipei today. */
  windowEnd: DateString;
  /** Last day counted as 應交 (today after the cutoff, else yesterday). */
  countedThrough: DateString;
  rows: DepartmentStatsRow<D>[];
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function laterOf(a: DateString, b: DateString): DateString {
  return calendarDaysBetween(a, b) >= 0 ? b : a;
}

function inRange(date: DateString, from: DateString, to: DateString): boolean {
  return calendarDaysBetween(from, date) >= 0 && calendarDaysBetween(date, to) >= 0;
}

export function departmentStats7d<
  D extends DepartmentRow,
  N extends DepartmentNewcomer,
  L extends DepartmentLog,
  A extends DepartmentAlert,
>(input: {
  departments: readonly D[];
  /** The population: `activeNewcomers()` (A02). */
  newcomers: readonly N[];
  logs: readonly L[];
  alerts: readonly A[];
  settings: DepartmentSettings;
  now: Instant;
}): DepartmentStats7d<D> {
  const { departments, newcomers, logs, alerts, settings, now } = input;
  const today = taipeiDateOf(now);
  const windowStart = addDaysTo(today, -(DEPARTMENT_STATS_WINDOW_DAYS - 1));
  const through = countedThrough(now, settings.daily_cutoff_time);

  // population: active newcomers with a department, grouped by department id
  const departmentOf = new Map<string, string>();
  const byDepartment = new Map<string, N[]>();
  for (const newcomer of newcomers) {
    if (newcomer.status !== "active" || newcomer.department_id === null) continue;
    departmentOf.set(newcomer.id, newcomer.department_id);
    const list = byDepartment.get(newcomer.department_id) ?? [];
    list.push(newcomer);
    byDepartment.set(newcomer.department_id, list);
  }

  // logs per newcomer, only those dated inside [windowStart, through]
  const logsByUser = new Map<string, DateString[]>();
  for (const log of logs) {
    if (log.log_date === null || !departmentOf.has(log.user_id)) continue;
    if (!inRange(log.log_date, windowStart, through)) continue;
    const list = logsByUser.get(log.user_id) ?? [];
    list.push(log.log_date);
    logsByUser.set(log.user_id, list);
  }

  // alerts per department, created on a Taipei day inside [windowStart, today]
  const alertsByDepartment = new Map<string, { total: number; responded: number }>();
  for (const alert of alertPopulation(alerts)) {
    const departmentId = departmentOf.get(alert.user_id);
    if (departmentId === undefined) continue;
    if (!inRange(taipeiDateOf(alert.created_at), windowStart, today)) continue;
    const counter = alertsByDepartment.get(departmentId) ?? { total: 0, responded: 0 };
    counter.total += 1;
    if (alert.status === "responded") counter.responded += 1;
    alertsByDepartment.set(departmentId, counter);
  }

  const rows: DepartmentStatsRow<D>[] = [...departments]
    .sort((a, b) => a.sort_order - b.sort_order || compareText(a.name, b.name))
    .map((department) => {
      let expected = 0;
      let submitted = 0;
      let missing = 0;
      const members = byDepartment.get(department.id) ?? [];
      for (const newcomer of members) {
        if (newcomer.start_date === null) continue;
        const from = laterOf(newcomer.start_date, windowStart);
        const workdays = workdaysBetween(from, through, settings.workweek);
        const own = (logsByUser.get(newcomer.id) ?? []).filter((date) =>
          inRange(date, from, through),
        ).length;
        expected += workdays;
        submitted += own;
        missing += Math.max(0, workdays - own);
      }
      const counter = alertsByDepartment.get(department.id) ?? { total: 0, responded: 0 };
      return {
        department,
        newcomers: members.length,
        expected,
        submitted,
        missing,
        alerts: counter.total,
        responded: counter.responded,
        responseRate: ratio(counter.responded, counter.total),
      };
    });

  return { windowStart, windowEnd: today, countedThrough: through, rows };
}
