/**
 * Daily-log submit pipeline, pure part (PLAN T14; CLAUDE.md §6 / §7 / §8).
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
import { parseQuestions, type Answers, type Question } from "@/lib/forms/schema";
import { bySlot } from "@/lib/forms/resolve";
import { validateAnswers } from "@/lib/forms/validate";
import type { RulesSettings } from "@/lib/rules/constants";
import { reconcile, runRules } from "@/lib/rules/run";
import type { ExistingAlertLike, ReconcileResult } from "@/lib/rules/types";
import { taipeiDateOf, toInstant, type Instant } from "@/lib/time";

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
