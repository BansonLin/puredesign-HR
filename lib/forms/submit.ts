/**
 * Daily-log submit pipeline, pure part (PLAN T14; CLAUDE.md §6 / §7 / §8),
 * plus the manager-response counterpart `prepareResponse` (PLAN T18) and the
 * weekly-feedback counterpart `prepareWeeklyFeedback` / `weeklyReminders`
 * (PLAN T22) further down.
 *
 * `prepareDailyLog` turns one newcomer's raw form data into everything the
 * database write needs — the Taipei `log_date`, the normalized `answers`,
 * the `submitted_at` / `updated_at` instants and the alert plan — without
 * touching the database. The Server Action (app/(front)/me/today/actions.ts)
 * and the seed (T16) load the rows, call this, then persist through
 * `insertDailyLog` / `updateDailyLog` and `applyAlertChanges`
 * (lib/db/queries/*). This module imports no `lib/db/*` and no `server-only`
 * so unit tests can run it as-is.
 *
 * Steps, in order (the first failure returns `{ ok: false, errors }`):
 *   1. `log_date = taipeiDateOf(now)` (§0: log-date is a Taipei calendar date).
 *   2. An `existingToday` whose `log_date` is before today is a past log
 *      (§8: editable until 23:59 of its own day) → `_form: 已超過可修改時間`.
 *   3. Parse the active version (and the previous log's version) questions.
 *   4. `validateAnswers(activeQuestions, rawAnswers)` → per-question errors.
 *   5. Rules by slot: `bySlot(active, normalized)` vs
 *      `bySlot(previousVersion, previousLog.answers)` → `runRules` →
 *      `reconcile(existingToday.alerts, drafts, now)` → `alertPlan`.
 *
 * Instants: a first submit gets `submitted_at = now` (and `insertDailyLog`
 * writes `updated_at = submitted_at`); a resubmit keeps the original
 * `submitted_at` and reports `updated_at = now` for the caller's own use —
 * the column itself is maintained by the DB trigger on the update path
 * (`DailyLogUpdate` has no `updated_at`). `reconcile` receives
 * `now` in both cases, which equals `submitted_at` on the first submit — so a
 * brand-new alert's `created_at` is the log's `submitted_at` (§11 「≈16.1h」)
 * and an alert re-opened by a resubmit is stamped with the resubmit time
 * (A10 「created_at=now」).
 */
import { canRespond, type Actor, type NewcomerRef } from "@/lib/auth/policy";
import { parseQuestions, type Answers, type Question } from "@/lib/forms/schema";
import { bySlot } from "@/lib/forms/resolve";
import { validateAnswers } from "@/lib/forms/validate";
import type { RulesSettings } from "@/lib/rules/constants";
import { reconcile, runRules } from "@/lib/rules/run";
import type { ExistingAlertLike, ReconcileResult } from "@/lib/rules/types";
import {
  isDateString,
  isFriday,
  taipeiDateOf,
  toInstant,
  weekStartMonday,
  type DateString,
  type Instant,
} from "@/lib/time";

/** The signed-in newcomer (`Tables<'profiles'>` satisfies this). */
export interface SubmitActor {
  id: string;
}

/** A form version as stored: `questions` is raw jsonb (`Tables<'form_versions'>` satisfies this). */
export interface VersionLike {
  id: string;
  questions: unknown;
}

/** The columns of a daily-log row this pipeline reads (`Tables<'submissions'>` satisfies this). */
export interface DailyLogLike {
  id: string;
  user_id: string;
  form_version_id: string;
  log_date: string | null;
  /** UTC ISO string as returned by the database. */
  submitted_at: string;
  answers: unknown;
}

/** Today's existing log together with EVERY `alerts` row of it (all statuses, A10). */
export type ExistingDailyLog<E extends ExistingAlertLike> = DailyLogLike & {
  alerts: readonly E[];
};

export interface PrepareDailyLogInput<E extends ExistingAlertLike> {
  /** The submit instant (the Server Action passes `new Date()`; the seed passes the fixture's `submitted_at`). */
  now: Instant;
  actor: SubmitActor;
  /** `newcomer_daily`'s active version — always this one, even on a resubmit (§6). */
  activeVersion: VersionLike;
  /** `getLogByDate(actor.id, taipeiDateOf(now))` plus its alerts, or null for a first submit. */
  existingToday: ExistingDailyLog<E> | null;
  /** `getPreviousLog(actor.id, taipeiDateOf(now))`: the latest non-deleted log before today, or null. */
  previousLog: DailyLogLike | null;
  /** `getVersionById(previousLog.form_version_id)`; required whenever `previousLog` is given. */
  previousVersion: VersionLike | null;
  /** FormData entries (visible questions only) or any `{ key: value }` object. */
  rawAnswers: Readonly<Record<string, unknown>> | null | undefined;
  /** Validated `settings.rules` (`parseRulesSettings`). */
  settings: RulesSettings;
}

/** Key of the form-level error (not tied to a question); shown above the form. */
export const FORM_ERROR_KEY = "_form";

export const ERROR_PAST_LOG = "已超過可修改時間";
export const ERROR_ACTIVE_VERSION_INVALID = "目前的日誌表單設定有誤，請聯絡人資";
export const ERROR_PREVIOUS_VERSION_MISSING = "找不到前一筆日誌的表單版本，請聯絡人資";
export const ERROR_LOG_NOT_OWN = "這筆日誌不屬於你";

export interface PreparedDailyLog<E extends ExistingAlertLike> {
  ok: true;
  /** `actor.id` — the submissions.user_id to write. */
  user_id: string;
  /** `activeVersion.id` — also on a resubmit (§6: always the active version). */
  form_version_id: string;
  /** Taipei calendar date of `now`. */
  log_date: string;
  /** Every key of the active version; hidden / empty → null (A11). */
  answers: Answers;
  /** UTC ISO. First submit: `now`; resubmit: the existing row's value, unchanged. */
  submitted_at: string;
  /**
   * UTC ISO; always `now`. Written to the row only on a first submit
   * (`insertDailyLog`, where it equals `submitted_at`); on the update path the
   * DB trigger `submissions_set_updated_at` is authoritative and this value is
   * informational (it is also the `now` `reconcile` used).
   */
  updated_at: string;
  /** null for a first submit; the existing row's id on a resubmit. */
  existing_id: string | null;
  /** `reconcile` output for `applyAlertChanges`; `now` used = `updated_at`. */
  alertPlan: ReconcileResult<E>;
}

export interface PrepareDailyLogFailure {
  ok: false;
  /** Question key → reason, plus `_form` for errors not tied to a question. All Traditional Chinese. */
  errors: Record<string, string>;
}

export type PrepareDailyLogResult<E extends ExistingAlertLike> =
  | PreparedDailyLog<E>
  | PrepareDailyLogFailure;

function formError(message: string): PrepareDailyLogFailure {
  return { ok: false, errors: { [FORM_ERROR_KEY]: message } };
}

function questionsOf(version: VersionLike): readonly Question[] | null {
  const parsed = parseQuestions(version.questions);
  return parsed.ok ? parsed.questions : null;
}

function answersOf(log: DailyLogLike): Readonly<Record<string, unknown>> | null {
  const { answers } = log;
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) return null;
  return answers as Readonly<Record<string, unknown>>;
}

export function prepareDailyLog<E extends ExistingAlertLike>(
  input: PrepareDailyLogInput<E>,
): PrepareDailyLogResult<E> {
  const {
    now,
    actor,
    activeVersion,
    existingToday,
    previousLog,
    previousVersion,
    rawAnswers,
    settings,
  } = input;

  const at = toInstant(now).toISOString();
  const logDate = taipeiDateOf(now);

  if (existingToday) {
    if (existingToday.user_id !== actor.id) return formError(ERROR_LOG_NOT_OWN);
    if (existingToday.log_date !== logDate) return formError(ERROR_PAST_LOG);
  }

  const activeQuestions = questionsOf(activeVersion);
  if (!activeQuestions) return formError(ERROR_ACTIVE_VERSION_INVALID);

  let previousQuestions: readonly Question[] | null = null;
  if (previousLog) {
    if (previousLog.user_id !== actor.id) return formError(ERROR_LOG_NOT_OWN);
    if (!previousVersion || previousVersion.id !== previousLog.form_version_id) {
      return formError(ERROR_PREVIOUS_VERSION_MISSING);
    }
    previousQuestions = questionsOf(previousVersion);
    if (!previousQuestions) return formError(ERROR_PREVIOUS_VERSION_MISSING);
  }

  const validation = validateAnswers(activeQuestions, rawAnswers);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const drafts = runRules({
    current: bySlot(activeQuestions, validation.normalized),
    previous:
      previousLog && previousQuestions
        ? bySlot(previousQuestions, answersOf(previousLog))
        : null,
    settings,
  });

  const alertPlan = reconcile<E>({
    existing: existingToday?.alerts ?? [],
    drafts,
    now: at,
  });

  return {
    ok: true,
    user_id: actor.id,
    form_version_id: activeVersion.id,
    log_date: logDate,
    answers: validation.normalized,
    submitted_at: existingToday ? existingToday.submitted_at : at,
    updated_at: at,
    existing_id: existingToday?.id ?? null,
    alertPlan,
  };
}

// ---------------------------------------------------------------------------
// Manager response (PLAN T18; CLAUDE.md §7 「主管回應」, §10 row 4)
// ---------------------------------------------------------------------------

/**
 * `prepareResponse` is the pure part of the manager-response Server Action
 * (app/(front)/manager/newcomer/[id]/actions.ts). Given the actor, the
 * newcomer the page is on, the daily log looked up by the client-supplied
 * `target_submission_id`, the `manager_response` active version, the actor's
 * existing response to that log (if any) and EVERY alert row of the log, it
 * decides, without touching the database:
 *   1. §10 row 4 through `canRespond` (manager → same department; hr / admin
 *      → allowed with `on_behalf`; ceo / newcomer / left target → refused);
 *   2. the target log must exist, be a daily log and belong to THAT newcomer
 *      (the client's `target_user_id` is never trusted — `target_user_id` is
 *      taken from the log);
 *   3. `validateAnswers(activeQuestions, rawAnswers)` → per-question errors;
 *   4. the alert plan: every `open` alert of the log becomes `responded`
 *      with `responded_at = now`; `responded` and `closed` rows are untouched
 *      (§7). A log without alerts still gets a response (§11: 工務主任 responds
 *      to Darren 9/3) with an empty plan.
 *
 * Re-sending: the same responder on the same log updates their existing row
 * (`existing_id`) and `submitted_at` becomes the re-send instant (`now`) —
 * unlike a daily-log resubmit. A response's `submitted_at` only feeds the
 * A04 「需 HR 協助」 7-day window (`hrInterventionList`) and ordering, so a
 * re-send that changes the status to 「需 HR 協助」 must enter the HR list
 * from the moment it was actually sent; `alerts.responded_at` is stamped by
 * `markAlertsResponded` on `open` rows only and is never reset. A different
 * responder gets their own row.
 *
 * `alertPlan` is the pure statement of §7 (open → responded, others untouched);
 * the Server Action passes `alertPlan.respond` ids to `markAlertsResponded`,
 * which additionally keeps `status = 'open'` in its WHERE so a concurrent
 * responder cannot overwrite the first stamp.
 *
 * `on_behalf` is not persisted in Phase 1: display derives it from the
 * responder's role (DECISIONS D-35).
 */
export interface ResponseTargetLike {
  id: string;
  template_key: string;
  /** The newcomer the log belongs to. */
  user_id: string;
  deleted_at: string | null;
}

/** The actor's existing response to the same log (natural key `(user_id, target_submission_id)`). */
export interface ExistingResponseLike {
  id: string;
}

export interface PrepareResponseInput<E extends ExistingAlertLike> {
  /** The submit instant (`new Date()` in the Server Action). */
  now: Instant;
  actor: Actor;
  /** The newcomer of the page (`requireNewcomerAccess`). */
  newcomer: NewcomerRef;
  /** The daily log found by the client-supplied `target_submission_id`, or null when none. */
  targetLog: ResponseTargetLike | null;
  /** `manager_response`'s active version. */
  activeVersion: VersionLike;
  /** The actor's own non-deleted response to `targetLog`, or null (first response). */
  existingResponse: ExistingResponseLike | null;
  /** Every `alerts` row of `targetLog`, all statuses. */
  alerts: readonly E[];
  /** FormData entries (visible questions only) or any `{ key: value }` object. */
  rawAnswers: Readonly<Record<string, unknown>> | null | undefined;
}

export const ERROR_RESPOND_FORBIDDEN = "您沒有權限回應這位新人";
export const ERROR_TARGET_LOG_NOT_FOUND = "找不到要回應的日誌";
export const ERROR_RESPONSE_VERSION_INVALID = "目前的回應表單設定有誤，請聯絡人資";

export type PrepareResponseFailureCode = "forbidden" | "target" | "version" | "validation";

export interface PrepareResponseFailure {
  ok: false;
  /** `forbidden` → the Server Action answers 403; the others are shown in the form. */
  code: PrepareResponseFailureCode;
  errors: Record<string, string>;
}

export interface ResponseAlertPlan<E extends ExistingAlertLike> {
  /** `open` rows → `responded`, `responded_at = respondedAt`, `response_submission_id` = the saved response. */
  respond: E[];
  /** `responded` / `closed` rows: no write (§7). */
  untouched: E[];
}

export interface PreparedResponse<E extends ExistingAlertLike> {
  ok: true;
  /** hr / admin acting in place of the department manager (§10). */
  on_behalf: boolean;
  /** `actor.id` — submissions.user_id. */
  user_id: string;
  /** `targetLog.user_id` — never the client's value. */
  target_user_id: string;
  target_submission_id: string;
  /** `activeVersion.id` — also on a re-send (§6). */
  form_version_id: string;
  /** Every key of the active version; hidden / empty → null (A11). */
  answers: Answers;
  /** UTC ISO; always `now` — a re-send is a new submission instant (A04 window starts here). */
  submitted_at: string;
  /** UTC ISO; `now`. Written on insert; the DB trigger maintains it on update. */
  updated_at: string;
  /** null for a first response; the existing row's id on a re-send. */
  existing_id: string | null;
  /** UTC ISO; `now` — the `responded_at` stamped on the open alerts. */
  responded_at: string;
  alertPlan: ResponseAlertPlan<E>;
}

export type PrepareResponseResult<E extends ExistingAlertLike> =
  | PreparedResponse<E>
  | PrepareResponseFailure;

function responseFailure(code: PrepareResponseFailureCode, message: string): PrepareResponseFailure {
  return { ok: false, code, errors: { [FORM_ERROR_KEY]: message } };
}

export function prepareResponse<E extends ExistingAlertLike>(
  input: PrepareResponseInput<E>,
): PrepareResponseResult<E> {
  const { now, actor, newcomer, targetLog, activeVersion, existingResponse, alerts, rawAnswers } = input;

  const decision = canRespond(actor, newcomer);
  if (!decision.allowed) return responseFailure("forbidden", ERROR_RESPOND_FORBIDDEN);

  if (
    !targetLog ||
    targetLog.template_key !== "newcomer_daily" ||
    targetLog.deleted_at !== null ||
    targetLog.user_id !== newcomer.id
  ) {
    return responseFailure("target", ERROR_TARGET_LOG_NOT_FOUND);
  }

  const activeQuestions = questionsOf(activeVersion);
  if (!activeQuestions) return responseFailure("version", ERROR_RESPONSE_VERSION_INVALID);

  const validation = validateAnswers(activeQuestions, rawAnswers);
  if (!validation.ok) return { ok: false, code: "validation", errors: validation.errors };

  const at = toInstant(now).toISOString();
  const alertPlan: ResponseAlertPlan<E> = { respond: [], untouched: [] };
  for (const alert of alerts) {
    if (alert.status === "open") alertPlan.respond.push(alert);
    else alertPlan.untouched.push(alert);
  }

  return {
    ok: true,
    on_behalf: decision.on_behalf,
    user_id: actor.id,
    target_user_id: targetLog.user_id,
    target_submission_id: targetLog.id,
    form_version_id: activeVersion.id,
    answers: validation.normalized,
    submitted_at: at,
    updated_at: at,
    existing_id: existingResponse?.id ?? null,
    responded_at: at,
    alertPlan,
  };
}

/** The columns of a response row `ownResponseAnswers` reads (`Tables<'submissions'>` satisfies this). */
export interface ResponseRowLike {
  /** The responder. */
  user_id: string;
  target_submission_id: string | null;
  answers: unknown;
}

/**
 * The actor's own answers on one daily log — the drawer's edit mode
 * (`initialAnswers`). Finds the row with the natural key
 * `(user_id = actorId, target_submission_id = logId)` and coerces its jsonb
 * `answers` to `Answers` (non-string values → null, non-object → no answers).
 * Returns null when the actor has not responded to that log.
 */
export function ownResponseAnswers(
  responses: readonly ResponseRowLike[],
  actorId: string,
  logId: string,
): Answers | null {
  const own = responses.find((r) => r.user_id === actorId && r.target_submission_id === logId);
  if (!own) return null;
  const { answers: raw } = own;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const answers: Answers = {};
  for (const [key, value] of Object.entries(raw)) answers[key] = typeof value === "string" ? value : null;
  return answers;
}

// ---------------------------------------------------------------------------
// Weekly feedback (PLAN T22; CLAUDE.md §8 /manager/weekly, §10 row 4)
// ---------------------------------------------------------------------------

/**
 * `prepareWeeklyFeedback` is the pure part of the weekly-feedback Server
 * Action (app/(front)/manager/weekly/actions.ts). Given the actor, the
 * newcomer the page selected, the `weekly_feedback` active version, the
 * actor's existing feedback rows for that newcomer and the raw answers, it
 * decides, without touching the database:
 *   1. §10 row 4 through `canRespond` (manager → same department; hr / admin
 *      → allowed with `on_behalf`; ceo / newcomer / left target → refused);
 *      the page's population already passed `canAccessNewcomer`, and
 *      `canRespond` implies it for the three roles the route admits;
 *   2. `validateAnswers(activeQuestions, rawAnswers)` → per-question errors;
 *   3. `week_start`: the answer of the question bound to slot
 *      `weekly.start_date`, normalized with `weekStartMonday` (any day of the
 *      week → its Monday). When the version has no enabled question on that
 *      slot, or the answer is empty (hidden / not required), the week of
 *      `now` (Taipei) is used. The normalized Monday is written back into the
 *      answers under that question's key (「答案同步存 answers.week_start」),
 *      so the stored jsonb and the `week_start` column never disagree;
 *   4. the natural key `(user_id, target_user_id, week_start)`: a row of
 *      `existingFeedback` with the same `week_start` is updated
 *      (`existing_id`), otherwise a new row is inserted — the partial unique
 *      index (§5) is never used as an upsert target (D-06).
 *
 * Re-sending: like a manager response (D-35) and unlike a daily log, an
 * update takes `submitted_at = now` — the column only orders the listing and
 * tells HR when the feedback was last written; nothing derives from it.
 */
export interface ExistingWeeklyLike {
  id: string;
  /** Monday, `YYYY-MM-DD`; null on a malformed row (never matched). */
  week_start: string | null;
}

export interface PrepareWeeklyFeedbackInput {
  /** The submit instant (`new Date()` in the Server Action). */
  now: Instant;
  actor: Actor;
  /** The newcomer selected on the page, looked up server-side by id. */
  newcomer: NewcomerRef;
  /** `weekly_feedback`'s active version. */
  activeVersion: VersionLike;
  /** The actor's non-deleted weekly feedback rows for `newcomer` (any week). */
  existingFeedback: readonly ExistingWeeklyLike[];
  /** FormData entries (visible questions only) or any `{ key: value }` object. */
  rawAnswers: Readonly<Record<string, unknown>> | null | undefined;
}

export const ERROR_WEEKLY_FORBIDDEN = "您沒有權限填寫這位新人的週回饋";
export const ERROR_WEEKLY_VERSION_INVALID = "目前的週回饋表單設定有誤，請聯絡人資";
export const ERROR_WEEKLY_DATE_INVALID = "日期格式須為 YYYY-MM-DD";

export type PrepareWeeklyFailureCode = "forbidden" | "version" | "validation";

export interface PrepareWeeklyFailure {
  ok: false;
  /** `forbidden` → the Server Action answers 403; the others are shown in the form. */
  code: PrepareWeeklyFailureCode;
  errors: Record<string, string>;
}

export interface PreparedWeeklyFeedback {
  ok: true;
  /** hr / admin acting in place of the department manager (§10). */
  on_behalf: boolean;
  /** `actor.id` — submissions.user_id. */
  user_id: string;
  /** `newcomer.id` — submissions.target_user_id. */
  target_user_id: string;
  /** `activeVersion.id` — also on a re-send (§6). */
  form_version_id: string;
  /** Monday, `YYYY-MM-DD` (Taipei) — the `week_start` column. */
  week_start: DateString;
  /** Every key of the active version; hidden / empty → null (A11); the `weekly.start_date` key holds `week_start`. */
  answers: Answers;
  /** UTC ISO; always `now` — a re-send is a new submission instant. */
  submitted_at: string;
  /** UTC ISO; `now`. Written on insert; the DB trigger maintains it on update. */
  updated_at: string;
  /** null for a new week; the existing row's id when the same week is re-sent. */
  existing_id: string | null;
}

export type PrepareWeeklyFeedbackResult = PreparedWeeklyFeedback | PrepareWeeklyFailure;

function weeklyFailure(code: PrepareWeeklyFailureCode, message: string): PrepareWeeklyFailure {
  return { ok: false, code, errors: { [FORM_ERROR_KEY]: message } };
}

/** The enabled question bound to `weekly.start_date`, or null when the version has none. */
export function weekStartQuestion(questions: readonly Question[]): Question | null {
  return questions.find((q) => !q.disabled && q.slot === "weekly.start_date") ?? null;
}

export function prepareWeeklyFeedback(input: PrepareWeeklyFeedbackInput): PrepareWeeklyFeedbackResult {
  const { now, actor, newcomer, activeVersion, existingFeedback, rawAnswers } = input;

  const decision = canRespond(actor, newcomer);
  if (!decision.allowed) return weeklyFailure("forbidden", ERROR_WEEKLY_FORBIDDEN);

  const activeQuestions = questionsOf(activeVersion);
  if (!activeQuestions) return weeklyFailure("version", ERROR_WEEKLY_VERSION_INVALID);

  const validation = validateAnswers(activeQuestions, rawAnswers);
  if (!validation.ok) return { ok: false, code: "validation", errors: validation.errors };

  const at = toInstant(now).toISOString();
  const answers: Answers = { ...validation.normalized };

  // week_start: slot answer → Monday; no slot / empty answer → the week of `now`.
  const startQuestion = weekStartQuestion(activeQuestions);
  const startAnswer = startQuestion ? (answers[startQuestion.key] ?? null) : null;
  let weekStart: DateString;
  if (startQuestion && startAnswer !== null) {
    // `validateAnswers` already checks `date` questions; a text question on
    // the slot could still hold anything, so gate it here as well.
    if (!isDateString(startAnswer)) {
      return {
        ok: false,
        code: "validation",
        errors: { [startQuestion.key]: ERROR_WEEKLY_DATE_INVALID },
      };
    }
    weekStart = weekStartMonday(startAnswer);
  } else {
    weekStart = weekStartMonday(taipeiDateOf(now));
  }
  if (startQuestion) answers[startQuestion.key] = weekStart;

  const existing = existingFeedback.find((row) => row.week_start === weekStart) ?? null;

  return {
    ok: true,
    on_behalf: decision.on_behalf,
    user_id: actor.id,
    target_user_id: newcomer.id,
    form_version_id: activeVersion.id,
    week_start: weekStart,
    answers,
    submitted_at: at,
    updated_at: at,
    existing_id: existing?.id ?? null,
  };
}

/** The columns of a weekly feedback row the page reads (`Tables<'submissions'>` satisfies this). */
export interface WeeklyRowLike {
  /** The author (manager, or hr / admin on behalf). */
  user_id: string;
  target_user_id: string | null;
  week_start: string | null;
  answers: unknown;
}

/**
 * Initial answers of the /manager/weekly form for `newcomerId` and the week
 * starting `weekStart`: the actor's own row for that (newcomer, week) when
 * one exists (edit mode: every key of the version, non-string → null),
 * otherwise an empty form whose `weekly.start_date` question is pre-filled
 * with `weekStart` (§8 「week_start 預設本週一」). Returns `{ answers, editing }`
 * so the page can pick the submit label.
 */
export function weeklyInitialAnswers(input: {
  questions: readonly Question[];
  actorId: string;
  newcomerId: string;
  /** Monday, `YYYY-MM-DD` — `weekStartMonday(taipeiDateOf(now))`. */
  weekStart: DateString;
  /** Weekly feedback rows (any author / newcomer / week); filtered here. */
  feedback: readonly WeeklyRowLike[];
}): { answers: Answers; editing: boolean } {
  const { questions, actorId, newcomerId, weekStart, feedback } = input;
  const own = feedback.find(
    (row) => row.user_id === actorId && row.target_user_id === newcomerId && row.week_start === weekStart,
  );
  const answers: Answers = {};
  for (const q of questions) answers[q.key] = null;
  if (own && typeof own.answers === "object" && own.answers !== null && !Array.isArray(own.answers)) {
    for (const [key, value] of Object.entries(own.answers)) {
      if (key in answers) answers[key] = typeof value === "string" ? value : null;
    }
    return { answers, editing: true };
  }
  const startQuestion = weekStartQuestion(questions);
  if (startQuestion) answers[startQuestion.key] = weekStart;
  return { answers, editing: false };
}

// ---------------------------------------------------------------------------
// Friday reminder on /manager (PLAN T22; CLAUDE.md §8 「週五顯示週回饋未填提醒」)
// ---------------------------------------------------------------------------

export interface WeeklyReminderFeedbackLike {
  target_user_id: string | null;
  week_start: string | null;
}

export interface WeeklyReminders {
  /** Monday of the week containing `today`. */
  weekStart: DateString;
  /** `today` is a Friday (Taipei): the reminder is shown at all. */
  due: boolean;
  /** Newcomer ids (from `newcomerIds`) without any feedback for `weekStart`; empty unless `due`. */
  missing: readonly string[];
}

/**
 * Which newcomer cards get 「週回饋未填」 on `today`: only on a Friday
 * (`isFriday`), and only those with no non-deleted `weekly_feedback` row
 * whose `week_start` is this week's Monday — by ANY author (a feedback HR
 * filled on behalf also clears the manager's reminder, and vice versa).
 * §11: 工務主任's 8/31 feedback for Darren → no reminder for Darren on Fri
 * 9/4; the other three newcomers are listed.
 */
export function weeklyReminders(input: {
  today: DateString;
  newcomerIds: readonly string[];
  /** This week's rows are enough; other weeks are ignored here. */
  feedback: readonly WeeklyReminderFeedbackLike[];
}): WeeklyReminders {
  const { today, newcomerIds, feedback } = input;
  const weekStart = weekStartMonday(today);
  if (!isFriday(today)) return { weekStart, due: false, missing: [] };
  const covered = new Set<string>();
  for (const row of feedback) {
    if (row.target_user_id !== null && row.week_start === weekStart) covered.add(row.target_user_id);
  }
  return {
    weekStart,
    due: true,
    missing: newcomerIds.filter((id) => !covered.has(id)),
  };
}
