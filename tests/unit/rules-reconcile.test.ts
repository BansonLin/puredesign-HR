import { describe, expect, it } from "vitest";

import { bySlot } from "@/lib/forms/resolve";
import type { Question } from "@/lib/forms/schema";
import { parseRulesSettings } from "@/lib/rules/settings";
import { detailEquals, reconcile, runRules } from "@/lib/rules/run";
import type { AlertDraft, ExistingAlertLike } from "@/lib/rules/types";
import { FIXTURE_DAILY_LOGS, NEWCOMER_DAILY_QUESTIONS, RULES_SETTINGS } from "@seed/fixtures";

/**
 * T11 reconcile tests (PLAN A10 state machine), cases (a)–(g), played on
 * 嚴雅齡's 9/2 → 9/3 logs. `reconcile` touches no database; the in-memory
 * `apply` below mirrors what `applyAlertChanges` (T14) will do so (g) can
 * check that three same-day resubmits leave exactly one row per rule.
 */

const V1: readonly Question[] = NEWCOMER_DAILY_QUESTIONS;
const SETTINGS = parseRulesSettings(RULES_SETTINGS);

function logOf(username: string, logDate: string) {
  const found = FIXTURE_DAILY_LOGS.find((l) => l.username === username && l.log_date === logDate);
  if (!found) throw new Error(`no fixture log for ${username} ${logDate}`);
  return found;
}

const YEN_0902 = logOf("yen_yaling", "2026-09-02");
const YEN_0903 = logOf("yen_yaling", "2026-09-03");
const PREVIOUS = bySlot(V1, YEN_0902.answers);

/** 9/3 17:03 Taipei (= the fixture's submitted_at) and later resubmits. */
const T0 = new Date("2026-09-03T09:03:00Z");
const T1 = new Date("2026-09-03T10:30:00Z");
const T2 = new Date("2026-09-03T12:00:00Z");
const T3 = new Date("2026-09-03T15:00:00Z");

function draftsFor(answers: Record<string, string | null>): AlertDraft[] {
  return runRules({ current: bySlot(V1, answers), previous: PREVIOUS, settings: SETTINGS });
}

/** In-memory `alerts` row (the columns `applyAlertChanges` writes). */
interface Row extends ExistingAlertLike {
  id: string;
  created_at: string;
  responded_at: string | null;
  response_submission_id: string | null;
  closed_at: string | null;
  closed_by: string | null;
  closed_reason: string | null;
}

let nextId = 1;

function apply(rows: readonly Row[], drafts: readonly AlertDraft[], now: Date): Row[] {
  const plan = reconcile({ existing: rows, drafts, now });
  const next: Row[] = [];
  for (const row of rows) {
    const update = plan.updateDetail.find((u) => u.alert === row);
    const close = plan.close.find((c) => c.alert === row);
    const reopen = plan.reopen.find((r) => r.alert === row);
    if (update) next.push({ ...row, detail: update.detail });
    else if (close) {
      next.push({
        ...row,
        status: "closed",
        closed_at: close.closed_at,
        closed_by: null,
        closed_reason: close.closed_reason,
      });
    } else if (reopen) {
      next.push({
        ...row,
        status: "open",
        detail: reopen.detail,
        created_at: reopen.created_at,
        responded_at: null,
        response_submission_id: null,
        closed_at: null,
        closed_by: null,
        closed_reason: null,
      });
    } else {
      expect(plan.untouched).toContain(row);
      next.push(row);
    }
  }
  for (const insert of plan.insert) {
    next.push({
      id: `alert-${nextId++}`,
      rule_key: insert.rule_key,
      detail: insert.detail,
      status: "open",
      created_at: insert.created_at,
      responded_at: null,
      response_submission_id: null,
      closed_at: null,
      closed_by: null,
      closed_reason: null,
    });
  }
  return next;
}

const ORIGINAL_DRAFTS = draftsFor(YEN_0903.answers);

/** 9/3 with only `r1_reason` reworded. */
const REASON_CHANGED = { ...YEN_0903.answers, r1_reason: "工項明細已請 Patty 補" };

/** 9/3 with all three results 完成 (R1 no longer holds). */
const ALL_DONE = {
  ...YEN_0903.answers,
  r1_status: "完成",
  r1_reason: null,
  r2_status: "完成",
  r3_status: "完成",
  r3_reason: null,
};

function openR1(): Row {
  return {
    id: "alert-r1",
    rule_key: "R1",
    detail: ORIGINAL_DRAFTS[0].detail,
    status: "open",
    created_at: T0.toISOString(),
    responded_at: null,
    response_submission_id: null,
    closed_at: null,
    closed_by: null,
    closed_reason: null,
  };
}

describe("reconcile (PLAN A10)", () => {
  it("(a) first submission → insert exactly one R1 with created_at = now", () => {
    expect(ORIGINAL_DRAFTS.map((d) => d.rule_key)).toEqual(["R1"]);
    const plan = reconcile({ existing: [], drafts: ORIGINAL_DRAFTS, now: T0 });
    expect(plan).toEqual({
      insert: [{ rule_key: "R1", detail: ORIGINAL_DRAFTS[0].detail, created_at: T0.toISOString() }],
      updateDetail: [],
      close: [],
      reopen: [],
      untouched: [],
    });
  });

  it("(b) unchanged resubmit → everything untouched", () => {
    const existing = openR1();
    const plan = reconcile({ existing: [existing], drafts: draftsFor(YEN_0903.answers), now: T1 });
    expect(plan.insert).toEqual([]);
    expect(plan.updateDetail).toEqual([]);
    expect(plan.close).toEqual([]);
    expect(plan.reopen).toEqual([]);
    expect(plan.untouched).toEqual([existing]);
  });

  it("(c) only r1_reason changed → updateDetail, created_at unchanged", () => {
    const existing = openR1();
    const drafts = draftsFor(REASON_CHANGED);
    const plan = reconcile({ existing: [existing], drafts, now: T1 });
    expect(plan.updateDetail).toHaveLength(1);
    expect(plan.updateDetail[0].alert).toBe(existing);
    expect(plan.updateDetail[0].detail).toEqual({
      items: [
        {
          i: 1,
          plan_text: "請款總表移到新表單",
          status: "持續中",
          reason: "工項明細已請 Patty 補",
        },
        { i: 3, plan_text: "鋁門窗宏偉報價", status: "持續中", reason: "宏偉訂金確認中" },
      ],
    });
    expect(plan.updateDetail[0]).not.toHaveProperty("created_at");
    expect(plan.insert).toEqual([]);
    expect(plan.close).toEqual([]);
    expect(plan.reopen).toEqual([]);
    expect(plan.untouched).toEqual([]);
    const rows = apply([existing], drafts, T1);
    expect(rows).toHaveLength(1);
    expect(rows[0].created_at).toBe(T0.toISOString());
    expect(rows[0].status).toBe("open");
  });

  it("(d) all three items done and open → close with reason resubmitted at now", () => {
    const existing = openR1();
    const drafts = draftsFor(ALL_DONE);
    expect(drafts).toEqual([]);
    const plan = reconcile({ existing: [existing], drafts, now: T1 });
    expect(plan.close).toEqual([
      { alert: existing, closed_at: T1.toISOString(), closed_reason: "resubmitted" },
    ]);
    expect(plan.insert).toEqual([]);
    expect(plan.updateDetail).toEqual([]);
    expect(plan.reopen).toEqual([]);
    expect(plan.untouched).toEqual([]);
    const rows = apply([existing], drafts, T1);
    expect(rows[0]).toMatchObject({
      status: "closed",
      closed_at: T1.toISOString(),
      closed_by: null,
      closed_reason: "resubmitted",
      created_at: T0.toISOString(),
    });
  });

  it("(e) same as (d) but responded → untouched", () => {
    const responded: Row = {
      ...openR1(),
      status: "responded",
      responded_at: "2026-09-04T01:10:00Z",
      response_submission_id: "resp-9",
    };
    const plan = reconcile({ existing: [responded], drafts: draftsFor(ALL_DONE), now: T1 });
    expect(plan.untouched).toEqual([responded]);
    expect(plan.close).toEqual([]);
    expect(plan.updateDetail).toEqual([]);
    expect(plan.insert).toEqual([]);
    expect(plan.reopen).toEqual([]);
  });

  it("(e′) responded and still holding with a new reason → untouched (no detail rewrite)", () => {
    const responded: Row = {
      ...openR1(),
      status: "responded",
      responded_at: "2026-09-04T01:10:00Z",
      response_submission_id: "resp-9",
    };
    const plan = reconcile({ existing: [responded], drafts: draftsFor(REASON_CHANGED), now: T1 });
    expect(plan.untouched).toEqual([responded]);
    expect(plan.updateDetail).toEqual([]);
  });

  it("(f) closed then holding again → reopen with created_at = now, closed_* / responded_* cleared", () => {
    const closed: Row = {
      ...openR1(),
      status: "closed",
      closed_at: T1.toISOString(),
      closed_by: null,
      closed_reason: "resubmitted",
    };
    const drafts = draftsFor(YEN_0903.answers);
    const plan = reconcile({ existing: [closed], drafts, now: T2 });
    expect(plan.reopen).toEqual([
      { alert: closed, detail: ORIGINAL_DRAFTS[0].detail, created_at: T2.toISOString() },
    ]);
    expect(plan.insert).toEqual([]);
    expect(plan.close).toEqual([]);
    expect(plan.updateDetail).toEqual([]);
    expect(plan.untouched).toEqual([]);
    const rows = apply([closed], drafts, T2);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      ...closed,
      status: "open",
      created_at: T2.toISOString(),
      responded_at: null,
      response_submission_id: null,
      closed_at: null,
      closed_by: null,
      closed_reason: null,
    });
  });

  it("(f′) closed and still not holding → untouched", () => {
    const closed: Row = {
      ...openR1(),
      status: "closed",
      closed_at: T1.toISOString(),
      closed_reason: "resubmitted",
    };
    const plan = reconcile({ existing: [closed], drafts: draftsFor(ALL_DONE), now: T2 });
    expect(plan.untouched).toEqual([closed]);
    expect(plan.reopen).toEqual([]);
    expect(plan.close).toEqual([]);
  });

  it("(g) three same-day resubmits leave exactly one row per rule", () => {
    let rows: Row[] = [];
    rows = apply(rows, draftsFor(YEN_0903.answers), T0); // holds → insert
    rows = apply(rows, draftsFor(ALL_DONE), T1); // gone → closed
    rows = apply(rows, draftsFor(REASON_CHANGED), T2); // back → reopen
    rows = apply(rows, draftsFor(YEN_0903.answers), T3); // still holds → updateDetail
    expect(rows).toHaveLength(1);
    expect(rows.filter((r) => r.rule_key === "R1")).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "alert-1",
      rule_key: "R1",
      status: "open",
      created_at: T2.toISOString(),
      detail: ORIGINAL_DRAFTS[0].detail,
      closed_at: null,
      closed_reason: null,
    });
  });

  it("mixed: R1 gone, R2 new in one resubmit → close R1, insert R2", () => {
    const existing = openR1();
    const withBlocker = {
      ...ALL_DONE,
      blocker: "有，尚未回報",
      blocker_detail: "宏偉還沒回覆",
    };
    const plan = reconcile({ existing: [existing], drafts: draftsFor(withBlocker), now: T1 });
    expect(plan.close.map((c) => c.alert.rule_key)).toEqual(["R1"]);
    expect(plan.insert).toEqual([
      { rule_key: "R2", detail: { text: "宏偉還沒回覆" }, created_at: T1.toISOString() },
    ]);
    expect(plan.untouched).toEqual([]);
  });

  it("accepts an ISO string with offset as now and normalizes to UTC", () => {
    const plan = reconcile({ existing: [], drafts: ORIGINAL_DRAFTS, now: "2026-09-03T17:03:00+08:00" });
    expect(plan.insert[0].created_at).toBe("2026-09-03T09:03:00.000Z");
  });

  it("detailEquals ignores key order and treats undefined as absent", () => {
    expect(detailEquals({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 })).toBe(true);
    expect(detailEquals({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(detailEquals({ a: 1 }, { a: "1" })).toBe(false);
    expect(detailEquals([1, 2], [2, 1])).toBe(false);
    expect(detailEquals(null, {})).toBe(false);
  });
});
