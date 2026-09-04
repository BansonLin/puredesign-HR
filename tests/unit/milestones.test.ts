import { describe, expect, it } from "vitest";
import {
  MILESTONE_KINDS,
  STAGE_LABELS,
  milestonesFor,
  nextMilestone,
  stageOf,
  type MilestoneLike,
} from "@/lib/time/milestones";
import { dayNumber } from "@/lib/time";

// §11 fixture: every newcomer starts on 2026-09-01.
const START = "2026-09-01";

function rows(done: Partial<Record<"D30" | "D60" | "D90", string>> = {}): MilestoneLike[] {
  return milestonesFor(START).map((m) => ({
    ...m,
    done_at: done[m.kind] ?? null,
  }));
}

describe("milestonesFor", () => {
  it("returns D30/D60/D90 at +30/+60/+90 days (§11: 10/01, 10/31, 11/30)", () => {
    expect(milestonesFor(START)).toEqual([
      { kind: "D30", due_date: "2026-10-01" },
      { kind: "D60", due_date: "2026-10-31" },
      { kind: "D90", due_date: "2026-11-30" },
    ]);
    expect(MILESTONE_KINDS).toEqual(["D30", "D60", "D90"]);
  });

  it("crosses a year boundary", () => {
    expect(milestonesFor("2026-12-15").map((m) => m.due_date)).toEqual([
      "2027-01-14",
      "2027-02-13",
      "2027-03-15",
    ]);
  });

  it("rejects non YYYY-MM-DD input", () => {
    expect(() => milestonesFor("2026/09/01")).toThrow(RangeError);
  });
});

describe("stageOf (A09 four stages)", () => {
  it("stage 1 before D30 is done or due", () => {
    expect(stageOf(rows(), "2026-09-04")).toEqual({ no: 1, label: "第一階段（D30 前）" });
    expect(stageOf(rows(), "2026-09-30")?.no).toBe(1); // day 30, the day before D30 is due
  });

  it("stage 2 from the D30 due date (day 31, undone) or once D30 is done", () => {
    expect(dayNumber(START, "2026-10-01")).toBe(31);
    expect(stageOf(rows(), "2026-10-01")).toEqual({ no: 2, label: "第二階段（D60 前）" });
    expect(stageOf(rows(), "2026-10-02")?.no).toBe(2);
    expect(stageOf(rows({ D30: "2026-09-30T02:00:00Z" }), "2026-09-30")?.no).toBe(2);
  });

  it("stage 3 from the D60 due date (day 61) or once D60 is done", () => {
    expect(dayNumber(START, "2026-10-31")).toBe(61);
    expect(stageOf(rows(), "2026-10-30")?.no).toBe(2);
    expect(stageOf(rows(), "2026-10-31")).toEqual({ no: 3, label: "第三階段（D90 前）" });
    expect(stageOf(rows(), "2026-11-01")?.no).toBe(3);
    expect(
      stageOf(rows({ D30: "2026-10-01T02:00:00Z", D60: "2026-10-30T02:00:00Z" }), "2026-10-30")
        ?.no,
    ).toBe(3);
  });

  it("stage 4 (已滿 90 天) when D90 is done or from day 91 (A09)", () => {
    // D90 due_date = start + 90 is day 91: "第 91 天起「已滿 90 天」".
    expect(dayNumber(START, "2026-11-30")).toBe(91);
    expect(stageOf(rows(), "2026-11-29")?.no).toBe(3); // day 90
    expect(stageOf(rows(), "2026-11-30")).toEqual({ no: 4, label: "已滿 90 天" });
    expect(stageOf(rows(), "2026-12-01")).toEqual({ no: 4, label: "已滿 90 天" });
    expect(
      stageOf(
        rows({
          D30: "2026-10-01T02:00:00Z",
          D60: "2026-10-31T02:00:00Z",
          D90: "2026-11-28T02:00:00Z",
        }),
        "2026-11-28",
      ),
    ).toEqual({ no: 4, label: STAGE_LABELS[4] });
  });

  it("returns null when milestones are missing (no start date)", () => {
    expect(stageOf([], "2026-09-04")).toBeNull();
    expect(stageOf(rows().slice(0, 2), "2026-09-04")).toBeNull();
  });
});

describe("nextMilestone (A09)", () => {
  it("returns the earliest pending milestone", () => {
    expect(nextMilestone(rows(), "2026-09-04")).toEqual({
      kind: "D30",
      due: "2026-10-01",
      overdueDays: 0,
    });
  });

  it("skips done milestones regardless of array order", () => {
    const shuffled = [...rows({ D30: "2026-10-01T02:00:00Z" })].reverse();
    expect(nextMilestone(shuffled, "2026-10-02")).toMatchObject({
      kind: "D60",
      due: "2026-10-31",
      overdueDays: 0,
    });
  });

  it("reports overdueDays when the pending milestone is past due", () => {
    expect(nextMilestone(rows(), "2026-10-06")).toEqual({
      kind: "D30",
      due: "2026-10-01",
      overdueDays: 5,
    });
    expect(nextMilestone(rows(), "2026-10-01")?.overdueDays).toBe(0);
  });

  it("returns null when everything is done or nothing exists", () => {
    expect(
      nextMilestone(
        rows({
          D30: "2026-10-01T02:00:00Z",
          D60: "2026-10-31T02:00:00Z",
          D90: "2026-11-30T02:00:00Z",
        }),
        "2026-12-01",
      ),
    ).toBeNull();
    expect(nextMilestone([], "2026-09-04")).toBeNull();
  });
});
