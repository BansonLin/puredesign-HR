/**
 * D30／D60／D90 milestone helpers (CLAUDE.md §5 "新人到職時自動建立三筆
 * milestones", PLAN 4.7 application-layer creation, PLAN A09 stage/next
 * milestone semantics). Pure functions; `today` is always passed in.
 */
import { addDaysTo, calendarDaysBetween, type DateString } from "./index";

export const MILESTONE_KINDS = ["D30", "D60", "D90"] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

/** Days after `start_date` at which each milestone is due. */
export const MILESTONE_OFFSET_DAYS: Record<MilestoneKind, number> = {
  D30: 30,
  D60: 60,
  D90: 90,
};

/** Rows to insert for a newcomer: `{ kind, due_date }`. */
export interface MilestoneDue {
  kind: MilestoneKind;
  due_date: DateString;
}

/** Subset of a `milestones` row needed for stage/next-milestone derivation. */
export interface MilestoneLike {
  kind: MilestoneKind;
  due_date: DateString;
  /** timestamptz ISO string when the interview is done; `null` otherwise. */
  done_at: string | null;
}

/**
 * The three milestone due dates for a newcomer who starts on `startDate`.
 * `milestonesFor('2026-09-01')` → D30 2026-10-01, D60 2026-10-31, D90 2026-11-30.
 */
export function milestonesFor(startDate: DateString): MilestoneDue[] {
  return MILESTONE_KINDS.map((kind) => ({
    kind,
    due_date: addDaysTo(startDate, MILESTONE_OFFSET_DAYS[kind]),
  }));
}

export type StageNo = 1 | 2 | 3 | 4;

export interface Stage {
  no: StageNo;
  label: string;
}

/** Display labels per PLAN A09. */
export const STAGE_LABELS: Record<StageNo, string> = {
  1: "第一階段（D30 前）",
  2: "第二階段（D60 前）",
  3: "第三階段（D90 前）",
  4: "已滿 90 天",
};

function findKind(
  milestones: readonly MilestoneLike[],
  kind: MilestoneKind,
): MilestoneLike | undefined {
  return milestones.find((m) => m.kind === kind);
}

/**
 * A milestone counts as passed once it is done or `today` is on or after its
 * due date (PLAN A09: D90 due_date = start_date + 90 is day 91, and "第 91 天起"
 * is already "已滿 90 天"; the same boundary applies to D30 and D60, so day 31
 * enters stage 2 and day 61 enters stage 3).
 */
function isPassed(milestone: MilestoneLike, today: DateString): boolean {
  return milestone.done_at !== null || calendarDaysBetween(milestone.due_date, today) >= 0;
}

/**
 * Onboarding stage derived from the milestones (PLAN A09):
 * stage 1 until D30 is done or due; stage 2 until D60 is done or due;
 * stage 3 until D90 is done or due; stage 4 ("已滿 90 天") from the D90 due
 * date (day 91) onwards.
 * Returns `null` when any of the three milestones is missing (no start date).
 */
export function stageOf(
  milestones: readonly MilestoneLike[],
  today: DateString,
): Stage | null {
  const d30 = findKind(milestones, "D30");
  const d60 = findKind(milestones, "D60");
  const d90 = findKind(milestones, "D90");
  if (!d30 || !d60 || !d90) return null;
  let no: StageNo;
  if (!isPassed(d30, today)) no = 1;
  else if (!isPassed(d60, today)) no = 2;
  else if (!isPassed(d90, today)) no = 3;
  else no = 4;
  return { no, label: STAGE_LABELS[no] };
}

export interface NextMilestone {
  kind: MilestoneKind;
  due: DateString;
  /** Days past `due` as of `today`; `0` when not overdue. */
  overdueDays: number;
}

/**
 * The pending milestone (`done_at is null`) with the smallest `due_date`
 * (PLAN A09). `overdueDays` is `today - due` when positive, else `0`.
 * Returns `null` when every milestone is done (or none exist).
 */
export function nextMilestone(
  milestones: readonly MilestoneLike[],
  today: DateString,
): NextMilestone | null {
  const pending = milestones
    .filter((m) => m.done_at === null)
    .sort((a, b) => calendarDaysBetween(b.due_date, a.due_date));
  const first = pending[0];
  if (!first) return null;
  const overdue = calendarDaysBetween(first.due_date, today);
  return {
    kind: first.kind,
    due: first.due_date,
    overdueDays: overdue > 0 ? overdue : 0,
  };
}
