/**
 * Derived (read-time) states of §7: R3 missing / pending, A1 overdue / late,
 * and the two-part HR intervention list (PLAN A04). Nothing here is stored;
 * every function is pure and takes `now` (§3 「時間型狀態一律在讀取時推導」).
 *
 * Only `lib/time`, `lib/rules/constants` and types are imported (PLAN T12):
 * no `lib/db`, no `server-only`, so the unit tests and the pages share the
 * exact same code path. Callers hand in rows they already loaded:
 *   - newcomers: `activeNewcomers()` (PLAN A02, the only population), or any
 *     profile — non-active profiles come back as `'n/a'` / are skipped;
 *   - alerts: `listAlertsWithSubmission()` rows (soft-deleted logs excluded
 *     there, PLAN A05);
 *   - responses: manager_response submissions with `response.status` already
 *     resolved through `bySlot` (this module does not read `answers`).
 */
import type { Enums, Tables } from "@/lib/db/types";
import { RESPONSE_STATUS_NEED_HR } from "@/lib/rules/constants";
import {
  calendarDaysBetween,
  isPastCutoff,
  taipeiDateOf,
  type DateString,
  type Instant,
} from "@/lib/time";

/** Calendar-day window of the「需 HR 協助」segment (PLAN A04: 近 7 日, Taipei days, today included). */
export const HR_NEED_HELP_WINDOW_DAYS = 7;

const MS_PER_HOUR = 60 * 60 * 1000;

function toMillis(instant: Instant): number {
  const ms = (instant instanceof Date ? instant : new Date(instant)).getTime();
  if (Number.isNaN(ms)) {
    throw new RangeError(`Invalid instant: ${String(instant)}`);
  }
  return ms;
}

// ---------------------------------------------------------------------------
// R3 — daily log status (§7 R3, PLAN A02)
// ---------------------------------------------------------------------------

/** The profile columns R3 needs (`Tables<'profiles'>` satisfies this). */
export type NewcomerLike = {
  id: string;
  status: Enums<"profile_status">;
  start_date: string | null;
};

/**
 * - `submitted`: a (non-deleted) daily log exists for `date`;
 * - `missing`: no log and `now` is at or after (`>=`) the cutoff of `date`;
 * - `pending`: no log and the cutoff has not been reached (「未到時」);
 * - `n/a`: not counted at all — the profile is not `active` (left / sample),
 *   or `date` is before `start_date`, or `start_date` is not set.
 */
export type LogStatus = "submitted" | "missing" | "pending" | "n/a";

export function logStatus(input: {
  newcomer: NewcomerLike;
  date: DateString;
  hasLog: boolean;
  /** `settings.daily_cutoff_time`, `HH:mm` Taipei. */
  cutoff: string;
  now: Instant;
}): LogStatus {
  const { newcomer, date, hasLog, cutoff, now } = input;
  if (newcomer.status !== "active") return "n/a";
  if (newcomer.start_date === null) return "n/a";
  if (calendarDaysBetween(newcomer.start_date, date) < 0) return "n/a";
  if (hasLog) return "submitted";
  return isPastCutoff(date, cutoff, now) ? "missing" : "pending";
}

/**
 * Newcomers (in the given order) whose log for `date` is `missing` (R3 缺交名單).
 * `logsByUserId` is any `has(userId)` lookup — a `Set` of user ids or a
 * `Map` keyed by user id — of the newcomers who have a log for `date`.
 */
export function listMissing<N extends NewcomerLike>(input: {
  newcomers: readonly N[];
  date: DateString;
  logsByUserId: { has(userId: string): boolean };
  cutoff: string;
  now: Instant;
}): N[] {
  const { newcomers, date, logsByUserId, cutoff, now } = input;
  return newcomers.filter(
    (newcomer) =>
      logStatus({
        newcomer,
        date,
        hasLog: logsByUserId.has(newcomer.id),
        cutoff,
        now,
      }) === "missing",
  );
}

// ---------------------------------------------------------------------------
// A1 — alert escalation (§7 A1)
// ---------------------------------------------------------------------------

/** The alert columns A1 needs (`Tables<'alerts'>` satisfies this). */
export type AlertLike = {
  status: Enums<"alert_status">;
  created_at: string;
  responded_at: string | null;
};

/**
 * - `open`: waiting for the manager, within the threshold (待回應);
 * - `overdue`: still open and `now − created_at` is strictly greater than
 *   `thresholdHours` (逾時未回, HR intervention list);
 * - `responded`: answered within the threshold;
 * - `responded_late`: answered, but `responded_at − created_at` is strictly
 *   greater than the threshold (statistics only, §7 A1);
 * - `closed`: closed (resubmitted / submission_deleted …), never escalates.
 */
export type AlertState =
  | "open"
  | "overdue"
  | "responded"
  | "responded_late"
  | "closed";

export function alertState(input: {
  alert: AlertLike;
  /** `settings.response_threshold_hours`. */
  thresholdHours: number;
  now: Instant;
}): AlertState {
  const { alert, thresholdHours, now } = input;
  const thresholdMs = thresholdHours * MS_PER_HOUR;
  const createdMs = toMillis(alert.created_at);
  switch (alert.status) {
    case "closed":
      return "closed";
    case "responded": {
      // responded_at is null only on an inconsistent row; treat it as on time.
      if (alert.responded_at === null) return "responded";
      return toMillis(alert.responded_at) - createdMs > thresholdMs
        ? "responded_late"
        : "responded";
    }
    case "open":
      return toMillis(now) - createdMs > thresholdMs ? "overdue" : "open";
  }
}

// ---------------------------------------------------------------------------
// HR intervention list (§8 「HR 介入清單（逾時未回、需 HR 協助）」, PLAN A04)
// ---------------------------------------------------------------------------

/** An open/responded alert row plus the newcomer it belongs to (`alerts.user_id`). */
export type InterventionAlertLike = AlertLike & Pick<Tables<"alerts">, "user_id">;

/**
 * A manager_response submission with its `response.status` slot value
 * resolved by the caller (`bySlot(questions, answers)['response.status']`).
 * `target_user_id` is the newcomer; `target_submission_id` the daily log
 * (which may carry no alert at all — PLAN A04 「含無預警日誌的回應」).
 */
export type ResponseLike = Pick<
  Tables<"submissions">,
  "user_id" | "target_user_id" | "target_submission_id"
> & {
  submitted_at: string;
  response_status: string | null;
};

export interface OverdueEntry<N extends NewcomerLike, A extends InterventionAlertLike> {
  alert: A;
  newcomer: N;
  /** Hours since `created_at`, for display (「已 N 小時未回」). */
  openHours: number;
}

export interface NeedHrEntry<N extends NewcomerLike, R extends ResponseLike> {
  response: R;
  newcomer: N;
}

export interface HrInterventionList<
  N extends NewcomerLike,
  A extends InterventionAlertLike,
  R extends ResponseLike,
> {
  /** 逾時未回: `open` alerts of active newcomers past the threshold, oldest first. */
  overdue: OverdueEntry<N, A>[];
  /** 需 HR 協助: responses with `response.status === RESPONSE_STATUS_NEED_HR` within the window, newest first. */
  needHr: NeedHrEntry<N, R>[];
}

/**
 * Both segments are derived on read (PLAN A04): an alert leaves `overdue` as
 * soon as the manager responds; a response leaves `needHr` when it falls out
 * of the `windowDays` calendar-day window (Taipei days, today included, so
 * `windowDays = 7` means today and the six days before it).
 *
 * `newcomers` is the population (PLAN A02: `activeNewcomers()`); alerts and
 * responses whose newcomer is not in it — left / sample profiles, or a
 * response without `target_user_id` — are dropped.
 */
export function hrInterventionList<
  N extends NewcomerLike,
  A extends InterventionAlertLike,
  R extends ResponseLike,
>(input: {
  newcomers: readonly N[];
  alerts: readonly A[];
  responses: readonly R[];
  now: Instant;
  thresholdHours: number;
  windowDays?: number;
}): HrInterventionList<N, A, R> {
  const {
    newcomers,
    alerts,
    responses,
    now,
    thresholdHours,
    windowDays = HR_NEED_HELP_WINDOW_DAYS,
  } = input;
  const nowMs = toMillis(now);
  const today = taipeiDateOf(now);
  const byId = new Map<string, N>();
  for (const newcomer of newcomers) {
    if (newcomer.status === "active") byId.set(newcomer.id, newcomer);
  }

  const overdue: OverdueEntry<N, A>[] = [];
  for (const alert of alerts) {
    const newcomer = byId.get(alert.user_id);
    if (!newcomer) continue;
    if (alertState({ alert, thresholdHours, now }) !== "overdue") continue;
    overdue.push({
      alert,
      newcomer,
      openHours: (nowMs - toMillis(alert.created_at)) / MS_PER_HOUR,
    });
  }
  overdue.sort((a, b) => toMillis(a.alert.created_at) - toMillis(b.alert.created_at));

  const needHr: NeedHrEntry<N, R>[] = [];
  for (const response of responses) {
    if (response.response_status === null) continue;
    if (response.response_status.trim() !== RESPONSE_STATUS_NEED_HR) continue;
    if (response.target_user_id === null) continue;
    const newcomer = byId.get(response.target_user_id);
    if (!newcomer) continue;
    const ageDays = calendarDaysBetween(taipeiDateOf(response.submitted_at), today);
    if (ageDays < 0 || ageDays >= windowDays) continue;
    needHr.push({ response, newcomer });
  }
  needHr.sort((a, b) => toMillis(b.response.submitted_at) - toMillis(a.response.submitted_at));

  return { overdue, needHr };
}
