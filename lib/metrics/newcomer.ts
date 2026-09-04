/**
 * 新人總覽 (CLAUDE.md §8, PLAN T23, A08(a)/(c), A09): one row per active
 * newcomer — 到職天數, 階段, 下一節點, 累計預警, 回應率, 缺交率 — all
 * 到職至今全期 (A08(a)). Shared by `/hr` and `/ceo`.
 *
 * Pure: rows from `activeNewcomers()`, `listLogs()`,
 * `listAlertsWithSubmission()`, `listMilestones()` and the two settings,
 * with `now` taken once by the page. Day number / stage / next milestone
 * come from lib/time (A09, D-05); 缺交率 from `missingRate`; the alert
 * population is A08(b) (`open` / `responded`, log not deleted).
 *
 * Population (A02): the rows are the `active` newcomers, in input order
 * (`activeNewcomers()` order); `left` / `sample` profiles yield no row, and
 * their alerts / logs / milestones are ignored.
 */
import type { Tables } from "@/lib/db/types";
import {
  alertPopulation,
  missingRate,
  ratio,
  type MetricAlert,
  type MetricLog,
  type MissingRate,
  type Ratio,
} from "@/lib/metrics/rates";
import { dayNumber, taipeiDateOf, type Instant, type Workweek } from "@/lib/time";
import {
  nextMilestone,
  stageOf,
  type MilestoneLike,
  type NextMilestone,
  type Stage,
} from "@/lib/time/milestones";

/** `activeNewcomers()` row. */
export type OverviewNewcomer = Pick<
  Tables<"profiles">,
  "id" | "display_name" | "status" | "start_date" | "department_id"
>;

/** `listLogs()` row (newcomer_daily, non-deleted). */
export type OverviewLog = Pick<Tables<"submissions">, "user_id"> & MetricLog;

/** `listAlertsWithSubmission()` row. */
export type OverviewAlert = MetricAlert;

/** `listMilestones()` row. */
export type OverviewMilestone = Pick<Tables<"milestones">, "user_id"> & MilestoneLike;

export interface OverviewSettings {
  /** `settings.daily_cutoff_time`, `HH:mm` Taipei. */
  daily_cutoff_time: string;
  /** `settings.workweek`. */
  workweek: Workweek;
}

export interface NewcomerOverviewRow<N extends OverviewNewcomer = OverviewNewcomer> {
  newcomer: N;
  /** 到職天數 (A09): `today − start_date + 1`; `0` before the start date; `null` without one. */
  dayNumber: number | null;
  /** 階段 (A09 / D-05); `null` when the three milestones are missing. */
  stage: Stage | null;
  /** 下一節點: the pending milestone with the smallest due date; `null` when all done / none. */
  nextMilestone: NextMilestone | null;
  /** 累計預警 = population alerts (`open` + `responded`), all time. */
  alertCount: number;
  /** Of those, still `open` (待回應). */
  openCount: number;
  /** 回應率 = responded ÷ 累計預警 (`rate: null` without alerts). */
  responseRate: Ratio;
  /** 缺交率 (`missingRate`); `null` when undefined (no start date / no workday yet). */
  missingRate: MissingRate | null;
}

export function newcomerOverview<
  N extends OverviewNewcomer,
  L extends OverviewLog,
  A extends OverviewAlert,
  M extends OverviewMilestone,
>(input: {
  /** The population: `activeNewcomers()` (A02). */
  newcomers: readonly N[];
  logs: readonly L[];
  alerts: readonly A[];
  milestones: readonly M[];
  settings: OverviewSettings;
  now: Instant;
}): NewcomerOverviewRow<N>[] {
  const { newcomers, logs, alerts, milestones, settings, now } = input;
  const today = taipeiDateOf(now);

  const logsByUser = new Map<string, L[]>();
  for (const log of logs) {
    const list = logsByUser.get(log.user_id) ?? [];
    list.push(log);
    logsByUser.set(log.user_id, list);
  }
  const alertsByUser = new Map<string, A[]>();
  for (const alert of alertPopulation(alerts)) {
    const list = alertsByUser.get(alert.user_id) ?? [];
    list.push(alert);
    alertsByUser.set(alert.user_id, list);
  }
  const milestonesByUser = new Map<string, M[]>();
  for (const milestone of milestones) {
    const list = milestonesByUser.get(milestone.user_id) ?? [];
    list.push(milestone);
    milestonesByUser.set(milestone.user_id, list);
  }

  const rows: NewcomerOverviewRow<N>[] = [];
  for (const newcomer of newcomers) {
    if (newcomer.status !== "active") continue;
    const own = alertsByUser.get(newcomer.id) ?? [];
    const responded = own.filter((alert) => alert.status === "responded").length;
    const ownMilestones = milestonesByUser.get(newcomer.id) ?? [];
    rows.push({
      newcomer,
      dayNumber: dayNumber(newcomer.start_date, today),
      stage: stageOf(ownMilestones, today),
      nextMilestone: nextMilestone(ownMilestones, today),
      alertCount: own.length,
      openCount: own.length - responded,
      responseRate: ratio(responded, own.length),
      missingRate: missingRate({
        newcomer,
        logs: logsByUser.get(newcomer.id) ?? [],
        now,
        cutoff: settings.daily_cutoff_time,
        workweek: settings.workweek,
      }),
    });
  }
  return rows;
}
