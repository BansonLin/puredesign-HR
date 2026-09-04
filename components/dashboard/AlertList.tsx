import Link from "next/link";

import { ALERT_STATE_LABELS } from "@/components/dashboard/AlertBadge";
import { alertDetailLines } from "@/components/dashboard/Timeline";
import { Badge } from "@/components/ui/badge";
import type { DashboardAlert, DashboardNewcomer, PendingAlertEntry } from "@/lib/metrics/dashboard";
import { formatDate } from "@/lib/time";

/**
 * /hr 「待處理預警」 block (CLAUDE.md §8, PLAN T20): every `open` alert of
 * the active population, oldest first, as assembled by
 * `buildHrDashboard(...).pendingAlerts` (lib/metrics/dashboard.ts). Each row
 * names the newcomer (linked to their timeline), the rule label
 * (`entry.label`, from `alertRuleLabel` — the single R1 → 進度 / R2 → 卡點
 * source), the A1 state (待回應 / 逾時), the log date, the hours the alert
 * has been open, and the alert detail lines (`alertDetailLines`). Pure
 * presentation; `now` was injected upstream.
 *
 * Link target: PLAN T20 says `/hr/newcomer/[id]`; until T25 creates that
 * page the rows link to `/manager/newcomer/[id]` (hr / admin may open any
 * newcomer there, §10 row 3). Override with `hrefFor` once T25 lands.
 */
export const PENDING_ALERTS_TITLE = "待處理預警";
export const NO_PENDING_ALERTS_LABEL = "目前沒有待處理預警";
/** T25 前暫連 /manager/newcomer/[id]（PLAN T20）。 */
export const PENDING_ALERT_NEWCOMER_PATH = "/manager/newcomer";

export function defaultNewcomerHref(newcomerId: string): string {
  return `${PENDING_ALERT_NEWCOMER_PATH}/${newcomerId}`;
}

/** 「已 N 小時未回」: whole hours, floored, never negative. */
export function openHoursLabel(openHours: number): string {
  const hours = Math.max(0, Math.floor(openHours));
  return `已 ${hours} 小時未回`;
}

/** `listAlertsWithSubmission()` rows also carry `detail`; the dashboard's minimum row may not. */
export type PendingAlertLike = DashboardAlert & { detail?: unknown };

export interface AlertListProps<N extends DashboardNewcomer, A extends PendingAlertLike> {
  entries: readonly PendingAlertEntry<N, A>[];
  /**
   * Link of the newcomer name; defaults to `defaultNewcomerHref`. `null`
   * renders plain text — /ceo is read-only and has no newcomer page to reach
   * (§8, PLAN T26), same convention as `NewcomerOverview`.
   */
  hrefFor?: ((newcomerId: string) => string) | null;
}

export function AlertList<N extends DashboardNewcomer, A extends PendingAlertLike>({
  entries,
  hrefFor = defaultNewcomerHref,
}: AlertListProps<N, A>) {
  return (
    <section aria-labelledby="pending-alerts-title" data-testid="pending-alerts" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="pending-alerts-title" className="text-lg font-semibold">
          {PENDING_ALERTS_TITLE}
        </h2>
        <span className="text-sm text-muted-foreground">{entries.length} 筆</span>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="pending-alerts-empty">
          {NO_PENDING_ALERTS_LABEL}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => {
            const lines = alertDetailLines(entry.alert.rule_key, entry.alert.detail);
            const href = hrefFor === null ? null : hrefFor(entry.newcomer.id);
            return (
              <li
                key={entry.alert.id}
                className="flex flex-col gap-1 rounded-lg border bg-card p-3 text-card-foreground"
                data-testid="pending-alert"
                data-alert-id={entry.alert.id}
                data-user-id={entry.newcomer.id}
                data-state={entry.state}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {href === null ? (
                    <span className="text-base font-semibold">{entry.newcomer.display_name}</span>
                  ) : (
                    <Link
                      href={href}
                      className="flex min-h-11 items-center text-base font-semibold underline-offset-4 hover:underline"
                    >
                      {entry.newcomer.display_name}
                    </Link>
                  )}
                  <Badge variant="default" data-rule={entry.alert.rule_key}>
                    {entry.label}預警
                  </Badge>
                  <Badge variant={entry.state === "overdue" ? "destructive" : "outline"}>
                    {ALERT_STATE_LABELS[entry.state]}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {entry.log_date ? `${formatDate(entry.log_date, "M/d")} 日誌` : "日誌日期不明"}
                  <span className="mx-1">·</span>
                  {openHoursLabel(entry.openHours)}
                </p>
                {lines.length > 0 ? (
                  <ul className="flex flex-col gap-0.5 text-sm">
                    {lines.map((line, index) => (
                      <li key={index} className="break-words">
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
