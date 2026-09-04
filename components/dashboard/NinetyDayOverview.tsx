import { formatPercent, ratioLabel } from "@/components/dashboard/MetricsTiles";
import { Badge } from "@/components/ui/badge";
import {
  alertPopulation,
  ratio,
  type MissingRate,
  type Ratio,
} from "@/lib/metrics/rates";
import {
  newcomerOverview,
  type OverviewAlert,
  type OverviewLog,
  type OverviewMilestone,
  type OverviewNewcomer,
  type OverviewSettings,
} from "@/lib/metrics/newcomer";
import { dayNumber, formatDate, formatTaipei, taipeiDateOf, type DateString, type Instant } from "@/lib/time";
import {
  MILESTONE_KINDS,
  nextMilestone,
  stageOf,
  type MilestoneKind,
  type MilestoneLike,
  type NextMilestone,
  type Stage,
} from "@/lib/time/milestones";

/**
 * 90 天總覽 of /hr/newcomer/[id] (CLAUDE.md §8, PLAN T25): 到職日, 第 N 天,
 * 階段, the three milestones (read-only — the interview form is Phase 3) and
 * the cumulative numbers 累計日誌 ／ 缺交率 ／ 累計預警 ／ 回應率.
 *
 * `buildNinetyDayOverview` is pure (rows in, view model out, `now` injected
 * once by the page) and delegates every number to `lib/metrics`:
 * `newcomerOverview` (A08(a) 全期, A09 第 N 天／階段／下一節點) for an
 * `active` newcomer, and — because HR may still open a 已離職 newcomer
 * (§10 row 3 / policy: reading stays allowed) — the same lib/time and
 * `alertPopulation` derivations inline when `newcomerOverview` yields no row
 * (its population is `active` only, A02/A08(c)); 缺交率 is then `null`,
 * exactly as `missingRate` defines it for a non-active newcomer.
 */

export interface NinetyDayMilestoneView {
  kind: MilestoneKind;
  /** `milestones.due_date`; null when the row does not exist. */
  due: DateString | null;
  /** `yyyy/MM/dd` Taipei of `done_at`; null while pending. */
  doneLabel: string | null;
  /** Days past `due` for a pending milestone; 0 otherwise. */
  overdueDays: number;
  /** This is the 下一節點 (A09: pending, smallest due date). */
  isNext: boolean;
}

export interface NinetyDayOverviewData {
  displayName: string;
  startDate: DateString | null;
  /** 第 N 天 (A09); 0 before the start date, null without one. */
  dayNumber: number | null;
  stage: Stage | null;
  next: NextMilestone | null;
  /** Always three rows, D30 / D60 / D90 in that order. */
  milestones: NinetyDayMilestoneView[];
  /** 累計日誌 = the newcomer's non-deleted daily logs. */
  logCount: number;
  /** 缺交率 (§7); null when undefined (no start date / not active / no workday yet). */
  missingRate: MissingRate | null;
  /** 累計預警 = alert population (open + responded), all time (A08(a)(b)). */
  alertCount: number;
  /** Of those, still open. */
  openCount: number;
  /** 回應率 = responded ÷ 累計預警. */
  responseRate: Ratio;
}

export interface BuildNinetyDayOverviewInput<
  N extends OverviewNewcomer & { display_name: string },
  L extends OverviewLog,
  A extends OverviewAlert,
  M extends OverviewMilestone & MilestoneLike,
> {
  newcomer: N;
  /** This newcomer's non-deleted daily logs. */
  logs: readonly L[];
  /** This newcomer's alerts (`listAlertsWithSubmission`, any status). */
  alerts: readonly A[];
  /** This newcomer's milestone rows. */
  milestones: readonly M[];
  settings: OverviewSettings;
  now: Instant;
}

export function buildNinetyDayOverview<
  N extends OverviewNewcomer & { display_name: string },
  L extends OverviewLog,
  A extends OverviewAlert,
  M extends OverviewMilestone & MilestoneLike,
>(input: BuildNinetyDayOverviewInput<N, L, A, M>): NinetyDayOverviewData {
  const { newcomer, logs, alerts, milestones, settings, now } = input;
  const today = taipeiDateOf(now);

  const row = newcomerOverview({ newcomers: [newcomer], logs, alerts, milestones, settings, now })[0];
  const population = alertPopulation(alerts);
  const responded = population.filter((alert) => alert.status === "responded").length;
  const base = row ?? {
    // Not `active` (A02): the metrics population skips the newcomer, but HR
    // must still see the history. 缺交率 stays undefined by definition.
    dayNumber: dayNumber(newcomer.start_date, today),
    stage: stageOf(milestones, today),
    nextMilestone: nextMilestone(milestones, today),
    alertCount: population.length,
    openCount: population.length - responded,
    responseRate: ratio(responded, population.length),
    missingRate: null,
  };

  const next = base.nextMilestone;
  const milestoneViews: NinetyDayMilestoneView[] = MILESTONE_KINDS.map((kind) => {
    const milestone = milestones.find((m) => m.kind === kind) ?? null;
    const pending = milestone !== null && milestone.done_at === null;
    return {
      kind,
      due: milestone?.due_date ?? null,
      doneLabel:
        milestone && milestone.done_at !== null
          ? formatTaipei(milestone.done_at, "yyyy/MM/dd")
          : null,
      overdueDays: pending && next !== null && next.kind === kind ? next.overdueDays : 0,
      isNext: next !== null && next.kind === kind,
    };
  });

  return {
    displayName: newcomer.display_name,
    startDate: newcomer.start_date,
    dayNumber: base.dayNumber,
    stage: base.stage,
    next,
    milestones: milestoneViews,
    logCount: logs.length,
    missingRate: base.missingRate,
    alertCount: base.alertCount,
    openCount: base.openCount,
    responseRate: base.responseRate,
  };
}

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------

export const OVERVIEW_TITLE = "90 天總覽";
export const NO_START_DATE_LABEL = "尚未設定到職日";
export const NOT_STARTED_LABEL = "尚未到職";
export const NO_STAGE_LABEL = "尚未建立節點";
export const NO_MILESTONE_LABEL = "尚未建立";
export const MILESTONE_PENDING_LABEL = "未完成";
export const NEXT_MILESTONE_LABEL = "下一節點";
export const UNDEFINED_RATE_LABEL = "—";
/** 缺交率 counts only up to `MissingRate.countedThrough` (D-33), which is not today before the cutoff. */
export const COUNTED_THROUGH_PREFIX = "計至";

/** 「缺 2 / 4 個工作日（計至 2026/09/04）」 — the 缺交率 hint. */
export function missingRateHint(value: MissingRate): string {
  return `缺 ${ratioLabel(value)} 個工作日（${COUNTED_THROUGH_PREFIX} ${formatDate(value.countedThrough)}）`;
}

/** `50%`; 「—」 when the rate is undefined — `formatPercent` (T24) plus the `null` case. */
export function rateLabel(value: Ratio | null): string {
  return value === null ? UNDEFINED_RATE_LABEL : formatPercent(value);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground tabular-nums">{hint}</p> : null}
    </div>
  );
}

export interface NinetyDayOverviewProps {
  data: NinetyDayOverviewData;
}

export function NinetyDayOverview({ data }: NinetyDayOverviewProps) {
  const dayLabel =
    data.dayNumber === null
      ? NO_START_DATE_LABEL
      : data.dayNumber === 0
        ? `第 0 天（${NOT_STARTED_LABEL}）`
        : `第 ${data.dayNumber} 天`;

  return (
    <section
      aria-label={OVERVIEW_TITLE}
      className="flex flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground"
      data-testid="ninety-day-overview"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{OVERVIEW_TITLE}</h2>
        <p className="text-sm text-muted-foreground" data-testid="overview-day">
          {data.startDate !== null ? `到職日 ${formatDate(data.startDate)}｜` : ""}
          {dayLabel}｜{data.stage?.label ?? NO_STAGE_LABEL}
        </p>
      </div>

      <ul className="flex flex-col gap-1" aria-label="節點">
        {data.milestones.map((milestone) => (
          <li
            key={milestone.kind}
            className="flex flex-wrap items-baseline gap-2 rounded-md bg-muted px-3 py-2 text-sm"
            data-testid="overview-milestone"
            data-kind={milestone.kind}
          >
            <span className="font-medium">{milestone.kind}</span>
            <span className="tabular-nums">
              {milestone.due !== null ? formatDate(milestone.due) : NO_MILESTONE_LABEL}
            </span>
            <span className="text-muted-foreground">
              {milestone.doneLabel !== null
                ? `已完成 ${milestone.doneLabel}`
                : milestone.overdueDays > 0
                  ? `逾期 ${milestone.overdueDays} 天`
                  : MILESTONE_PENDING_LABEL}
            </span>
            {milestone.isNext ? <Badge variant="outline">{NEXT_MILESTONE_LABEL}</Badge> : null}
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="累計日誌" value={`${data.logCount} 筆`} />
        <Stat
          label="缺交率"
          value={rateLabel(data.missingRate)}
          hint={data.missingRate === null ? undefined : missingRateHint(data.missingRate)}
        />
        <Stat label="累計預警" value={`${data.alertCount} 筆`} hint={`待回應 ${data.openCount} 筆`} />
        <Stat label="回應率" value={rateLabel(data.responseRate)} hint={ratioLabel(data.responseRate)} />
      </div>
    </section>
  );
}
