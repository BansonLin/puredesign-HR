import { Badge } from "@/components/ui/badge";
import type {
  DashboardMilestone,
  DashboardNewcomer,
  MilestoneDueEntry,
  MilestonesDue,
} from "@/lib/metrics/dashboard";
import { formatDate } from "@/lib/time";

/**
 * /hr 「節點到期清單」 block (CLAUDE.md §8 「節點到期清單（未來 7 天）」,
 * PLAN T24, A09): pending D30 / D60 / D90 milestones due within
 * `[today, today + 7]`, plus the overdue ones, which are flagged 「逾期 N 天」
 * and sort first. Pure presentation — the entries and their day counts come
 * from `buildHrDashboard(...).milestones` (lib/metrics/dashboard.ts), derived
 * with the page's injected `now`.
 *
 * A list of cards, not a table: nothing to scroll horizontally at 375px.
 */
export const MILESTONE_DUE_TITLE = "節點到期";
export const NO_MILESTONE_DUE_LABEL = "未來 7 天沒有到期節點";
export const DUE_TODAY_LABEL = "今天到期";

/** 「逾期 3 天」 / 「今天到期」 / 「7 天後到期」. */
export function milestoneDueLabel<N extends DashboardNewcomer, M extends DashboardMilestone>(
  entry: MilestoneDueEntry<N, M>,
): string {
  if (entry.overdue) return `逾期 ${entry.overdueDays} 天`;
  if (entry.daysUntil === 0) return DUE_TODAY_LABEL;
  return `${entry.daysUntil} 天後到期`;
}

/** 「9/4–9/11」: the window the list covers (overdue entries fall before it). */
export function milestoneWindowLabel<
  N extends DashboardNewcomer,
  M extends DashboardMilestone,
>(milestones: MilestonesDue<N, M>): string {
  return `${formatDate(milestones.windowStart, "M/d")}–${formatDate(milestones.windowEnd, "M/d")}`;
}

export interface MilestoneDueProps<N extends DashboardNewcomer, M extends DashboardMilestone> {
  milestones: MilestonesDue<N, M>;
}

export function MilestoneDue<N extends DashboardNewcomer, M extends DashboardMilestone>({
  milestones,
}: MilestoneDueProps<N, M>) {
  const { entries } = milestones;
  return (
    <section
      aria-labelledby="milestone-due-title"
      data-testid="milestone-due"
      className="flex flex-col gap-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="milestone-due-title" className="text-lg font-semibold">
          {MILESTONE_DUE_TITLE}
        </h2>
        <span className="text-sm text-muted-foreground">{milestoneWindowLabel(milestones)}</span>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="milestone-due-empty">
          {NO_MILESTONE_DUE_LABEL}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={entry.milestone.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-card-foreground"
              data-testid="milestone-entry"
              data-milestone-id={entry.milestone.id}
              data-user-id={entry.newcomer.id}
              data-overdue={entry.overdue ? "true" : "false"}
            >
              <span className="text-base font-semibold">{entry.newcomer.display_name}</span>
              <Badge variant="outline" data-kind={entry.milestone.kind}>
                {entry.milestone.kind}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {formatDate(entry.milestone.due_date)}
              </span>
              <Badge variant={entry.overdue ? "destructive" : "secondary"}>
                {milestoneDueLabel(entry)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
