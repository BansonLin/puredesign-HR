/**
 * The three HR metrics of CLAUDE.md §7 plus the per-newcomer 缺交率
 * (PLAN T23, A02, A08). Every function is pure: rows in, numbers out, `now`
 * injected. No `lib/db`, no clock, no `answers` parsing — the caller resolves
 * `response.status` through `bySlot` (same contract as lib/rules/derived.ts).
 *
 * Alert population (A08(b)): only alerts with `status ∈ {open, responded}`
 * whose daily log is not soft-deleted. `closed` alerts (resubmitted,
 * submission_deleted …) are not facts about manager behaviour and are
 * dropped everywhere. The first line of defence against soft-deleted logs is
 * `listAlertsWithSubmission()` (PLAN A05 (1)); the `submission.deleted_at`
 * check below is the second, and it is a real one — that query selects the
 * column, so the value these functions see is the row's own (D-51).
 *
 * Newcomer population (A02): the alert rates count every alert fact,
 * including those of newcomers who have since left; only `sample` accounts
 * (test / demo, `e2e_fresh`) are excluded, when `profiles` is given. 缺交率
 * is per newcomer and only defined for `active` ones (A08(c)).
 *
 * Denominators (A08(e), spelled out because they differ from the intuition):
 *   - 誤報率 `falsePositiveRate` = responded alerts whose response has
 *     `response.status == 已讀，無需處理` ÷ responded alerts;
 *   - 主管回應率 `responseRate` = responded ÷ (open + responded);
 *   - 24h 內回應率 `within24hRate` = responded with
 *     `responded_at − created_at ≤ 24h` ÷ (open + responded) — the SAME
 *     denominator as `responseRate` (open alerts count against it), and the
 *     24 hours are fixed (`WITHIN_HOURS`), not `response_threshold_hours`.
 * A ratio with denominator 0 has `rate: null` (shown as 「—」), never `NaN`.
 */
import type { Enums, Tables } from "@/lib/db/types";
import { RESPONSE_STATUS_NO_ACTION } from "@/lib/rules/constants";
import { alertState } from "@/lib/rules/derived";
import {
  addDaysTo,
  calendarDaysBetween,
  isPastCutoff,
  taipeiDateOf,
  toInstant,
  workdaysBetween,
  type DateString,
  type Instant,
  type Workweek,
} from "@/lib/time";

/** Fixed window of 24h 內回應率 (A08(e)); independent of `response_threshold_hours`. */
export const WITHIN_HOURS = 24;

const MS_PER_HOUR = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// shared shapes
// ---------------------------------------------------------------------------

/** `numerator ÷ denominator`; `rate` is `null` when the denominator is 0. */
export interface Ratio {
  numerator: number;
  denominator: number;
  rate: number | null;
}

export function ratio(numerator: number, denominator: number): Ratio {
  return {
    numerator,
    denominator,
    rate: denominator === 0 ? null : numerator / denominator,
  };
}

/** Alert columns the rates need (`listAlertsWithSubmission()` rows satisfy this). */
export type MetricAlert = Pick<
  Tables<"alerts">,
  "user_id" | "status" | "created_at" | "responded_at" | "response_submission_id"
> & {
  /**
   * A non-null `deleted_at` drops the alert. `listAlertsWithSubmission()`
   * always selects the column (D-51), so this is a second gate on the real
   * value; it stays optional for callers that assemble rows themselves.
   */
  submission?: { deleted_at?: string | null } | null;
};

/**
 * A manager_response submission with `response.status` resolved by the
 * caller (`bySlot(version.questions, row.answers)["response.status"]`).
 * Matched to alerts through `alerts.response_submission_id`.
 */
export type MetricResponse = Pick<Tables<"submissions">, "id"> & {
  response_status: string | null;
};

/** Profile columns used to drop `sample` accounts (A02). */
export type MetricProfile = Pick<Tables<"profiles">, "id" | "status">;

function millis(instant: Instant): number {
  return toInstant(instant).getTime();
}

/**
 * The alert population of A08(b): `status ∈ {open, responded}`, log not
 * soft-deleted, and — when `profiles` is given — not owned by a `sample`
 * account. Alerts of unknown or `left` users are kept (A02: 事實全量計).
 */
export function alertPopulation<A extends MetricAlert>(
  alerts: readonly A[],
  opts: { profiles?: readonly MetricProfile[] } = {},
): A[] {
  const sampleIds = new Set<string>();
  for (const profile of opts.profiles ?? []) {
    if (profile.status === "sample") sampleIds.add(profile.id);
  }
  return alerts.filter((alert) => {
    if (alert.status !== "open" && alert.status !== "responded") return false;
    if (alert.submission && alert.submission.deleted_at) return false;
    return !sampleIds.has(alert.user_id);
  });
}

// ---------------------------------------------------------------------------
// the three §7 metrics
// ---------------------------------------------------------------------------

export interface AlertRatesInput<A extends MetricAlert = MetricAlert> {
  alerts: readonly A[];
  /** Only needed by `falsePositiveRate`; ignored by the other two. */
  responses?: readonly MetricResponse[];
  /** Optional: drops alerts of `sample` accounts (A02). */
  profiles?: readonly MetricProfile[];
}

/**
 * 誤報率 = responded alerts whose response's `response.status` is
 * `已讀，無需處理` ÷ responded alerts (§7). Only alerts count: a response on a
 * log without alerts (Darren 9/3) is not a false positive of anything.
 * The response is looked up by `response_submission_id`; a responded alert
 * whose response row is missing stays in the denominator only.
 * Comparison is trim-then-exact (A06).
 */
export function falsePositiveRate<A extends MetricAlert>(input: AlertRatesInput<A>): Ratio {
  const statusById = new Map<string, string | null>();
  for (const response of input.responses ?? []) {
    statusById.set(response.id, response.response_status);
  }
  let responded = 0;
  let noAction = 0;
  for (const alert of alertPopulation(input.alerts, { profiles: input.profiles })) {
    if (alert.status !== "responded") continue;
    responded += 1;
    const status =
      alert.response_submission_id === null
        ? null
        : (statusById.get(alert.response_submission_id) ?? null);
    if (status !== null && status.trim() === RESPONSE_STATUS_NO_ACTION) noAction += 1;
  }
  return ratio(noAction, responded);
}

/** 主管回應率 = responded ÷ (open + responded) (§7; population per A08(b)). */
export function responseRate<A extends MetricAlert>(input: AlertRatesInput<A>): Ratio {
  const population = alertPopulation(input.alerts, { profiles: input.profiles });
  const responded = population.filter((alert) => alert.status === "responded").length;
  return ratio(responded, population.length);
}

/** `true` when the alert was responded within `WITHIN_HOURS` (inclusive `≤`). */
export function respondedWithin24h(alert: MetricAlert): boolean {
  if (alert.status !== "responded" || alert.responded_at === null) return false;
  return millis(alert.responded_at) - millis(alert.created_at) <= WITHIN_HOURS * MS_PER_HOUR;
}

/**
 * 24h 內回應率 = responded with `responded_at − created_at ≤ 24h` ÷
 * (open + responded). Denominator = the same population as `responseRate`
 * (A08(e)): an alert still open counts as "not within 24h". The window is
 * the fixed `WITHIN_HOURS`, not `settings.response_threshold_hours`.
 */
export function within24hRate<A extends MetricAlert>(input: AlertRatesInput<A>): Ratio {
  const population = alertPopulation(input.alerts, { profiles: input.profiles });
  const within = population.filter(respondedWithin24h).length;
  return ratio(within, population.length);
}

export interface AlertRates {
  /** 誤報率 (§7). */
  falsePositive: Ratio;
  /** 主管回應率 (§7). */
  response: Ratio;
  /** 24h 內回應率 (A08(e)). */
  within24h: Ratio;
  /** Responded after `response_threshold_hours` (§7 A1 `late`, statistics only). */
  late: number;
  /** Size of the alert population (open + responded). */
  total: number;
}

/**
 * All three metrics (and the A1 `late` count) from one pass over the same
 * population, for the HR dashboard's 三指標 block.
 */
export function alertRates<A extends MetricAlert>(
  input: AlertRatesInput<A> & {
    /** `settings.response_threshold_hours`, for the A1 `late` count. */
    thresholdHours: number;
    now: Instant;
  },
): AlertRates {
  const population = alertPopulation(input.alerts, { profiles: input.profiles });
  const late = population.filter(
    (alert) =>
      alertState({ alert, thresholdHours: input.thresholdHours, now: input.now }) ===
      "responded_late",
  ).length;
  return {
    falsePositive: falsePositiveRate({ ...input, alerts: population }),
    response: responseRate({ ...input, alerts: population }),
    within24h: within24hRate({ ...input, alerts: population }),
    late,
    total: population.length,
  };
}

// ---------------------------------------------------------------------------
// 缺交率 (§7)
// ---------------------------------------------------------------------------

/**
 * The last calendar day that counts as 應交 at `now`: Taipei today once the
 * cutoff has passed (`isPastCutoff`, `>=`), otherwise yesterday. Shared by
 * `missingRate` and `departmentStats7d` so both stop at the same day.
 */
export function countedThrough(now: Instant, cutoff: string): DateString {
  const today = taipeiDateOf(now);
  return isPastCutoff(today, cutoff, now) ? today : addDaysTo(today, -1);
}

/** Newcomer columns 缺交率 needs (`Tables<'profiles'>` satisfies this). */
export type MissingRateNewcomer = {
  status: Enums<"profile_status">;
  start_date: string | null;
};

/** A daily log row; only `log_date` is read (`listLogs()` rows satisfy this). */
export type MetricLog = Pick<Tables<"submissions">, "log_date">;

export interface MissingRateInput {
  newcomer: MissingRateNewcomer;
  /** This newcomer's non-deleted daily logs (any date; filtered here). */
  logs: readonly MetricLog[];
  now: Instant;
  /** `settings.daily_cutoff_time`, `HH:mm` Taipei. */
  cutoff: string;
  /** `settings.workweek`. */
  workweek: Workweek;
}

/** 缺交率 as a ratio: `numerator` = missing workdays, `denominator` = expected workdays. */
export interface MissingRate extends Ratio {
  /** Logs counted (dated within `[start_date, countedThrough]`). */
  logs: number;
  /** Last day counted (see `countedThrough`). */
  countedThrough: DateString;
}

/**
 * 缺交率 = 1 − 累計日誌數 ÷ 到職至今工作日數 (§7), as
 * `(workdays − logs) ÷ workdays`, where workdays =
 * `workdaysBetween(start_date, countedThrough(now, cutoff), workweek)` —
 * today is only counted once its cutoff has passed. Logs are counted when
 * their `log_date` lies within that same range, so a log written today
 * before the cutoff appears after it; a log on a non-workday can only bring
 * the missing count down to 0, never below.
 *
 * Returns `null` (not a number) when the rate is undefined: the newcomer is
 * not `active` (A08(c)), has no `start_date`, or the workday count is 0
 * (started today before the cutoff, or on a weekend).
 */
export function missingRate(input: MissingRateInput): MissingRate | null {
  const { newcomer, logs, now, cutoff, workweek } = input;
  if (newcomer.status !== "active" || newcomer.start_date === null) return null;
  const through = countedThrough(now, cutoff);
  const workdays = workdaysBetween(newcomer.start_date, through, workweek);
  if (workdays === 0) return null;
  const start = newcomer.start_date;
  const counted = logs.filter(
    (log) =>
      log.log_date !== null &&
      calendarDaysBetween(start, log.log_date) >= 0 &&
      calendarDaysBetween(log.log_date, through) >= 0,
  ).length;
  const missing = Math.max(0, workdays - counted);
  return { ...ratio(missing, workdays), logs: counted, countedThrough: through };
}
