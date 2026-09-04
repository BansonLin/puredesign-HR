import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildNinetyDayOverview,
  COUNTED_THROUGH_PREFIX,
  MILESTONE_PENDING_LABEL,
  missingRateHint,
  NEXT_MILESTONE_LABEL,
  NinetyDayOverview,
  NO_START_DATE_LABEL,
  UNDEFINED_RATE_LABEL,
} from "@/components/dashboard/NinetyDayOverview";
import { STAGE_LABELS, milestonesFor } from "@/lib/time/milestones";
import type { Instant } from "@/lib/time";
import {
  CLOCK_0904_1200,
  CLOCK_0904_1800,
  EXPECTED_MILESTONE_DUE_DATES,
  FIXTURE_NEWCOMERS,
  SETTINGS,
} from "@seed/fixtures";
import { buildSeedPlan } from "@seed/plan";

/**
 * T25 90 天總覽 (`components/dashboard/NinetyDayOverview.tsx`): the pure
 * builder on the §11 seed fixture at the PLAN 4.9.5 fake clocks, plus the
 * component through react-dom/server. 嚴雅齡 at 9/4 18:00: 第 4 天,
 * 第一階段, two logs, 缺交率 2/4, one alert, 回應率 1/1.
 */

const PLAN = buildSeedPlan();
const YEN_FIXTURE = FIXTURE_NEWCOMERS.find((newcomer) => newcomer.username === "yen_yaling")!;

/** The `profiles` columns the builder reads (a real row satisfies this). */
interface TestNewcomer {
  id: string;
  display_name: string;
  status: "active" | "left" | "sample";
  start_date: string | null;
  department_id: string | null;
}

const YEN: TestNewcomer = {
  id: YEN_FIXTURE.id,
  display_name: YEN_FIXTURE.display_name,
  status: YEN_FIXTURE.status,
  start_date: YEN_FIXTURE.start_date,
  department_id: "department-procurement",
};

const SETTINGS_INPUT = {
  daily_cutoff_time: SETTINGS.daily_cutoff_time,
  workweek: SETTINGS.workweek,
} as const;

const submissionId = (seq: number) => `seq-${seq}`;

const MILESTONES = milestonesFor(YEN_FIXTURE.start_date).map((due) => ({
  user_id: YEN.id,
  kind: due.kind,
  due_date: due.due_date,
  done_at: null as string | null,
}));

const LOGS = PLAN.logs
  .filter((log) => log.username === "yen_yaling")
  .map((log) => ({ id: submissionId(log.seq), user_id: log.user_id, log_date: log.log_date }));

const ALERTS = PLAN.alerts
  .filter((alert) => alert.username === "yen_yaling")
  .map((alert) => ({
    user_id: YEN.id,
    status: alert.status,
    created_at: alert.created_at,
    responded_at: alert.responded_at,
    response_submission_id: alert.response_seq === null ? null : `response-${alert.response_seq}`,
  }));

function overviewAt(
  now: Instant,
  overrides: { newcomer?: TestNewcomer; milestones?: typeof MILESTONES } = {},
) {
  return buildNinetyDayOverview({
    newcomer: overrides.newcomer ?? YEN,
    logs: LOGS,
    alerts: ALERTS,
    milestones: overrides.milestones ?? MILESTONES,
    settings: SETTINGS_INPUT,
    now,
  });
}

describe("buildNinetyDayOverview (§11 嚴雅齡)", () => {
  it("derives 第 N 天, 階段 and 下一節點 at 9/4 18:00 (A09)", () => {
    const data = overviewAt(CLOCK_0904_1800);
    expect(data.displayName).toBe("嚴雅齡");
    expect(data.startDate).toBe(EXPECTED_MILESTONE_DUE_DATES.start_date);
    expect(data.dayNumber).toBe(4);
    expect(data.stage?.label).toBe(STAGE_LABELS[1]);
    expect(data.next).toEqual({
      kind: "D30",
      due: EXPECTED_MILESTONE_DUE_DATES.D30,
      overdueDays: 0,
    });
  });

  it("always lists the three milestones, marking the next one", () => {
    const data = overviewAt(CLOCK_0904_1800);
    expect(data.milestones.map((milestone) => milestone.kind)).toEqual(["D30", "D60", "D90"]);
    expect(data.milestones.map((milestone) => milestone.due)).toEqual([
      EXPECTED_MILESTONE_DUE_DATES.D30,
      EXPECTED_MILESTONE_DUE_DATES.D60,
      EXPECTED_MILESTONE_DUE_DATES.D90,
    ]);
    expect(data.milestones.map((milestone) => milestone.isNext)).toEqual([true, false, false]);
    expect(data.milestones.every((milestone) => milestone.doneLabel === null)).toBe(true);
  });

  it("shows a done milestone with its Taipei date and moves 下一節點 on", () => {
    const done = MILESTONES.map((milestone) =>
      milestone.kind === "D30" ? { ...milestone, done_at: "2026-10-01T02:00:00.000Z" } : milestone,
    );
    const data = overviewAt(CLOCK_0904_1800, { milestones: done });
    expect(data.milestones[0].doneLabel).toBe("2026/10/01");
    expect(data.next?.kind).toBe("D60");
    expect(data.milestones.map((milestone) => milestone.isNext)).toEqual([false, true, false]);
  });

  it("counts 累計日誌, 累計預警 and 回應率 for the whole period (A08(a))", () => {
    const data = overviewAt(CLOCK_0904_1800);
    expect(data.logCount).toBe(2);
    expect(data.alertCount).toBe(1);
    expect(data.openCount).toBe(0);
    expect(data.responseRate).toEqual({ numerator: 1, denominator: 1, rate: 1 });
  });

  it("counts 缺交率 only through the cutoff (§7, D-33)", () => {
    // 9/1 Tue – 9/4 Fri = 4 workdays once 18:00 has passed; 2 logs → 2/4.
    expect(overviewAt(CLOCK_0904_1800).missingRate).toMatchObject({
      numerator: 2,
      denominator: 4,
      rate: 0.5,
      logs: 2,
      countedThrough: "2026-09-04",
    });
    // Before the cutoff today does not count yet: 9/1–9/3 = 3 workdays.
    expect(overviewAt(CLOCK_0904_1200).missingRate).toMatchObject({
      numerator: 1,
      denominator: 3,
      logs: 2,
      countedThrough: "2026-09-03",
    });
  });

  it("still describes a newcomer who has left, with 缺交率 undefined (A02 / A08(c))", () => {
    const left: TestNewcomer = { ...YEN, status: "left" };
    const data = overviewAt(CLOCK_0904_1800, { newcomer: left });
    expect(data.dayNumber).toBe(4);
    expect(data.stage?.label).toBe(STAGE_LABELS[1]);
    expect(data.alertCount).toBe(1);
    expect(data.responseRate.rate).toBe(1);
    expect(data.missingRate).toBeNull();
  });

  it("handles a newcomer without a start date or milestones", () => {
    const noStart: TestNewcomer = { ...YEN, start_date: null };
    const data = overviewAt(CLOCK_0904_1800, { newcomer: noStart, milestones: [] });
    expect(data.dayNumber).toBeNull();
    expect(data.stage).toBeNull();
    expect(data.next).toBeNull();
    expect(data.missingRate).toBeNull();
    expect(data.milestones.map((milestone) => milestone.due)).toEqual([null, null, null]);
  });
});

describe("NinetyDayOverview component", () => {
  it("renders the day number, stage, milestones and the four numbers", () => {
    const html = renderToStaticMarkup(<NinetyDayOverview data={overviewAt(CLOCK_0904_1800)} />);
    expect(html).toContain("到職日 2026/09/01");
    expect(html).toContain("第 4 天");
    expect(html).toContain(STAGE_LABELS[1]);
    expect(html).toContain("D30");
    expect(html).toContain("2026/10/01");
    expect(html).toContain(MILESTONE_PENDING_LABEL);
    expect(html).toContain(NEXT_MILESTONE_LABEL);
    expect(html).toContain("2 筆"); // 累計日誌
    expect(html).toContain("50%"); // 缺交率
    expect(html).toContain("100%"); // 回應率
    expect(html).toContain("1 / 1");
    // 缺交率's hint names its cut-off day, so it cannot be read against 累計日誌
    expect(html).toContain(missingRateHint(overviewAt(CLOCK_0904_1800).missingRate!));
    expect(html).toContain(`${COUNTED_THROUGH_PREFIX} 2026/09/04`);
  });

  it("renders 「—」 for an undefined rate and the no-start-date wording", () => {
    const noStart: TestNewcomer = { ...YEN, start_date: null };
    const html = renderToStaticMarkup(
      <NinetyDayOverview data={overviewAt(CLOCK_0904_1800, { newcomer: noStart, milestones: [] })} />,
    );
    expect(html).toContain(NO_START_DATE_LABEL);
    expect(html).toContain(UNDEFINED_RATE_LABEL);
    expect(html).not.toContain("到職日 "); // the 「到職日 yyyy/MM/dd」 prefix is omitted
  });
});
