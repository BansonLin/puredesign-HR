import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { Actor } from "@/lib/auth/policy";
import type { Json } from "@/lib/db/types";
import { readYesterdayPlan, type RawAnswers, type YesterdayPlan } from "@/lib/forms/resolve";
import type { Question } from "@/lib/forms/schema";
import {
  alertState,
  logStatus,
  type AlertLike,
  type LogStatus,
  type NewcomerLike,
} from "@/lib/rules/derived";
import { dayNumber, formatDate, type DateString, type Instant } from "@/lib/time";

/**
 * /manager newcomer card (CLAUDE.md §8, PLAN T17) — pure data assembly plus
 * the card component. The builders below take rows the page already loaded
 * and one injected `now`; nothing here reads the clock or the database
 * (`Json` is a type-only import), so `tests/unit/manager-dashboard.test.tsx`
 * exercises them against the §11 fixture with fake clocks.
 *
 * Card contents (PLAN T17):
 *   - 今日計畫: `plan.item1–3.text` of the newcomer's latest log BEFORE today
 *     (§8 「今日計畫（來自昨日日誌）」), read by slot through that log's own
 *     version (`readYesterdayPlan`); the 「最重要」 item follows the option
 *     index of that version's `plan.top_priority` question (D-30);
 *   - 今日交件: `logStatus` (§7 R3) for today at `settings.daily_cutoff_time`;
 *   - open 預警數 / 逾時數: `alerts` with status `open`, `alertState` at
 *     `settings.response_threshold_hours`.
 */

// ---------------------------------------------------------------------------
// settings (PLAN 4.8: no silent defaults)
// ---------------------------------------------------------------------------

export interface DashboardSettings {
  /** `HH:mm`, Taipei (settings.daily_cutoff_time). */
  cutoff: string;
  /** settings.response_threshold_hours. */
  thresholdHours: number;
}

const CUTOFF_RE = /^\d{2}:\d{2}$/;

/**
 * The two settings the dashboards need, validated. Throws with the offending
 * key when the jsonb is not the expected shape — a broken setting must not
 * silently turn every newcomer into 「未到時」.
 */
export function parseDashboardSettings(raw: {
  daily_cutoff_time: Json;
  response_threshold_hours: Json;
}): DashboardSettings {
  const cutoff = raw.daily_cutoff_time;
  if (typeof cutoff !== "string" || !CUTOFF_RE.test(cutoff)) {
    throw new Error("settings.daily_cutoff_time 必須是 HH:mm 字串");
  }
  const threshold = raw.response_threshold_hours;
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0) {
    throw new Error("settings.response_threshold_hours 必須是大於等於 0 的數字");
  }
  return { cutoff, thresholdHours: threshold };
}

// ---------------------------------------------------------------------------
// answers / logs helpers shared with Timeline.tsx
// ---------------------------------------------------------------------------

/** `submissions.answers` (jsonb) narrowed to the object shape `getAnswer` / `bySlot` read. */
export function rawAnswersOf(json: unknown): RawAnswers {
  return json !== null && typeof json === "object" && !Array.isArray(json)
    ? (json as Readonly<Record<string, unknown>>)
    : null;
}

/** The daily-log columns the card needs (`Tables<'submissions'>` satisfies this). */
export interface DailyLogLike {
  id: string;
  log_date: string | null;
  form_version_id: string;
  answers: Json;
}

/** The newcomer's latest log with `log_date` strictly before `date` (§6 「昨日計畫」, A05 (6): pass non-deleted rows). */
export function latestLogBefore<L extends { log_date: string | null }>(
  logs: readonly L[],
  date: DateString,
): L | null {
  let latest: L | null = null;
  for (const log of logs) {
    if (log.log_date === null || log.log_date >= date) continue;
    if (latest === null || latest.log_date === null || log.log_date > latest.log_date) latest = log;
  }
  return latest;
}

export function hasLogOn(logs: readonly { log_date: string | null }[], date: DateString): boolean {
  return logs.some((log) => log.log_date === date);
}

// ---------------------------------------------------------------------------
// who a viewer may list (§10 row 3, PLAN T17 「工務主任只見 Darren」)
// ---------------------------------------------------------------------------

export type NewcomerScope =
  | { kind: "all" }
  | { kind: "department"; departmentId: string }
  | { kind: "none" };

/**
 * Which `activeNewcomers()` population the /manager list shows for `actor`:
 * manager → own department (a manager without a department sees nobody,
 * matching `canAccessNewcomer`); hr / ceo / admin → all; newcomer → nobody.
 * The page still filters the rows through `canAccessNewcomer` so §10 stays
 * the single truth.
 */
export function newcomerScope(actor: Pick<Actor, "role" | "department_id">): NewcomerScope {
  switch (actor.role) {
    case "manager":
      return actor.department_id === null
        ? { kind: "none" }
        : { kind: "department", departmentId: actor.department_id };
    case "hr":
    case "ceo":
    case "admin":
      return { kind: "all" };
    case "newcomer":
      return { kind: "none" };
  }
}

// ---------------------------------------------------------------------------
// plan items (shared with Timeline.tsx)
// ---------------------------------------------------------------------------

export type ItemNo = 1 | 2 | 3;

export const CN_ITEM_NUMERALS: Readonly<Record<ItemNo, string>> = { 1: "一", 2: "二", 3: "三" };

export interface PlanItemView {
  no: ItemNo;
  text: string;
  expect: string | null;
  /** This item is the version's `plan.top_priority` (option index ↔ item, D-30). */
  top: boolean;
}

/** Options of a version's enabled `plan.top_priority` question; null when it has none. */
export function topPriorityOptionsOf(questions: readonly Question[] | null | undefined): readonly string[] | null {
  return questions?.find((q) => !q.disabled && q.slot === "plan.top_priority")?.options ?? null;
}

/** The item `top` points at by option index (`options[i - 1] === top`); null when unknown. */
export function topItemNoOf(top: string | null, options: readonly string[] | null): ItemNo | null {
  if (top === null || !options) return null;
  const index = options.indexOf(top);
  return index === 0 || index === 1 || index === 2 ? ((index + 1) as ItemNo) : null;
}

/** Items 1–3 of a plan that have a text, with the 「最重要」 flag resolved against `questions`. */
export function planItemsOf(plan: YesterdayPlan, questions: readonly Question[] | null | undefined): PlanItemView[] {
  const topNo = topItemNoOf(plan.top, topPriorityOptionsOf(questions));
  const items: PlanItemView[] = [];
  plan.items.forEach((item, index) => {
    if (item.text === null) return;
    const no = (index + 1) as ItemNo;
    items.push({ no, text: item.text, expect: item.expect, top: topNo === no });
  });
  return items;
}

// ---------------------------------------------------------------------------
// card data
// ---------------------------------------------------------------------------

export interface NewcomerCardPlan {
  /** `log_date` of the log the plan was read from. */
  sourceDate: DateString;
  items: PlanItemView[];
  /** The log's form version is not in `versions` (cannot read the plan). */
  versionMissing: boolean;
}

export interface NewcomerCardData {
  id: string;
  displayName: string;
  /** `dayNumber(start_date, today)`; null without a start date. */
  day: number | null;
  /** null when the newcomer has no log before today. */
  plan: NewcomerCardPlan | null;
  todayStatus: LogStatus;
  openAlerts: number;
  overdueAlerts: number;
}

export interface BuildNewcomerCardInput {
  newcomer: NewcomerLike & { display_name: string };
  /** This newcomer's non-deleted daily logs (any range that includes today and the latest earlier log). */
  logs: readonly DailyLogLike[];
  /** Parsed questions by `form_versions.id`. */
  versions: ReadonlyMap<string, readonly Question[]>;
  /** This newcomer's alerts (soft-deleted logs already excluded, A05); only `open` rows are counted. */
  alerts: readonly AlertLike[];
  /** Taipei calendar date of `now`. */
  today: DateString;
  now: Instant;
  settings: DashboardSettings;
}

export function buildNewcomerCard(input: BuildNewcomerCardInput): NewcomerCardData {
  const { newcomer, logs, versions, alerts, today, now, settings } = input;

  let plan: NewcomerCardPlan | null = null;
  const source = latestLogBefore(logs, today);
  if (source && source.log_date !== null) {
    const questions = versions.get(source.form_version_id) ?? null;
    plan = questions
      ? {
          sourceDate: source.log_date,
          items: planItemsOf(readYesterdayPlan(rawAnswersOf(source.answers), questions), questions),
          versionMissing: false,
        }
      : { sourceDate: source.log_date, items: [], versionMissing: true };
  }

  let openAlerts = 0;
  let overdueAlerts = 0;
  for (const alert of alerts) {
    if (alert.status !== "open") continue;
    openAlerts += 1;
    if (alertState({ alert, thresholdHours: settings.thresholdHours, now }) === "overdue") {
      overdueAlerts += 1;
    }
  }

  return {
    id: newcomer.id,
    displayName: newcomer.display_name,
    day: dayNumber(newcomer.start_date, today),
    plan,
    todayStatus: logStatus({
      newcomer,
      date: today,
      hasLog: hasLogOn(logs, today),
      cutoff: settings.cutoff,
      now,
    }),
    openAlerts,
    overdueAlerts,
  };
}

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------

export const LOG_STATUS_LABELS: Readonly<Record<LogStatus, string>> = {
  submitted: "已交",
  missing: "缺交",
  pending: "未到時",
  "n/a": "不計",
};

export const NO_PLAN_LABEL = "尚無日誌，沒有今日計畫";
export const PLAN_VERSION_MISSING_LABEL = "無法讀取計畫（找不到該筆日誌的表單版本）";
export const NO_PLAN_ITEMS_LABEL = "該筆日誌沒有排定項目";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

function statusVariant(status: LogStatus): BadgeVariant {
  switch (status) {
    case "missing":
      return "destructive";
    case "submitted":
      return "secondary";
    case "pending":
    case "n/a":
      return "outline";
  }
}

export interface NewcomerCardProps {
  card: NewcomerCardData;
  /** Link target of the name (the timeline page); omit to render the card without a link. */
  href?: string;
}

export function NewcomerCard({ card, href }: NewcomerCardProps) {
  const name = (
    <span className="truncate text-base font-semibold">{card.displayName}</span>
  );
  return (
    <article
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground"
      data-testid="newcomer-card"
      data-user-id={card.id}
    >
      <header className="flex items-baseline justify-between gap-2">
        {href ? (
          <Link href={href} className="flex min-w-0 min-h-11 items-center underline-offset-4 hover:underline">
            {name}
          </Link>
        ) : (
          name
        )}
        <span className="shrink-0 text-sm text-muted-foreground">
          {card.day === null ? "尚未設定到職日" : `第 ${card.day} 天`}
        </span>
      </header>

      <div className="flex flex-wrap gap-2" aria-label="今日狀態">
        <Badge variant={statusVariant(card.todayStatus)} data-testid="today-status">
          今日 {LOG_STATUS_LABELS[card.todayStatus]}
        </Badge>
        <Badge variant={card.openAlerts > 0 ? "default" : "outline"} data-testid="open-alerts">
          待回應預警 {card.openAlerts}
        </Badge>
        {card.overdueAlerts > 0 ? (
          <Badge variant="destructive" data-testid="overdue-alerts">
            逾時 {card.overdueAlerts}
          </Badge>
        ) : null}
      </div>

      <section aria-label="今日計畫">
        <p className="text-sm font-medium">
          今日計畫
          {card.plan ? (
            <span className="ml-1 font-normal text-muted-foreground">
              （來自 {formatDate(card.plan.sourceDate, "M/d")} 日誌）
            </span>
          ) : null}
        </p>
        {card.plan === null ? (
          <p className="mt-1 text-sm text-muted-foreground">{NO_PLAN_LABEL}</p>
        ) : card.plan.versionMissing ? (
          <p className="mt-1 text-sm text-destructive">{PLAN_VERSION_MISSING_LABEL}</p>
        ) : card.plan.items.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{NO_PLAN_ITEMS_LABEL}</p>
        ) : (
          <ol className="mt-1 flex flex-col gap-1">
            {card.plan.items.map((item) => (
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
      </section>
    </article>
  );
}
