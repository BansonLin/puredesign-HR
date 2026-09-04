import type { ReactNode } from "react";

import { AlertBadge, alertKindLabel } from "@/components/dashboard/AlertBadge";
import {
  CN_ITEM_NUMERALS,
  planItemsOf,
  rawAnswersOf,
  type ItemNo,
  type PlanItemView,
} from "@/components/dashboard/NewcomerCard";
import { Badge } from "@/components/ui/badge";
import type { Enums, Json } from "@/lib/db/types";
import { bySlot, readYesterdayPlan, type SlotValues } from "@/lib/forms/resolve";
import type { Question } from "@/lib/forms/schema";
import type { Slot } from "@/lib/forms/slots";
import { alertState, type AlertLike, type AlertState } from "@/lib/rules/derived";
import { formatDate, formatTaipei, type DateString, type Instant } from "@/lib/time";

/**
 * Newcomer timeline (CLAUDE.md §8 /manager/newcomer/[id], PLAN T17): one
 * row per daily log, newest first. `buildTimeline` is pure (rows in, view
 * model out, `now` injected); `Timeline` only renders the view model.
 *
 * Per day (§8): yesterday's three plan items next to today's settlement —
 * the plan comes from the previous (non-deleted) log through ITS version,
 * the settlement from this log through ITS version, both by slot (§6), with
 * the question labels of the log's own version; the blocker and its detail;
 * tomorrow's plan; the alerts (R1 → 進度, R2 → 卡點, state derived by A1);
 * the manager responses read through the `response.*` slots, tagged
 * 「HR 代填」 when the responder's role is hr / admin (§10 on_behalf).
 *
 * Reuse contract (T18 / T25): `readOnly` hides the per-day action slot;
 * `renderAction(day)` lets T18 put a 「回應」 button / drawer on every row.
 */

// ---------------------------------------------------------------------------
// input rows (all satisfied by the lib/db/queries row types)
// ---------------------------------------------------------------------------

export interface TimelineLogLike {
  id: string;
  log_date: string | null;
  /** timestamptz ISO. */
  submitted_at: string;
  form_version_id: string;
  answers: Json;
}

export interface TimelineAlertLike extends AlertLike {
  id: string;
  submission_id: string;
  rule_key: string;
  detail: Json;
}

export interface TimelineResponseLike {
  id: string;
  /** The responder (profiles.id). */
  user_id: string;
  target_submission_id: string | null;
  submitted_at: string;
  form_version_id: string;
  answers: Json;
}

export interface ResponderLike {
  id: string;
  display_name: string;
  role: Enums<"user_role">;
}

// ---------------------------------------------------------------------------
// view model
// ---------------------------------------------------------------------------

export interface TimelineItemView {
  no: ItemNo;
  /** Label of this log's `result.item{no}.status` question (its own version); null when unbound. */
  statusLabel: string | null;
  /** `plan.item{no}.text` / `.expect` of the previous log (null without one). */
  planText: string | null;
  planExpect: string | null;
  /** `result.item{no}.status` of this log. */
  status: string | null;
  reasonLabel: string | null;
  reason: string | null;
}

export interface TimelineField {
  label: string;
  value: string;
}

export interface TimelineAlertView {
  id: string;
  ruleKey: string;
  kindLabel: string;
  state: AlertState;
  /** Human-readable detail lines (R1: one per item; R2: the blocker text). */
  lines: string[];
}

export interface TimelineResponseView {
  id: string;
  responderName: string;
  /** Responder role is hr / admin (§10 「可代填（標註 on_behalf）」). */
  onBehalf: boolean;
  /** `M/d HH:mm` Taipei. */
  submittedAtLabel: string;
  status: string | null;
  comment: string | null;
}

export interface TimelineDay {
  logId: string;
  date: DateString;
  /** `M/d`. */
  dateLabel: string;
  /** `HH:mm` Taipei of `submitted_at`. */
  submittedAtLabel: string;
  /** This log's version is not in `versions`: labels and answers cannot be read. */
  versionMissing: boolean;
  /** `log_date` of the previous log the plan was read from; null for the first log. */
  previousDate: DateString | null;
  previousVersionMissing: boolean;
  items: TimelineItemView[];
  blocker: { label: string | null; status: string | null; detail: string | null };
  /** `result.extra_work` / `result.learned` when answered, with their labels. */
  extras: TimelineField[];
  tomorrow: { items: PlanItemView[]; supportNeed: string | null; supportDetail: string | null };
  alerts: TimelineAlertView[];
  responses: TimelineResponseView[];
}

export interface BuildTimelineInput {
  /** The newcomer's non-deleted daily logs, any order. */
  logs: readonly TimelineLogLike[];
  /** Parsed questions by `form_versions.id` (daily-log AND manager_response versions). */
  versions: ReadonlyMap<string, readonly Question[]>;
  /** Alerts of those logs (`listAlertsWithSubmission`, soft-deleted logs excluded). */
  alerts: readonly TimelineAlertLike[];
  /** manager_response submissions targeting those logs. */
  responses: readonly TimelineResponseLike[];
  /** Responder profiles by id. */
  responders: ReadonlyMap<string, ResponderLike>;
  now: Instant;
  thresholdHours: number;
}

const ON_BEHALF_ROLES: readonly Enums<"user_role">[] = ["hr", "admin"];
const UNKNOWN_RESPONDER = "（不明回應者）";

function labelOf(questions: readonly Question[] | null, slot: Slot): string | null {
  return questions?.find((q) => !q.disabled && q.slot === slot)?.label ?? null;
}

function slotValue(slots: SlotValues, slot: Slot): string | null {
  return slots[slot] ?? null;
}

/** R1 / R2 `detail` jsonb → display lines; a malformed detail yields no lines rather than throwing. */
export function alertDetailLines(ruleKey: string, detail: unknown): string[] {
  if (detail === null || typeof detail !== "object") return [];
  const record = detail as Record<string, unknown>;
  if (ruleKey === "R1") {
    if (!Array.isArray(record.items)) return [];
    const lines: string[] = [];
    for (const raw of record.items) {
      if (raw === null || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const i = item.i;
      const numeral = i === 1 || i === 2 || i === 3 ? CN_ITEM_NUMERALS[i] : String(i ?? "?");
      const planText = typeof item.plan_text === "string" && item.plan_text !== "" ? item.plan_text : "（無項目文字）";
      const status = typeof item.status === "string" ? item.status : "";
      const reason = typeof item.reason === "string" && item.reason !== "" ? `（${item.reason}）` : "";
      lines.push(`項目${numeral}：${planText}｜${status}${reason}`);
    }
    return lines;
  }
  if (ruleKey === "R2") {
    return typeof record.text === "string" && record.text !== "" ? [record.text] : [];
  }
  return [];
}

function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildTimeline(input: BuildTimelineInput): TimelineDay[] {
  const { logs, versions, alerts, responses, responders, now, thresholdHours } = input;

  const dated = logs
    .filter((log): log is TimelineLogLike & { log_date: string } => log.log_date !== null)
    .sort((a, b) => compareIso(b.log_date, a.log_date));

  return dated.map((log, index) => {
    const questions = versions.get(log.form_version_id) ?? null;
    const slots: SlotValues = questions ? bySlot(questions, rawAnswersOf(log.answers)) : {};

    // The previous log = the next older row (the list is newest first).
    const previous = dated[index + 1] ?? null;
    const previousQuestions = previous ? (versions.get(previous.form_version_id) ?? null) : null;
    const previousPlan = readYesterdayPlan(
      previous ? rawAnswersOf(previous.answers) : null,
      previousQuestions,
    );

    const items: TimelineItemView[] = ([1, 2, 3] as const).map((no) => {
      const statusSlot = `result.item${no}.status` as Slot;
      const reasonSlot = `result.item${no}.reason` as Slot;
      const planItem = previousPlan.items[no - 1];
      return {
        no,
        statusLabel: labelOf(questions, statusSlot),
        planText: planItem.text,
        planExpect: planItem.expect,
        status: slotValue(slots, statusSlot),
        reasonLabel: labelOf(questions, reasonSlot),
        reason: slotValue(slots, reasonSlot),
      };
    });

    const extras: TimelineField[] = [];
    for (const slot of ["result.extra_work", "result.learned"] as const) {
      const value = slotValue(slots, slot);
      if (value === null) continue;
      extras.push({ label: labelOf(questions, slot) ?? slot, value });
    }

    const tomorrowPlan = readYesterdayPlan(rawAnswersOf(log.answers), questions);

    const dayAlerts: TimelineAlertView[] = alerts
      .filter((alert) => alert.submission_id === log.id)
      .sort((a, b) => compareIso(a.rule_key, b.rule_key))
      .map((alert) => ({
        id: alert.id,
        ruleKey: alert.rule_key,
        kindLabel: alertKindLabel(alert.rule_key),
        state: alertState({ alert, thresholdHours, now }),
        lines: alertDetailLines(alert.rule_key, alert.detail),
      }));

    const dayResponses: TimelineResponseView[] = responses
      .filter((response) => response.target_submission_id === log.id)
      .sort((a, b) => compareIso(a.submitted_at, b.submitted_at))
      .map((response) => {
        const responseQuestions = versions.get(response.form_version_id) ?? null;
        const responseSlots: SlotValues = responseQuestions
          ? bySlot(responseQuestions, rawAnswersOf(response.answers))
          : {};
        const responder = responders.get(response.user_id) ?? null;
        return {
          id: response.id,
          responderName: responder?.display_name ?? UNKNOWN_RESPONDER,
          onBehalf: responder !== null && ON_BEHALF_ROLES.includes(responder.role),
          submittedAtLabel: formatTaipei(response.submitted_at, "M/d HH:mm"),
          status: slotValue(responseSlots, "response.status"),
          comment: slotValue(responseSlots, "response.comment"),
        };
      });

    return {
      logId: log.id,
      date: log.log_date,
      dateLabel: formatDate(log.log_date, "M/d"),
      submittedAtLabel: formatTaipei(log.submitted_at, "HH:mm"),
      versionMissing: questions === null,
      previousDate: previous?.log_date ?? null,
      previousVersionMissing: previous !== null && previousQuestions === null,
      items,
      blocker: {
        label: labelOf(questions, "result.blocker.status"),
        status: slotValue(slots, "result.blocker.status"),
        detail: slotValue(slots, "result.blocker.detail"),
      },
      extras,
      tomorrow: {
        items: planItemsOf(tomorrowPlan, questions),
        supportNeed: tomorrowPlan.support.need,
        supportDetail: tomorrowPlan.support.detail,
      },
      alerts: dayAlerts,
      responses: dayResponses,
    };
  });
}

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------

export const NO_LOGS_LABEL = "尚無日誌";
export const NO_PREVIOUS_LOG_LABEL = "沒有前一筆日誌，無昨日計畫";
export const PREVIOUS_VERSION_MISSING_LABEL = "找不到前一筆日誌的表單版本，無法顯示昨日計畫";
export const VERSION_MISSING_LABEL = "找不到這筆日誌的表單版本，無法顯示內容";
export const NO_ALERTS_LABEL = "無預警";
export const NO_RESPONSE_LABEL = "尚未回應";
export const NO_TOMORROW_LABEL = "未排定明日項目";
export const ON_BEHALF_LABEL = "HR 代填";

export interface TimelineProps {
  days: readonly TimelineDay[];
  /** true → the action slot is never rendered (T25 HR / CEO reuse). */
  readOnly?: boolean;
  /** Per-day action (T18: the 「回應」 button); ignored when `readOnly`. */
  renderAction?: (day: TimelineDay) => ReactNode;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</h3>;
}

function SettlementRow({ item }: { item: TimelineItemView }) {
  const noPlan = item.planText === null;
  return (
    <li className="flex flex-col gap-0.5 rounded-md bg-muted px-3 py-2 text-sm" data-testid={`settlement-${item.no}`}>
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 font-medium">項目{CN_ITEM_NUMERALS[item.no]}</span>
        <span className="min-w-0 flex-1 break-words">
          {noPlan ? <span className="text-muted-foreground">（昨日無此項）</span> : item.planText}
          {item.planExpect !== null ? (
            <span className="text-muted-foreground">（預計 {item.planExpect}）</span>
          ) : null}
        </span>
      </div>
      <div className="flex items-baseline gap-2 pl-4">
        <span className="shrink-0 text-muted-foreground">{item.statusLabel ?? "狀態"}</span>
        <span className="min-w-0 flex-1 break-words">
          {item.status ?? <span className="text-muted-foreground">未填</span>}
          {item.reason !== null ? <span className="text-muted-foreground">｜{item.reason}</span> : null}
        </span>
      </div>
    </li>
  );
}

function DayCard({
  day,
  action,
}: {
  day: TimelineDay;
  action: ReactNode;
}) {
  return (
    <article
      className="flex flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground"
      data-testid="timeline-day"
      data-date={day.date}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{day.dateLabel} 日誌</h2>
          <p className="text-xs text-muted-foreground">提交 {day.submittedAtLabel}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>

      {day.versionMissing ? (
        <p className="text-sm text-destructive">{VERSION_MISSING_LABEL}</p>
      ) : null}

      <section className="flex flex-col gap-2" aria-label="昨日計畫結算">
        <SectionTitle>
          昨日計畫結算
          {day.previousDate !== null ? `（對照 ${formatDate(day.previousDate, "M/d")} 計畫）` : ""}
        </SectionTitle>
        {day.previousDate === null ? (
          <p className="text-sm text-muted-foreground">{NO_PREVIOUS_LOG_LABEL}</p>
        ) : day.previousVersionMissing ? (
          <p className="text-sm text-destructive">{PREVIOUS_VERSION_MISSING_LABEL}</p>
        ) : null}
        <ul className="flex flex-col gap-1">
          {day.items.map((item) => (
            <SettlementRow key={item.no} item={item} />
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-1 text-sm" aria-label="卡點">
        <SectionTitle>{day.blocker.label ?? "卡點"}</SectionTitle>
        <p className="break-words">
          {day.blocker.status ?? <span className="text-muted-foreground">未填</span>}
          {day.blocker.detail !== null ? <span>：{day.blocker.detail}</span> : null}
        </p>
        {day.extras.map((field) => (
          <p key={field.label} className="break-words">
            <span className="text-muted-foreground">{field.label}：</span>
            {field.value}
          </p>
        ))}
      </section>

      <section className="flex flex-col gap-1" aria-label="明日計畫">
        <SectionTitle>明日計畫</SectionTitle>
        {day.tomorrow.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{NO_TOMORROW_LABEL}</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {day.tomorrow.items.map((item) => (
              <li key={item.no} className="flex items-start gap-2 text-sm">
                <span className="w-5 shrink-0 font-medium">{item.no}.</span>
                <span className="min-w-0 flex-1 break-words">
                  {item.text}
                  {item.expect !== null ? (
                    <span className="text-muted-foreground">（預計 {item.expect}）</span>
                  ) : null}
                </span>
                {item.top ? <Badge>最重要</Badge> : null}
              </li>
            ))}
          </ol>
        )}
        {day.tomorrow.supportNeed !== null ? (
          <p className="text-sm">
            <span className="text-muted-foreground">需要支援：</span>
            {day.tomorrow.supportNeed}
            {day.tomorrow.supportDetail !== null ? <span>（{day.tomorrow.supportDetail}）</span> : null}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2" aria-label="預警">
        <SectionTitle>預警</SectionTitle>
        {day.alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{NO_ALERTS_LABEL}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {day.alerts.map((alert) => (
              <li key={alert.id} className="flex flex-col gap-1" data-testid="timeline-alert" data-rule={alert.ruleKey}>
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
        {day.responses.length === 0 ? (
          day.alerts.length > 0 ? (
            <p className="text-sm text-muted-foreground">{NO_RESPONSE_LABEL}</p>
          ) : null
        ) : (
          <ul className="flex flex-col gap-2">
            {day.responses.map((response) => (
              <li key={response.id} className="flex flex-col gap-1 text-sm" data-testid="timeline-response">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{response.responderName}</span>
                  {response.onBehalf ? <Badge variant="outline">{ON_BEHALF_LABEL}</Badge> : null}
                  <span>{response.submittedAtLabel}</span>
                </div>
                <p className="break-words">
                  {response.status !== null ? <span className="font-medium">{response.status}</span> : null}
                  {response.comment !== null ? (
                    <span>{response.status !== null ? "｜" : ""}{response.comment}</span>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

export function Timeline({ days, readOnly = false, renderAction }: TimelineProps) {
  if (days.length === 0) {
    return <p className="text-sm text-muted-foreground">{NO_LOGS_LABEL}</p>;
  }
  return (
    <div className="flex flex-col gap-4" data-testid="timeline">
      {days.map((day) => (
        <DayCard key={day.logId} day={day} action={!readOnly && renderAction ? renderAction(day) : null} />
      ))}
    </div>
  );
}
