import { describe, expect, it } from "vitest";

import { parseQuestions, type Question } from "@/lib/forms/schema";
import {
  RULE_REQUIRED_SLOTS,
  SLOT_SPECS,
  SLOTS,
  SYSTEM_SLOTS,
  isSlot,
  requiredSlotsFor,
} from "@/lib/forms/slots";
import { validatePublish } from "@/lib/forms/validate";
import {
  R1_DEFAULT_PARAMS,
  R2_DEFAULT_PARAMS,
  RESPONSE_STATUS_NEED_HR,
  RESPONSE_STATUS_NO_ACTION,
  RESPONSE_STATUS_REQUIRED_OPTIONS,
  RULES_DEFAULTS,
  type RulesSettings,
} from "@/lib/rules/constants";
import {
  MANAGER_RESPONSE_QUESTIONS,
  NEWCOMER_DAILY_QUESTIONS,
  RULES_SETTINGS,
  WEEKLY_FEEDBACK_QUESTIONS,
} from "@seed/fixtures";

/**
 * T10 publish-time tests: slots (A06), `parseQuestions` (zod), `validatePublish`
 * (§6 publish checks, A06 / A07 / A12) and the constants ↔ seed pin.
 */

const DAILY: readonly Question[] = NEWCOMER_DAILY_QUESTIONS;
const RESPONSE: readonly Question[] = MANAGER_RESPONSE_QUESTIONS;
const WEEKLY: readonly Question[] = WEEKLY_FEEDBACK_QUESTIONS;

/** Mutable deep copy of `settings.rules` for parameterized cases. */
function rules(): RulesSettings {
  return JSON.parse(JSON.stringify(RULES_SETTINGS)) as RulesSettings;
}

function daily(mutate: (q: Question) => Question = (q) => q): Question[] {
  return DAILY.map((q) => mutate({ ...q }));
}

function publishDaily(questions: readonly Question[], r: RulesSettings = rules()) {
  return validatePublish(questions, r, { templateKey: "newcomer_daily" });
}

/** CLAUDE.md §6 slot list, verbatim and in order. */
const SECTION_6_SLOTS = [
  "plan.item1.text", "plan.item1.expect", "plan.item2.text", "plan.item2.expect",
  "plan.item3.text", "plan.item3.expect", "plan.top_priority", "plan.support.need",
  "plan.support.detail",
  "result.item1.status", "result.item1.reason", "result.item2.status", "result.item2.reason",
  "result.item3.status", "result.item3.reason", "result.extra_work", "result.blocker.status",
  "result.blocker.detail", "result.learned",
  "response.status", "response.comment",
  "weekly.start_date", "weekly.good", "weekly.improve", "weekly.next_focus",
];

describe("lib/rules/constants ↔ seed RULES_SETTINGS (A06)", () => {
  it("RULES_SETTINGS deep-equals RULES_DEFAULTS (R1 / R2 params, R3 / A1 enabled)", () => {
    expect(RULES_SETTINGS).toEqual(RULES_DEFAULTS);
    expect(RULES_SETTINGS.R1.params).toEqual(R1_DEFAULT_PARAMS);
    expect(RULES_SETTINGS.R2.params).toEqual(R2_DEFAULT_PARAMS);
    expect(R1_DEFAULT_PARAMS).toEqual({ expect_done: "完成", status_done: ["完成", "昨日無此項"] });
    expect(R2_DEFAULT_PARAMS).toEqual({ unreported: "有，尚未回報" });
  });

  it("the two response.status literals match §7 and the manager_response v1 options", () => {
    expect(RESPONSE_STATUS_NO_ACTION).toBe("已讀，無需處理");
    expect(RESPONSE_STATUS_NEED_HR).toBe("需 HR 協助");
    const status = RESPONSE.find((q) => q.slot === "response.status")!;
    for (const value of RESPONSE_STATUS_REQUIRED_OPTIONS) expect(status.options).toContain(value);
  });
});

describe("lib/forms/slots (§6, A06)", () => {
  it("exports the 25 §6 slots verbatim, in order", () => {
    expect([...SLOTS]).toEqual(SECTION_6_SLOTS);
    expect(SLOTS).toHaveLength(25);
    expect(new Set(SLOTS).size).toBe(25);
  });

  it("system slots are exactly_one, all others at_most_one; response.status carries requiredOptions", () => {
    expect([...SYSTEM_SLOTS]).toEqual([
      "plan.item1.text", "plan.item1.expect", "response.status", "weekly.start_date",
    ]);
    for (const slot of SLOTS) {
      const spec = SLOT_SPECS[slot];
      expect(spec.cardinality).toBe(
        (SYSTEM_SLOTS as readonly string[]).includes(slot) ? "exactly_one" : "at_most_one",
      );
      expect(spec.requiredOptions).toEqual(
        slot === "response.status" ? ["已讀，無需處理", "需 HR 協助"] : [],
      );
      expect(spec.template).toBe(
        slot.startsWith("response.") ? "manager_response"
          : slot.startsWith("weekly.") ? "weekly_feedback"
            : "newcomer_daily",
      );
    }
  });

  it("RULE_REQUIRED_SLOTS: R1 = plan.item{i}.expect + result.item{i}.status, R2 = result.blocker.status", () => {
    expect([...RULE_REQUIRED_SLOTS.R1].sort()).toEqual([
      "plan.item1.expect", "plan.item2.expect", "plan.item3.expect",
      "result.item1.status", "result.item2.status", "result.item3.status",
    ]);
    expect([...RULE_REQUIRED_SLOTS.R2]).toEqual(["result.blocker.status"]);
    expect(RULE_REQUIRED_SLOTS.R3).toEqual([]);
    expect(RULE_REQUIRED_SLOTS.A1).toEqual([]);
  });

  it("requiredSlotsFor: system slots always, rule slots only while enabled", () => {
    expect(requiredSlotsFor("newcomer_daily", rules())).toEqual([
      "plan.item1.text", "plan.item1.expect", "plan.item2.expect", "plan.item3.expect",
      "result.item1.status", "result.item2.status", "result.item3.status", "result.blocker.status",
    ]);
    const r = rules();
    r.R1.enabled = false;
    r.R2.enabled = false;
    expect(requiredSlotsFor("newcomer_daily", r)).toEqual(["plan.item1.text", "plan.item1.expect"]);
    expect(requiredSlotsFor("newcomer_daily", null)).toEqual(["plan.item1.text", "plan.item1.expect"]);
    expect(requiredSlotsFor("manager_response", rules())).toEqual(["response.status"]);
    expect(requiredSlotsFor("weekly_feedback", rules())).toEqual(["weekly.start_date"]);
  });

  it("isSlot", () => {
    expect(isSlot("plan.item1.text")).toBe(true);
    expect(isSlot("plan.item4.text")).toBe(false);
    expect(isSlot(null)).toBe(false);
  });
});

describe("parseQuestions (zod, §6 Question)", () => {
  it("accepts the three v1 seeds unchanged", () => {
    for (const seed of [DAILY, RESPONSE, WEEKLY]) {
      const result = parseQuestions(seed);
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.questions).toEqual(seed);
    }
  });

  it("rejects a non-array", () => {
    const result = parseQuestions({ key: "x" });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["questions：questions 必須是題目陣列"]);
  });

  it("lists every reason in Traditional Chinese with the question position and key", () => {
    const result = parseQuestions([
      { key: "r1-status", label: "", type: "select", required: "yes", order: 1.5, disabled: false },
      { key: "ok", label: "OK", type: "short_text", required: false, order: 2, disabled: false, slot: "plan.item4.text" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "第 1 題（r1-status） key：key 只能使用英文、數字與底線",
        "第 1 題（r1-status） label：label 不得為空",
        "第 1 題（r1-status） type：type 必須是 single_select、short_text、long_text、date、number、user_select 其中之一",
        "第 1 題（r1-status） required：required 必須是布林值",
        "第 1 題（r1-status） order：order 必須是整數",
        "第 2 題（ok） slot：slot 不是 §6 定義的語意槽",
      ]),
    );
    for (const message of result.errors) expect(message).toMatch(/^第 \d+ 題/);
  });

  it("show_if shape follows op: eq/neq string, in array, not_empty no value", () => {
    const base = { label: "L", type: "short_text", required: false, order: 2, disabled: false };
    const target = { key: "a", label: "A", type: "short_text", required: false, order: 1, disabled: false };
    const cases: Array<[unknown, RegExp]> = [
      [{ question_key: "a", op: "in", value: "持續中" }, /in 時 value 必須是字串陣列/],
      [{ question_key: "a", op: "eq", value: ["x"] }, /eq 時 value 必須是字串/],
      [{ question_key: "a", op: "neq" }, /neq 時 value 必須是字串/],
      [{ question_key: "a", op: "not_empty", value: "x" }, /not_empty 時不得有 value/],
      [{ question_key: "a", op: "gt", value: "1" }, /show_if\.op 必須是 eq、neq、in、not_empty 其中之一/],
      [{ op: "eq", value: "x" }, /show_if\.question_key/],
    ];
    for (const [show_if, pattern] of cases) {
      const result = parseQuestions([target, { ...base, key: "b", show_if }]);
      expect(result.ok, JSON.stringify(show_if)).toBe(false);
      expect(result.errors.join("\n"), JSON.stringify(show_if)).toMatch(pattern);
      expect(result.errors.join("\n")).toMatch(/^第 2 題（b）/m);
    }
    const ok = parseQuestions([
      target,
      { ...base, key: "b", show_if: { question_key: "a", op: "not_empty" } },
      { ...base, key: "c", order: 3, show_if: { question_key: "a", op: "in", value: ["x", "y"] } },
    ]);
    expect(ok.ok).toBe(true);
  });

  it("slot may be null or omitted; options / help / placeholder are optional", () => {
    const result = parseQuestions([
      { key: "a", label: "A", type: "short_text", required: false, order: 1, disabled: false, slot: null },
      { key: "b", label: "B", type: "long_text", required: true, order: 2, disabled: false, help: "h", placeholder: "p" },
    ]);
    expect(result.ok).toBe(true);
  });
});

describe("validatePublish — the three v1 seeds pass", () => {
  it("newcomer_daily v1 with the seed rules", () => {
    expect(publishDaily(DAILY)).toEqual({ ok: true, errors: [] });
  });

  it("manager_response v1", () => {
    expect(validatePublish(RESPONSE, rules(), { templateKey: "manager_response" })).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("weekly_feedback v1", () => {
    expect(validatePublish(WEEKLY, rules(), { templateKey: "weekly_feedback" })).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("re-publishing an identical version with itself as previousPublished passes", () => {
    expect(
      validatePublish(DAILY, rules(), { templateKey: "newcomer_daily", previousPublished: DAILY }).ok,
    ).toBe(true);
  });
});

describe("validatePublish — rejections (§6, A06 / A07 / A12)", () => {
  it("「已讀，無需處理」 renamed to 「已讀」 is rejected, naming the missing value", () => {
    const edited = RESPONSE.map((q) =>
      q.key === "status"
        ? { ...q, options: (q.options ?? []).map((o) => (o === "已讀，無需處理" ? "已讀" : o)) }
        : q,
    );
    const result = validatePublish(edited, rules(), { templateKey: "manager_response" });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("response.status");
    expect(result.errors[0]).toContain("「已讀，無需處理」");
    expect(result.errors[0]).not.toContain("「需 HR 協助」");
  });

  it("two questions bound to the same slot are rejected", () => {
    const result = publishDaily(
      daily((q) => (q.key === "learned" ? { ...q, slot: "result.extra_work" } : q)),
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      expect.stringContaining("語意槽 result.extra_work 被 2 題綁定（extra_work、learned）"),
    ]);
  });

  it("show_if pointing at a disabled question is rejected", () => {
    const result = publishDaily(
      daily((q) => (q.key === "support" ? { ...q, disabled: true } : q)),
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("（support_detail） 的顯示條件指向已停用的題目「support」"),
    );
    // the disabled question also stops binding its required slot? plan.support.need is at_most_one → no extra error
    expect(result.errors).toHaveLength(1);
  });

  it("show_if pointing at a missing question, or at a later question, is rejected", () => {
    const missing = publishDaily(
      daily((q) =>
        q.key === "r1_reason" ? { ...q, show_if: { question_key: "nope", op: "not_empty" } } : q,
      ),
    );
    expect(missing.errors).toEqual([expect.stringContaining("指向不存在的題目「nope」")]);

    const later = publishDaily(
      daily((q) =>
        q.key === "r1_reason" ? { ...q, show_if: { question_key: "blocker", op: "neq", value: "沒有" } } : q,
      ),
    );
    expect(later.errors).toEqual([expect.stringContaining("只能指向排在前面的題目，「blocker」不在其前")]);
  });

  it("duplicate keys are rejected (disabled questions included)", () => {
    const result = publishDaily([
      ...DAILY,
      { ...DAILY[9], disabled: true, slot: null, order: 99 }, // second "learned"
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([expect.stringContaining("key「learned」重複出現 2 次")]);
  });

  it("single_select with fewer than 2 options is rejected", () => {
    const result = publishDaily(daily((q) => (q.key === "top" ? { ...q, options: ["項目一"] } : q)));
    expect(result.errors).toEqual([expect.stringContaining("「明日最重要的一件事」（top） 為單選題，至少需要 2 個選項")]);
  });

  it("a system slot without a question is rejected regardless of rules", () => {
    const r = rules();
    r.R1.enabled = false;
    r.R2.enabled = false;
    const result = validatePublish(
      DAILY.filter((q) => q.key !== "p1_text"),
      r,
      { templateKey: "newcomer_daily" },
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["語意槽 plan.item1.text 必須恰有一題綁定，目前沒有題目綁定"]);
  });

  it("an enabled rule's slot without a question is rejected; disabling the rule makes it optional", () => {
    const without = DAILY.filter((q) => q.key !== "r2_status" && q.key !== "r2_reason");
    const enabled = publishDaily(without);
    expect(enabled.ok).toBe(false);
    expect(enabled.errors).toEqual(["語意槽 result.item2.status 必須恰有一題綁定，目前沒有題目綁定"]);

    const r = rules();
    r.R1.enabled = false;
    expect(publishDaily(without, r)).toEqual({ ok: true, errors: [] });

    const noBlocker = DAILY.filter((q) => q.key !== "blocker" && q.key !== "blocker_detail");
    expect(publishDaily(noBlocker).errors).toEqual([
      "語意槽 result.blocker.status 必須恰有一題綁定，目前沒有題目綁定",
    ]);
    const r2off = rules();
    r2off.R2.enabled = false;
    expect(publishDaily(noBlocker, r2off).ok).toBe(true);
  });

  it("rule parameter values must exist in the bound question's options", () => {
    const r = rules();
    r.R1.params.expect_done = "完工";
    const expectDone = publishDaily(DAILY, r);
    expect(expectDone.ok).toBe(false);
    expect(expectDone.errors).toHaveLength(3); // plan.item1/2/3.expect
    expect(expectDone.errors[0]).toContain("規則 R1 的參數 expect_done「完工」不在");

    const r2 = rules();
    r2.R2.params.unreported = "有，還沒回報";
    expect(publishDaily(DAILY, r2).errors).toEqual([
      expect.stringContaining("規則 R2 的參數 unreported「有，還沒回報」不在 題目「今日卡點」（blocker）"),
    ]);

    const r3 = rules();
    r3.R1.params.status_done = ["完成", "已完成"];
    expect(publishDaily(DAILY, r3).errors).toHaveLength(3); // result.item1/2/3.status

    // options edited on the form side: dropping 「昨日無此項」 from r3_status
    const edited = daily((q) =>
      q.key === "r3_status" ? { ...q, options: ["完成", "持續中", "取消"] } : q,
    );
    expect(publishDaily(edited).errors).toEqual([
      expect.stringContaining("status_done「昨日無此項」不在 題目「昨日項目三狀態」（r3_status）"),
    ]);
    // disabled rules are not checked
    const off = rules();
    off.R1.enabled = false;
    expect(publishDaily(edited, off).ok).toBe(true);
  });

  it("user_select.options must be exactly ['newcomer'] or ['manager'] (A12)", () => {
    const make = (options: string[] | undefined): Question[] => [
      ...DAILY,
      { key: "buddy", label: "帶你的前輩", type: "user_select", options, required: false, order: 20, disabled: false },
    ];
    for (const options of [undefined, [], ["hr"], ["newcomer", "manager"], ["Manager"]]) {
      const result = publishDaily(make(options));
      expect(result.ok, JSON.stringify(options)).toBe(false);
      expect(result.errors).toEqual([expect.stringContaining("（buddy） 為人員選擇題，options 必須恰為 ['newcomer'] 或 ['manager']")]);
    }
    expect(publishDaily(make(["newcomer"])).ok).toBe(true);
    expect(publishDaily(make(["manager"])).ok).toBe(true);
  });

  it("a key that was published before may not change type (previousPublished)", () => {
    const changed = daily((q) => (q.key === "learned" ? { ...q, type: "long_text" } : q));
    const result = validatePublish(changed, rules(), {
      templateKey: "newcomer_daily",
      previousPublished: DAILY,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      "題目「今日學到一件事」（learned） 已發布過，型別不得由 short_text 改為 long_text",
    ]);
    // even when the question is disabled in the new draft (A07)
    const disabledChanged = changed.map((q) => (q.key === "learned" ? { ...q, disabled: true } : q));
    expect(
      validatePublish(disabledChanged, rules(), { templateKey: "newcomer_daily", previousPublished: DAILY }).ok,
    ).toBe(false);
    // no previous version → nothing to compare
    expect(publishDaily(changed).ok).toBe(true);
  });

  it("a slot of another template is rejected", () => {
    const result = publishDaily(daily((q) => (q.key === "learned" ? { ...q, slot: "weekly.good" } : q)));
    expect(result.errors).toEqual([expect.stringContaining("語意槽 weekly.good 不屬於範本 newcomer_daily")]);
  });

  it("an empty draft is rejected", () => {
    const result = publishDaily([]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toBe("表單至少要有一題");
  });

  it("collects every reason instead of stopping at the first", () => {
    const broken = daily((q) => {
      if (q.key === "top") return { ...q, options: ["項目一"] };
      if (q.key === "learned") return { ...q, slot: "result.extra_work" };
      return q;
    });
    const result = publishDaily(broken);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it("cross-version v2 (p1_text disabled + slot cleared, tomorrow_1 bound, blocks swapped) publishes", () => {
    const v2: Question[] = DAILY.map((q) => {
      if (q.key === "p1_text") return { ...q, disabled: true, slot: null, order: 100 };
      return { ...q, order: q.order >= 11 ? q.order - 10 : q.order + 10 };
    });
    v2.push({
      key: "tomorrow_1", label: "明天要做的第一件事", type: "short_text", required: true,
      slot: "plan.item1.text", order: 1, disabled: false,
    });
    expect(validatePublish(v2, rules(), { templateKey: "newcomer_daily", previousPublished: DAILY })).toEqual({
      ok: true,
      errors: [],
    });
    // leaving the slot on the disabled p1_text is still fine (disabled questions do not count, A07)
    const keptSlot = v2.map((q) => (q.key === "p1_text" ? { ...q, slot: "plan.item1.text" as const } : q));
    expect(publishDaily(keptSlot).ok).toBe(true);
    // but re-enabling p1_text while tomorrow_1 keeps the slot → two questions on one slot
    const both = v2.map((q) => (q.key === "p1_text" ? { ...q, disabled: false, slot: "plan.item1.text" as const } : q));
    expect(publishDaily(both).errors).toEqual([expect.stringContaining("語意槽 plan.item1.text 被 2 題綁定")]);
  });
});
