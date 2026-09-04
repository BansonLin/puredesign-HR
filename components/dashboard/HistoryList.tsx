import { AlertBadge, alertKindLabel } from "@/components/dashboard/AlertBadge";
import { rawAnswersOf } from "@/components/dashboard/NewcomerCard";
import { alertDetailLines, type ResponderLike } from "@/components/dashboard/Timeline";
import { Badge } from "@/components/ui/badge";
import type { Enums, Json } from "@/lib/db/types";
import { bySlot, resolveVisibility, type SlotValues } from "@/lib/forms/resolve";
import type { Question } from "@/lib/forms/schema";
import type { Slot } from "@/lib/forms/slots";
import { alertState, type AlertLike, type AlertState } from "@/lib/rules/derived";
import {
  formatDate,
  formatTaipei,
  toInstant,
  weekStartMonday,
  type DateString,
  type Instant,
} from "@/lib/time";

/**
 * Newcomer history (CLAUDE.md §8 /me/history, PLAN T21): one row per own
 * daily log, newest `log_date` first. `buildHistoryRows` is pure (rows in,
 * view model out, `now` injected); `HistoryList` only renders the view
 * model. The page passes ONLY the signed-in newcomer's rows (§10 row 2), so
 * the builder never filters by user.
 *
 * Per day:
 *   - the log summary: every visible, answered question of the log's OWN
 *     form version with that version's `label` (§6: history is shown with
 *     the labels of the version it was written against);
 *   - the alerts (R1 → 進度, R2 → 卡點) with the A1 state derived by
 *     `alertState` (待回應 / 逾時 / 已回應 / 已關閉);
 *   - the manager responses read through the `response.status` /
 *     `response.comment` slots, tagged 「HR 代填」 when the responder's role
 *     is hr / admin (§10 on_behalf);
 *   - the weekly feedback of the week the day falls in
 *     (`week_start = weekStartMonday(log_date)`), three lines read through
 *     the `weekly.good` / `weekly.improve` / `weekly.next_focus` slots with
 *     the labels of the feedback's own version — shown on the NEWEST row of
 *     that week only (`showWeekly`), so one feedback is not repeated on every
 *     day of its week.
 *
 * A log whose form version cannot be read is reported two ways (they mean
 * different things to HR): the version row is gone (`missing`) or it exists
 * but its `questions` jsonb does not parse (`unparseable`, listed by the page
 * in `unparseableVersionIds`).
 */

// ---------------------------------------------------------------------------
// input rows (all satisfied by the lib/db/queries row types)
// ---------------------------------------------------------------------------

export interface HistoryLogLike {
  id: string;
  log_date: string | null;
  /** timestamptz ISO. */
  submitted_at: string;
  form_version_id: string;
  answers: Json;
}

export interface HistoryAlertLike extends AlertLike {
  id: string;
  submission_id: string;
  rule_key: string;
  detail: Json;
}

export interface HistoryResponseLike {
  id: string;
  /** The responder (profiles.id). */
  user_id: string;
  target_submission_id: string | null;
  submitted_at: string;
  form_version_id: string;
  answers: Json;
}

export interface HistoryWeeklyLike {
  id: string;
  /** The author (profiles.id). */
  user_id: string;
  /** Monday, `YYYY-MM-DD`. */
  week_start: string | null;
  submitted_at: string;
  form_version_id: string;
  answers: Json;
}

// ---------------------------------------------------------------------------
// view model
// ---------------------------------------------------------------------------

export interface HistoryField {
  /** The question key (React key / test hook). */
  key: string;
  label: string;
  value: string;
}

export interface HistoryAlertView {
  id: string;
  ruleKey: string;
  /** 進度 / 卡點. */
  kindLabel: string;
  state: AlertState;
  lines: string[];
}

export interface HistoryResponseView {
  id: string;
  responderName: string;
  /** Responder role is hr / admin (§10 「可代填（標註 on_behalf）」). */
  onBehalf: boolean;
  /** `M/d HH:mm` Taipei. */
  submittedAtLabel: string;
  status: string | null;
  comment: string | null;
}

export interface HistoryWeeklyView {
  id: string;
  weekStart: DateString;
  /** `M/d`. */
  weekStartLabel: string;
  authorName: string;
  onBehalf: boolean;
  /** `M/d HH:mm` Taipei. */
  submittedAtLabel: string;
  /** This feedback's version is not in `versions`. */
  versionMissing: boolean;
  /** The three lines (good / improve / next_focus), with their labels; unanswered ones are skipped. */
  lines: HistoryField[];
}

/** Why a log's questions could not be read (null = they could). */
export type VersionError = "missing" | "unparseable";

export interface HistoryRow {
  logId: string;
  date: DateString;
  /** `M/d`. */
  dateLabel: string;
  /** `HH:mm` Taipei of `submitted_at`. */
  submittedAtLabel: string;
  /** Monday of the week `date` falls in. */
  weekStart: DateString;
  /** Non-null when this log's form version could not be read, and why. */
  versionError: VersionError | null;
  summary: HistoryField[];
  alerts: HistoryAlertView[];
  responses: HistoryResponseView[];
  /** This is the newest row of its week, so it carries the week's feedback. */
  showWeekly: boolean;
  /** The week's feedback; empty on rows where `showWeekly` is false. */
  weekly: HistoryWeeklyView[];
}

export interface BuildHistoryRowsInput {
  /** The newcomer's own non-deleted daily logs, any order. */
  logs: readonly HistoryLogLike[];
  /** Parsed questions by `form_versions.id` (daily, response AND weekly versions). */
  versions: ReadonlyMap<string, readonly Question[]>;
  /** Alerts of those logs (`listAlertsWithSubmission`, soft-deleted logs excluded). */
  alerts: readonly HistoryAlertLike[];
  /** manager_response submissions targeting those logs. */
  responses: readonly HistoryResponseLike[];
  /** weekly_feedback submissions whose target is the newcomer. */
  weekly: readonly HistoryWeeklyLike[];
  /** Responder / author profiles by id. */
  responders: ReadonlyMap<string, ResponderLike>;
  /**
   * Version ids that exist but whose `questions` jsonb does not parse. They
   * are absent from `versions` like a missing row, and only this set tells
   * the two apart for the reader.
   */
  unparseableVersionIds?: ReadonlySet<string>;
  now: Instant;
  thresholdHours: number;
}

const ON_BEHALF_ROLES: readonly Enums<"user_role">[] = ["hr", "admin"];
const UNKNOWN_PERSON = "（不明填寫者）";
const WEEKLY_SLOTS: readonly Slot[] = ["weekly.good", "weekly.improve", "weekly.next_focus"];

/** Lexicographic order — for `YYYY-MM-DD` dates and rule keys only, never for timestamps. */
function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Chronological order of two timestamptz values. String comparison would be
 * wrong here: the same instant can arrive as `...T09:10:00+08:00` or
 * `...T01:10:00Z`, so the offsets are resolved through lib/time first.
 */
function compareInstant(a: string, b: string): number {
  return toInstant(a).getTime() - toInstant(b).getTime();
}

function labelOf(questions: readonly Question[] | null, slot: Slot): string | null {
  return questions?.find((q) => !q.disabled && q.slot === slot)?.label ?? null;
}

function slotValue(slots: SlotValues, slot: Slot): string | null {
  return slots[slot] ?? null;
}

function personOf(responders: ReadonlyMap<string, ResponderLike>, id: string) {
  const person = responders.get(id) ?? null;
  return {
    name: person?.display_name ?? UNKNOWN_PERSON,
    onBehalf: person !== null && ON_BEHALF_ROLES.includes(person.role),
  };
}

/**
 * The log summary: visible (show_if / disabled resolved against the stored
 * answers) and answered questions of `questions`, in `order`, with their
 * labels. No version → no summary.
 */
export function logSummaryFields(questions: readonly Question[] | null, answers: Json): HistoryField[] {
  if (!questions) return [];
  const { visible, effective } = resolveVisibility(questions, rawAnswersOf(answers));
  const fields: HistoryField[] = [];
  for (const question of visible) {
    const value = effective[question.key];
    if (value === null || value === undefined) continue;
    fields.push({ key: question.key, label: question.label, value });
  }
  return fields;
}

export function buildHistoryRows(input: BuildHistoryRowsInput): HistoryRow[] {
  const {
    logs,
    versions,
    alerts,
    responses,
    weekly,
    responders,
    unparseableVersionIds,
    now,
    thresholdHours,
  } = input;

  const dated = logs
    .filter((log): log is HistoryLogLike & { log_date: string } => log.log_date !== null)
    .sort((a, b) => compareIso(b.log_date, a.log_date));

  // Rows are newest first, so the first row of a week is its newest one and
  // the only one that shows that week's feedback.
  const weeksShown = new Set<string>();

  return dated.map((log) => {
    const questions = versions.get(log.form_version_id) ?? null;
    const weekStart = weekStartMonday(log.log_date);
    const showWeekly = !weeksShown.has(weekStart);
    weeksShown.add(weekStart);

    const dayAlerts: HistoryAlertView[] = alerts
      .filter((alert) => alert.submission_id === log.id)
      .sort((a, b) => compareIso(a.rule_key, b.rule_key))
      .map((alert) => ({
        id: alert.id,
        ruleKey: alert.rule_key,
        kindLabel: alertKindLabel(alert.rule_key),
        state: alertState({ alert, thresholdHours, now }),
        lines: alertDetailLines(alert.rule_key, alert.detail),
      }));

    const dayResponses: HistoryResponseView[] = responses
      .filter((response) => response.target_submission_id === log.id)
      .sort((a, b) => compareInstant(a.submitted_at, b.submitted_at))
      .map((response) => {
        const responseQuestions = versions.get(response.form_version_id) ?? null;
        const slots: SlotValues = responseQuestions
          ? bySlot(responseQuestions, rawAnswersOf(response.answers))
          : {};
        const person = personOf(responders, response.user_id);
        return {
          id: response.id,
          responderName: person.name,
          onBehalf: person.onBehalf,
          submittedAtLabel: formatTaipei(response.submitted_at, "M/d HH:mm"),
          status: slotValue(slots, "response.status"),
          comment: slotValue(slots, "response.comment"),
        };
      });

    const weekFeedback: HistoryWeeklyView[] = (showWeekly ? weekly : [])
      .filter((entry) => entry.week_start === weekStart)
      .sort((a, b) => compareInstant(a.submitted_at, b.submitted_at))
      .map((entry) => {
        const weeklyQuestions = versions.get(entry.form_version_id) ?? null;
        const slots: SlotValues = weeklyQuestions ? bySlot(weeklyQuestions, rawAnswersOf(entry.answers)) : {};
        const person = personOf(responders, entry.user_id);
        const lines: HistoryField[] = [];
        for (const slot of WEEKLY_SLOTS) {
          const value = slotValue(slots, slot);
          if (value === null) continue;
          lines.push({ key: slot, label: labelOf(weeklyQuestions, slot) ?? slot, value });
        }
        return {
          id: entry.id,
          weekStart,
          weekStartLabel: formatDate(weekStart, "M/d"),
          authorName: person.name,
          onBehalf: person.onBehalf,
          submittedAtLabel: formatTaipei(entry.submitted_at, "M/d HH:mm"),
          versionMissing: weeklyQuestions === null,
          lines,
        };
      });

    return {
      logId: log.id,
      date: log.log_date,
      dateLabel: formatDate(log.log_date, "M/d"),
      submittedAtLabel: formatTaipei(log.submitted_at, "HH:mm"),
      weekStart,
      versionError:
        questions !== null
          ? null
          : unparseableVersionIds?.has(log.form_version_id)
            ? "unparseable"
            : "missing",
      summary: logSummaryFields(questions, log.answers),
      alerts: dayAlerts,
      responses: dayResponses,
      showWeekly,
      weekly: weekFeedback,
    };
  });
}

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------

export const NO_HISTORY_LABEL = "還沒有日誌";
export const HISTORY_VERSION_MISSING_LABEL = "找不到這筆日誌的表單版本，無法顯示內容";
export const HISTORY_VERSION_UNPARSEABLE_LABEL = "表單版本內容無法解析，無法顯示這筆日誌的內容";
export const WEEKLY_VERSION_MISSING_LABEL = "找不到週回饋的表單版本，無法顯示內容";
export const HISTORY_NO_ALERTS_LABEL = "無預警";
export const HISTORY_NO_RESPONSE_LABEL = "主管尚未回應";
export const HISTORY_NO_WEEKLY_LABEL = "本週尚無週回饋";
export const HISTORY_ON_BEHALF_LABEL = "HR 代填";

export interface HistoryListProps {
  rows: readonly HistoryRow[];
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</h3>;
}

function PersonLine({
  name,
  onBehalf,
  when,
}: {
  name: string;
  onBehalf: boolean;
  when: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{name}</span>
      {onBehalf ? <Badge variant="outline">{HISTORY_ON_BEHALF_LABEL}</Badge> : null}
      <span>{when}</span>
    </div>
  );
}

function HistoryCard({ row }: { row: HistoryRow }) {
  return (
    <article
      className="flex flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground"
      data-testid="history-row"
      data-date={row.date}
    >
      <header className="min-w-0">
        <h2 className="text-base font-semibold">{row.dateLabel} 日誌</h2>
        <p className="text-xs text-muted-foreground">提交 {row.submittedAtLabel}</p>
      </header>

      <section className="flex flex-col gap-1" aria-label="日誌摘要">
        <SectionTitle>日誌摘要</SectionTitle>
        {row.versionError !== null ? (
          <p className="text-sm text-destructive">
            {row.versionError === "unparseable"
              ? HISTORY_VERSION_UNPARSEABLE_LABEL
              : HISTORY_VERSION_MISSING_LABEL}
          </p>
        ) : (
          <dl className="flex flex-col gap-1 text-sm">
            {row.summary.map((field) => (
              <div key={field.key} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2" data-testid="summary-field">
                <dt className="shrink-0 text-muted-foreground sm:w-40">{field.label}</dt>
                <dd className="min-w-0 break-words">{field.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label="預警">
        <SectionTitle>預警</SectionTitle>
        {row.alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{HISTORY_NO_ALERTS_LABEL}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {row.alerts.map((alert) => (
              <li key={alert.id} className="flex flex-col gap-1" data-testid="history-alert" data-rule={alert.ruleKey}>
                <AlertBadge ruleKey={alert.ruleKey} state={alert.state} />
                {alert.lines.map((line, i) => (
                  <p key={i} className="break-words pl-1 text-sm">
                    {line}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label="主管回應">
        <SectionTitle>主管回應</SectionTitle>
        {row.responses.length === 0 ? (
          <p className="text-sm text-muted-foreground">{HISTORY_NO_RESPONSE_LABEL}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {row.responses.map((response) => (
              <li key={response.id} className="flex flex-col gap-1 text-sm" data-testid="history-response">
                <PersonLine name={response.responderName} onBehalf={response.onBehalf} when={response.submittedAtLabel} />
                <p className="break-words">
                  {response.status !== null ? <span className="font-medium">{response.status}</span> : null}
                  {response.comment !== null ? (
                    <span>
                      {response.status !== null ? "｜" : ""}
                      {response.comment}
                    </span>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {row.showWeekly ? (
        <section className="flex flex-col gap-2" aria-label="週回饋">
          <SectionTitle>週回饋（{row.weekly[0]?.weekStartLabel ?? formatDate(row.weekStart, "M/d")} 起）</SectionTitle>
          {row.weekly.length === 0 ? (
            <p className="text-sm text-muted-foreground">{HISTORY_NO_WEEKLY_LABEL}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {row.weekly.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1 text-sm" data-testid="history-weekly">
                  <PersonLine name={entry.authorName} onBehalf={entry.onBehalf} when={entry.submittedAtLabel} />
                  {entry.versionMissing ? (
                    <p className="text-destructive">{WEEKLY_VERSION_MISSING_LABEL}</p>
                  ) : (
                    <dl className="flex flex-col gap-0.5">
                      {entry.lines.map((line) => (
                        <div key={line.key} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2" data-testid="weekly-line">
                          <dt className="shrink-0 text-muted-foreground sm:w-40">{line.label}</dt>
                          <dd className="min-w-0 break-words">{line.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </article>
  );
}

export function HistoryList({ rows }: HistoryListProps) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="history-empty">
        {NO_HISTORY_LABEL}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4" data-testid="history-list">
      {rows.map((row) => (
        <HistoryCard key={row.logId} row={row} />
      ))}
    </div>
  );
}
