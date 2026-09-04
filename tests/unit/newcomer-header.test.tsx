import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ALL_MILESTONES_DONE_LABEL,
  NO_MILESTONES_LABEL,
  NO_START_DATE_LABEL,
  NOT_STARTED_LABEL,
  NewcomerHeader,
  newcomerStatusLine,
} from "@/components/dashboard/NewcomerHeader";
import { milestonesFor, type MilestoneLike } from "@/lib/time/milestones";
import { FIXTURE_START_DATE } from "@seed/fixtures";

/**
 * T15 `NewcomerHeader` (PLAN A09) through react-dom/server, like the
 * renderer tests: Darren on 2026-09-03, no start date, a future start date
 * and an overdue milestone.
 */

/** The §11 milestones of a newcomer who started on `start` (none done unless listed). */
function rows(
  start: string,
  done: Partial<Record<"D30" | "D60" | "D90", string>> = {},
): MilestoneLike[] {
  return milestonesFor(start).map((m) => ({
    kind: m.kind,
    due_date: m.due_date,
    done_at: done[m.kind] ?? null,
  }));
}

function render(props: {
  displayName?: string;
  startDate: string | null;
  milestones: readonly MilestoneLike[];
  today: string;
}) {
  return renderToStaticMarkup(
    <NewcomerHeader
      displayName={props.displayName ?? "Darren"}
      startDate={props.startDate}
      milestones={props.milestones}
      today={props.today}
    />,
  );
}

describe("NewcomerHeader (A09)", () => {
  it("Darren on 2026-09-03 → 第 3 天｜第一階段（D30 前）｜下一節點 D30 2026-10-01", () => {
    const html = render({
      startDate: FIXTURE_START_DATE,
      milestones: rows(FIXTURE_START_DATE),
      today: "2026-09-03",
    });
    expect(html).toContain("Darren");
    expect(html).toContain("第 3 天");
    expect(html).toContain("第一階段（D30 前）");
    expect(html).toContain("D30");
    expect(html).toContain("2026-10-01");
    expect(html).not.toContain("逾期");
    expect(html).toContain('data-testid="newcomer-status"');
    expect(html).toContain('aria-label="新人狀態"');
    expect(
      newcomerStatusLine({
        startDate: FIXTURE_START_DATE,
        milestones: rows(FIXTURE_START_DATE),
        today: "2026-09-03",
      }),
    ).toBe("第 3 天｜第一階段（D30 前）｜下一節點 D30 2026-10-01");
  });

  it("start_date null → 尚未設定到職日 (and nothing else)", () => {
    const html = render({ startDate: null, milestones: [], today: "2026-09-03" });
    expect(html).toContain(NO_START_DATE_LABEL);
    expect(html).not.toContain("第 ");
    expect(html).not.toContain("階段");
  });

  it("start_date in the future → 第 0 天｜尚未到職", () => {
    const html = render({
      startDate: "2026-09-10",
      milestones: rows("2026-09-10"),
      today: "2026-09-03",
    });
    expect(html).toContain("第 0 天");
    expect(html).toContain(NOT_STARTED_LABEL);
    expect(html).not.toContain("階段");
  });

  it("an overdue pending milestone → 逾期 N 天", () => {
    const html = render({
      startDate: FIXTURE_START_DATE,
      milestones: rows(FIXTURE_START_DATE),
      today: "2026-10-05",
    });
    expect(html).toContain("第 35 天");
    // D30 is due (day 31 onwards) but not done: stage 2, next milestone still D30, overdue 4 days
    expect(html).toContain("第二階段（D60 前）");
    expect(html).toContain("逾期");
    expect(html).toContain("下一節點 D30 2026-10-01（逾期 4 天）");
  });

  it("a done D30 → next milestone D60, no 逾期", () => {
    const html = render({
      startDate: FIXTURE_START_DATE,
      milestones: rows(FIXTURE_START_DATE, { D30: "2026-10-01T02:00:00Z" }),
      today: "2026-10-05",
    });
    expect(html).toContain("下一節點 D60 2026-10-31");
    expect(html).not.toContain("逾期");
  });

  it("no milestone rows → 尚未建立節點; all done → 節點皆已完成", () => {
    expect(render({ startDate: FIXTURE_START_DATE, milestones: [], today: "2026-09-03" })).toContain(
      NO_MILESTONES_LABEL,
    );
    const allDone = rows(FIXTURE_START_DATE, {
      D30: "2026-10-01T02:00:00Z",
      D60: "2026-10-31T02:00:00Z",
      D90: "2026-11-30T02:00:00Z",
    });
    const html = render({ startDate: FIXTURE_START_DATE, milestones: allDone, today: "2026-12-05" });
    expect(html).toContain("已滿 90 天");
    expect(html).toContain(ALL_MILESTONES_DONE_LABEL);
  });
});
