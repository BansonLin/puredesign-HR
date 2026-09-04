import { describe, expect, it } from "vitest";

import {
  bySlot,
  EMPTY_YESTERDAY_PLAN,
  evaluateShowIf,
  getAnswer,
  readYesterdayPlan,
  resolveVisibility,
  visibleQuestions,
} from "@/lib/forms/resolve";
import { parseQuestions, type Answers, type Question } from "@/lib/forms/schema";
import { SLOTS } from "@/lib/forms/slots";
import { FIXTURE_DAILY_LOGS, NEWCOMER_DAILY_QUESTIONS } from "@seed/fixtures";

/**
 * T10 resolve tests (CLAUDE.md §6, PLAN A07 / A11). Fixture = newcomer_daily
 * v1 and the §11 logs.
 */

const V1: readonly Question[] = NEWCOMER_DAILY_QUESTIONS;

function log(seq: number) {
  const found = FIXTURE_DAILY_LOGS.find((l) => l.seq === seq);
  if (!found) throw new Error(`no fixture log seq ${seq}`);
  return found;
}

function keys(questions: readonly Question[]): string[] {
  return questions.map((q) => q.key);
}

/**
 * v2 of newcomer_daily (PLAN T10 cross-version case): `p1_text` is disabled
 * with its slot cleared, a new key `tomorrow_1` binds `plan.item1.text`, and
 * the two blocks swap places (plan questions first, results after) — every
 * show_if still points backwards, so v2 is publishable.
 */
function buildV2(): Question[] {
  const v2: Question[] = V1.map((q) => {
    if (q.key === "p1_text") return { ...q, disabled: true, slot: null, order: 100 };
    return { ...q, order: q.order >= 11 ? q.order - 10 : q.order + 10 };
  });
  v2.push({
    key: "tomorrow_1",
    label: "明天要做的第一件事",
    type: "short_text",
    required: true,
    slot: "plan.item1.text",
    order: 1,
    disabled: false,
  });
  return v2;
}

/** Rewrite v1 answers as a v2 log: `tomorrow_1` carries what `p1_text` did. */
function toV2Answers(answers: Readonly<Record<string, string | null>>): Answers {
  const { p1_text, ...rest } = answers;
  return { ...rest, p1_text: null, tomorrow_1: p1_text ?? null };
}

describe("getAnswer (A11)", () => {
  it("returns null for a missing key, empty string, non-string or null answers", () => {
    expect(getAnswer({}, "x")).toBeNull();
    expect(getAnswer({ x: "" }, "x")).toBeNull();
    expect(getAnswer({ x: null }, "x")).toBeNull();
    expect(getAnswer({ x: 3 }, "x")).toBeNull();
    expect(getAnswer(null, "x")).toBeNull();
    expect(getAnswer(undefined, "x")).toBeNull();
  });

  it("returns the string as stored", () => {
    expect(getAnswer({ x: "完成" }, "x")).toBe("完成");
    expect(getAnswer(log(1).answers, "p1_text")).toBe("繼續跟著博凱跑案場");
  });
});

describe("evaluateShowIf truth table (A11)", () => {
  const eq = { question_key: "a", op: "eq", value: "需要" } as const;
  const neq = { question_key: "a", op: "neq", value: "沒有" } as const;
  const inOp = { question_key: "a", op: "in", value: ["持續中", "取消"] } as const;
  const notEmpty = { question_key: "a", op: "not_empty" } as const;

  it("every op is false when the target answer is null / missing / empty", () => {
    for (const answers of [{}, { a: null }, { a: "" }]) {
      expect(evaluateShowIf(eq, answers)).toBe(false);
      expect(evaluateShowIf(neq, answers)).toBe(false);
      expect(evaluateShowIf(inOp, answers)).toBe(false);
      expect(evaluateShowIf(notEmpty, answers)).toBe(false);
    }
  });

  it("eq / neq compare the full string; in uses includes; not_empty is true for any value", () => {
    expect(evaluateShowIf(eq, { a: "需要" })).toBe(true);
    expect(evaluateShowIf(eq, { a: "需要 " })).toBe(false);
    expect(evaluateShowIf(eq, { a: "不需要" })).toBe(false);
    expect(evaluateShowIf(neq, { a: "沒有" })).toBe(false);
    expect(evaluateShowIf(neq, { a: "有，已解決" })).toBe(true);
    expect(evaluateShowIf(inOp, { a: "取消" })).toBe(true);
    expect(evaluateShowIf(inOp, { a: "完成" })).toBe(false);
    expect(evaluateShowIf(notEmpty, { a: "x" })).toBe(true);
  });

  it("no show_if means always visible", () => {
    expect(evaluateShowIf(undefined, {})).toBe(true);
  });
});

describe("visibleQuestions (§6, A07)", () => {
  const base: Answers = { ...log(1).answers };

  it("r1_status='持續中' shows r1_reason; '完成' hides it", () => {
    expect(keys(visibleQuestions(V1, { ...base, r1_status: "持續中" }))).toContain("r1_reason");
    expect(keys(visibleQuestions(V1, { ...base, r1_status: "完成" }))).not.toContain("r1_reason");
  });

  it("empty p2_text hides p2_expect", () => {
    const shown = keys(visibleQuestions(V1, { ...base, p2_text: null }));
    expect(shown).not.toContain("p2_expect");
    expect(keys(visibleQuestions(V1, { ...base, p2_text: "看木作功法百科" }))).toContain(
      "p2_expect",
    );
  });

  it("blocker='沒有' hides blocker_detail; any other value shows it", () => {
    expect(keys(visibleQuestions(V1, { ...base, blocker: "沒有" }))).not.toContain(
      "blocker_detail",
    );
    expect(keys(visibleQuestions(V1, { ...base, blocker: "有，尚未回報" }))).toContain(
      "blocker_detail",
    );
  });

  it("disabled questions are never visible and their answer is forced to null", () => {
    const v2 = buildV2();
    const { visible, effective } = resolveVisibility(v2, {
      ...toV2Answers(log(1).answers),
      p1_text: "should be dropped",
    });
    expect(keys(visible)).not.toContain("p1_text");
    expect(keys(visible)).toContain("tomorrow_1");
    expect(effective.p1_text).toBeNull();
  });

  it("returns questions in order and hidden questions read as null for later conditions (chain)", () => {
    const chain: Question[] = [
      { key: "a", label: "A", type: "single_select", options: ["x", "y"], required: true, order: 1, disabled: false },
      { key: "b", label: "B", type: "short_text", required: false, show_if: { question_key: "a", op: "eq", value: "x" }, order: 2, disabled: false },
      { key: "c", label: "C", type: "short_text", required: false, show_if: { question_key: "b", op: "not_empty" }, order: 3, disabled: false },
    ];
    // b is filled but hidden (a='y') → c must be hidden too
    const { visible, effective } = resolveVisibility(chain.slice().reverse(), { a: "y", b: "filled", c: "z" });
    expect(keys(visible)).toEqual(["a"]);
    expect(effective).toEqual({ a: "y", b: null, c: null });
    expect(keys(visibleQuestions(chain, { a: "x", b: "filled", c: "z" }))).toEqual(["a", "b", "c"]);
  });
});

describe("bySlot (§6)", () => {
  it("maps every bound slot of v1 for 嚴雅齡 9/2", () => {
    const slots = bySlot(V1, log(2).answers);
    expect(slots["plan.item1.text"]).toBe("請款總表移到新表單");
    expect(slots["plan.item1.expect"]).toBe("完成");
    expect(slots["plan.item2.text"]).toBe("裕福門窗報價");
    expect(slots["plan.item3.expect"]).toBe("完成");
    expect(slots["plan.top_priority"]).toBe("項目二");
    expect(slots["result.item1.status"]).toBe("昨日無此項");
    expect(slots["result.item1.reason"]).toBeNull();
    expect(slots["result.blocker.status"]).toBe("沒有");
    expect(slots["plan.support.need"]).toBe("不需要");
    expect(slots["plan.support.detail"]).toBeNull();
    expect(slots["response.status"]).toBeUndefined();
  });

  it("only ever emits §6 slots, one entry per bound question, for every fixture log", () => {
    const boundSlots = V1.map((q) => q.slot).filter((s): s is NonNullable<typeof s> => !!s);
    for (const l of FIXTURE_DAILY_LOGS) {
      const slots = bySlot(V1, l.answers);
      const emitted = Object.keys(slots);
      expect(emitted.sort()).toEqual([...boundSlots].sort());
      for (const slot of emitted) expect(SLOTS).toContain(slot);
    }
  });

  it("ignores disabled questions even if they still carry a slot (A07)", () => {
    const v = V1.map((q) => (q.key === "learned" ? { ...q, disabled: true } : q));
    expect(bySlot(v, log(5).answers)["result.learned"]).toBeUndefined();
    expect(bySlot(V1, log(5).answers)["result.learned"]).toBe("知道哪裡看施工進度");
  });

  it("applies show_if: a hidden reason reads as null even if a value is stored", () => {
    const slots = bySlot(V1, { ...log(5).answers, r1_status: "完成", r1_reason: "stale" });
    expect(slots["result.item1.reason"]).toBeNull();
  });
});

describe("readYesterdayPlan (§6 / §8 昨日計畫)", () => {
  it("嚴雅齡 9/2 → three items with expect '完成', top=項目二", () => {
    const plan = readYesterdayPlan(log(2).answers, V1);
    expect(plan.items).toEqual([
      { text: "請款總表移到新表單", expect: "完成" },
      { text: "裕福門窗報價", expect: "完成" },
      { text: "鋁門窗宏偉報價", expect: "完成" },
    ]);
    expect(plan.top).toBe("項目二");
    expect(plan.support).toEqual({ need: "不需要", detail: null });
  });

  it("謝文心 9/2 → item2 and item3 are {null, null}", () => {
    const plan = readYesterdayPlan(log(3).answers, V1);
    expect(plan.items[0]).toEqual({ text: "改昨天的圖", expect: "完成" });
    expect(plan.items[1]).toEqual({ text: null, expect: null });
    expect(plan.items[2]).toEqual({ text: null, expect: null });
  });

  it("Darren 9/2 → item2 expect '跨日'", () => {
    const plan = readYesterdayPlan(log(1).answers, V1);
    expect(plan.items[1]).toEqual({ text: "看木作功法百科", expect: "跨日" });
    expect(plan.top).toBe("項目一");
  });

  it("previousLog=null → all three items empty, top/support null", () => {
    const plan = readYesterdayPlan(null, V1);
    expect(plan).toEqual(EMPTY_YESTERDAY_PLAN);
    expect(plan.items).toEqual([
      { text: null, expect: null },
      { text: null, expect: null },
      { text: null, expect: null },
    ]);
    expect(plan.top).toBeNull();
    expect(readYesterdayPlan(log(2).answers, null)).toEqual(EMPTY_YESTERDAY_PLAN);
  });

  it("cross-version: a v2 log (tomorrow_1, disabled p1_text, swapped order) reads the same as v1", () => {
    const v2 = buildV2();
    const parsed = parseQuestions(v2);
    expect(parsed.ok).toBe(true);
    for (const l of FIXTURE_DAILY_LOGS) {
      const fromV1 = readYesterdayPlan(l.answers, V1);
      const fromV2 = readYesterdayPlan(toV2Answers(l.answers), v2);
      expect(fromV2).toEqual(fromV1);
    }
    const yen = readYesterdayPlan(toV2Answers(log(2).answers), v2);
    expect(yen.items[0]).toEqual({ text: "請款總表移到新表單", expect: "完成" });
    // a stale p1_text value on the disabled question must not leak through
    const stale = readYesterdayPlan({ ...toV2Answers(log(2).answers), p1_text: "舊值" }, v2);
    expect(stale.items[0].text).toBe("請款總表移到新表單");
  });
});
