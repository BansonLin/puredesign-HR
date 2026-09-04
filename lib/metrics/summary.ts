/**
 * The HR one-line daily summary (CLAUDE.md §8 「複製今日一行摘要」, PLAN A13):
 *
 *   9/11 新人日誌｜4/4 已交｜預警 2 筆：A（進度）、B（卡點）｜待主管回應：X｜{APP_BASE_URL}/
 *
 * Pure string formatting. The five facts are computed elsewhere
 * (`buildHrDashboard` in lib/metrics/dashboard.ts hands back a
 * `DailySummaryFacts`); this module only turns them into the line, so the
 * format lives in exactly one place (Phase 3 LINE push reuses it). No
 * `lib/db`, no clock.
 *
 * Field semantics (A13):
 *   - `date`: Taipei today, rendered `M/D` (`9/3`, `10/1`);
 *   - `submitted / expected`: today's logs over the active-newcomer population
 *     (`activeNewcomers()`, A02);
 *   - `todayAlerts`: every alert with `status ≠ closed` on a log whose
 *     `log_date` is today, in the order given, rendered `display_name（label）`
 *     with R1 → 進度, R2 → 卡點; zero alerts render as `預警 0 筆` (no list);
 *   - `openCount`: every alert currently `open`, past days included;
 *   - `baseUrl`: `APP_BASE_URL`; the link is its root path so `/` routes each
 *     role to its own home (a manager must never land on `/hr`).
 */
import { formatDate, type DateString } from "@/lib/time";

/** Separator between the summary fields (full-width vertical bar, §8). */
export const SUMMARY_SEPARATOR = "｜";

/** Display label of an alert rule inside the summary (A13: R1 → 進度, R2 → 卡點). */
export const ALERT_RULE_LABELS: Readonly<Record<string, string>> = {
  R1: "進度",
  R2: "卡點",
};

/**
 * Label of `rule_key` for display. Unknown keys (a future rule that has no
 * label yet) fall back to the key itself rather than an empty string.
 */
export function alertRuleLabel(ruleKey: string): string {
  return ALERT_RULE_LABELS[ruleKey] ?? ruleKey;
}

/** One alert of today's logs as the summary names it. */
export interface SummaryAlert {
  /** `profiles.display_name` of the newcomer. */
  display_name: string;
  /** `alerts.rule_key` (`R1` / `R2`). */
  rule_key: string;
}

/** The facts behind the line; `buildHrDashboard` produces this shape. */
export interface DailySummaryFacts {
  /** Taipei today, `YYYY-MM-DD`. */
  date: DateString;
  /** Newcomers with a log for `date`. */
  submitted: number;
  /** Newcomers who are expected to log on `date` (active, started). */
  expected: number;
  /** Alerts (`status ≠ closed`) hanging on logs dated `date`, in display order. */
  todayAlerts: readonly SummaryAlert[];
  /** All alerts currently `open`, past days included (待主管回應). */
  openCount: number;
}

export interface DailySummaryInput extends DailySummaryFacts {
  /** `APP_BASE_URL`; trailing slashes are ignored. */
  baseUrl: string;
}

/** Root-path link for the summary: `baseUrl` with exactly one trailing `/`. */
export function summaryLink(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}/`;
}

/**
 * Format the line. Example (§8 / PLAN T19, 9/3 18:00 on the §11 seed):
 * `9/3 新人日誌｜4/4 已交｜預警 2 筆：嚴雅齡（進度）、洪湘庭（卡點）｜待主管回應：2｜http://localhost:3000/`
 */
export function buildDailySummary(input: DailySummaryInput): string {
  const { date, submitted, expected, todayAlerts, openCount, baseUrl } = input;
  const alertList = todayAlerts
    .map((alert) => `${alert.display_name}（${alertRuleLabel(alert.rule_key)}）`)
    .join("、");
  const alertsField =
    todayAlerts.length === 0
      ? "預警 0 筆"
      : `預警 ${todayAlerts.length} 筆：${alertList}`;
  return [
    `${formatDate(date, "M/d")} 新人日誌`,
    `${submitted}/${expected} 已交`,
    alertsField,
    `待主管回應：${openCount}`,
    summaryLink(baseUrl),
  ].join(SUMMARY_SEPARATOR);
}
