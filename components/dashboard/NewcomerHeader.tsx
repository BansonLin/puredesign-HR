import { dayNumber, type DateString } from "@/lib/time";
import {
  nextMilestone,
  stageOf,
  type MilestoneLike,
} from "@/lib/time/milestones";

/**
 * Top strip of the newcomer pages (CLAUDE.md §8 /me/today, PLAN T15 / A09):
 * 「第 N 天｜階段｜下一節點 D30 2026-10-01」. Pure: `today` (a Taipei
 * calendar date the page computed once from `now`) is passed in, the
 * derivations are lib/time's, and nothing here reads the clock.
 *
 * A09 cases: no start date → 「尚未設定到職日」; start date in the future →
 * 「第 0 天｜尚未到職」; an overdue pending milestone → 「（逾期 N 天）」.
 */
export interface NewcomerHeaderProps {
  displayName: string;
  /** profiles.start_date (`YYYY-MM-DD`) or null. */
  startDate: DateString | null;
  /** The newcomer's milestone rows (any subset is tolerated). */
  milestones: readonly MilestoneLike[];
  /** Taipei calendar date of `now`. */
  today: DateString;
}

export const NO_START_DATE_LABEL = "尚未設定到職日";
export const NOT_STARTED_LABEL = "尚未到職";
export const NO_MILESTONES_LABEL = "尚未建立節點";
export const ALL_MILESTONES_DONE_LABEL = "節點皆已完成";

/**
 * The status line as one string (parts joined with 「｜」), exported so the
 * page title / tests can reuse the exact wording.
 */
export function newcomerStatusLine({
  startDate,
  milestones,
  today,
}: Omit<NewcomerHeaderProps, "displayName">): string {
  const day = dayNumber(startDate, today);
  if (day === null) return NO_START_DATE_LABEL;
  if (day === 0) return `第 0 天｜${NOT_STARTED_LABEL}`;

  const stage = stageOf(milestones, today);
  const next = nextMilestone(milestones, today);
  const parts: string[] = [`第 ${day} 天`];
  if (stage) parts.push(stage.label);
  if (next) {
    const overdue = next.overdueDays > 0 ? `（逾期 ${next.overdueDays} 天）` : "";
    parts.push(`下一節點 ${next.kind} ${next.due}${overdue}`);
  } else {
    parts.push(stage ? ALL_MILESTONES_DONE_LABEL : NO_MILESTONES_LABEL);
  }
  return parts.join("｜");
}

export function NewcomerHeader(props: NewcomerHeaderProps) {
  const line = newcomerStatusLine(props);
  return (
    <section
      aria-label="新人狀態"
      className="rounded-xl border bg-card px-4 py-3 text-card-foreground"
    >
      <p className="truncate text-base font-semibold">{props.displayName}</p>
      <p className="mt-1 text-sm text-muted-foreground" data-testid="newcomer-status">
        {line}
      </p>
    </section>
  );
}
