import { describe, expect, it } from "vitest";

import type { Question } from "@/lib/forms/schema";
import { validateAnswers } from "@/lib/forms/validate";
import {
  FIXTURE_DAILY_LOGS,
  FIXTURE_RESPONSES,
  FIXTURE_WEEKLY_FEEDBACK,
  MANAGER_RESPONSE_QUESTIONS,
  NEWCOMER_DAILY_QUESTIONS,
  WEEKLY_FEEDBACK_QUESTIONS,
} from "@seed/fixtures";

/**
 * T10 `validateAnswers` tests (CLAUDE.md §6, PLAN A07 / A11). Fixture =
 * the three v1 versions and the §11 submissions.
 */

const V1: readonly Question[] = NEWCOMER_DAILY_QUESTIONS;

function log(seq: number) {
  const found = FIXTURE_DAILY_LOGS.find((l) => l.seq === seq);
  if (!found) throw new Error(`no fixture log seq ${seq}`);
  return found;
}

/** Answers as a browser would post them: every key present, `null` → ''. */
function asForm(answers: Readonly<Record<string, string | null>>): Record<string, string> {
  return Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v ?? ""]));
}

describe("validateAnswers — §11 fixture round-trips", () => {
  it.each(FIXTURE_DAILY_LOGS.map((l) => [l.seq, l.username, l] as const))(
    "daily log seq %i (%s) is valid against v1 and normalizes to the stored answers",
    (_seq, _username, l) => {
      const result = validateAnswers(V1, asForm(l.answers));
      expect(result.errors).toEqual({});
      expect(result.ok).toBe(true);
      expect(result.normalized).toEqual(l.answers);
    },
  );

  it.each(FIXTURE_RESPONSES.map((r) => [r.seq, r] as const))(
    "manager response seq %i is valid against manager_response v1",
    (_seq, r) => {
      const result = validateAnswers(MANAGER_RESPONSE_QUESTIONS, asForm(r.answers));
      expect(result.ok).toBe(true);
      expect(result.normalized).toEqual(r.answers);
    },
  );

  it("weekly feedback seq 11 is valid against weekly_feedback v1 (date YYYY-MM-DD)", () => {
    const w = FIXTURE_WEEKLY_FEEDBACK[0];
    const result = validateAnswers(WEEKLY_FEEDBACK_QUESTIONS, asForm(w.answers));
    expect(result.ok).toBe(true);
    expect(result.normalized).toEqual(w.answers);
  });
});

describe("validateAnswers — visibility (A11)", () => {
  const base = asForm(log(6).answers); // 嚴雅齡 9/3: r1_status=持續中 with a reason

  it("r1_status='持續中' → r1_reason visible and kept", () => {
    const result = validateAnswers(V1, base);
    expect(result.ok).toBe(true);
    expect(result.normalized.r1_reason).toBe("案件利潤表工項明細不確定，已問 Patty");
  });

  it("r1_status back to '完成' → r1_reason hidden, not validated, stored as null", () => {
    const result = validateAnswers(V1, { ...base, r1_status: "完成" });
    expect(result.ok).toBe(true);
    expect(result.errors.r1_reason).toBeUndefined();
    expect(result.normalized.r1_status).toBe("完成");
    expect(result.normalized.r1_reason).toBeNull();
  });

  it("p2_text empty → p2_expect hidden, not required, forced to null even if posted", () => {
    const result = validateAnswers(V1, { ...base, p2_text: "   ", p2_expect: "完成" });
    expect(result.ok).toBe(true);
    expect(result.errors.p2_expect).toBeUndefined();
    expect(result.normalized.p2_text).toBeNull();
    expect(result.normalized.p2_expect).toBeNull();
  });

  it("p2_text filled but p2_expect missing → no error (§11: p2_expect is not required)", () => {
    const result = validateAnswers(V1, { ...base, p2_text: "了解各報價單", p2_expect: "" });
    expect(result.ok).toBe(true);
    expect(result.normalized.p2_expect).toBeNull();
  });

  it("support='需要' with empty detail → error once the detail question is required", () => {
    const requiredDetail = V1.map((q) =>
      q.key === "support_detail" ? { ...q, required: true } : q,
    );
    const result = validateAnswers(requiredDetail, { ...base, support: "需要", support_detail: "" });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual({ support_detail: "此題必填" });
    // §11 v1 as seeded: support_detail is optional, so the same input passes
    expect(validateAnswers(V1, { ...base, support: "需要", support_detail: "" }).ok).toBe(true);
    // and with detail filled the required variant passes too
    const filled = validateAnswers(requiredDetail, {
      ...base,
      support: "需要",
      support_detail: " 請 Patty 給對照表 ",
    });
    expect(filled.ok).toBe(true);
    expect(filled.normalized.support_detail).toBe("請 Patty 給對照表");
  });

  it("support='不需要' → support_detail hidden and null even if posted", () => {
    const result = validateAnswers(V1, { ...base, support: "不需要", support_detail: "x" });
    expect(result.ok).toBe(true);
    expect(result.normalized.support_detail).toBeNull();
  });

  it("disabled question → forced to null, never validated, key kept (A07)", () => {
    const withDisabled = V1.map((q) =>
      q.key === "p1_text" ? { ...q, disabled: true } : q,
    );
    const result = validateAnswers(withDisabled, { ...base, p1_text: "" });
    expect(result.ok).toBe(true);
    expect(result.errors.p1_text).toBeUndefined();
    expect(result.normalized).toHaveProperty("p1_text", null);
    const posted = validateAnswers(withDisabled, { ...base, p1_text: "posted anyway" });
    expect(posted.normalized.p1_text).toBeNull();
  });
});

describe("validateAnswers — normalization and per-type rules", () => {
  const base = asForm(log(5).answers); // Darren 9/3

  it("trims strings; whitespace-only → null; unknown keys are dropped; missing keys are null", () => {
    const result = validateAnswers(V1, {
      ...base,
      learned: "  知道哪裡看施工進度  ",
      extra_work: "   ",
      not_a_question: "x",
    });
    expect(result.ok).toBe(true);
    expect(result.normalized.learned).toBe("知道哪裡看施工進度");
    expect(result.normalized.extra_work).toBeNull();
    expect(result.normalized).not.toHaveProperty("not_a_question");
    expect(Object.keys(result.normalized).sort()).toEqual(V1.map((q) => q.key).sort());

    const sparse = validateAnswers(V1, { r1_status: "完成" });
    expect(sparse.normalized.learned).toBeNull();
    expect(Object.keys(sparse.normalized)).toHaveLength(V1.length);
    expect(validateAnswers(V1, null).normalized.r1_status).toBeNull();
  });

  it("required visible question left empty → 此題必填", () => {
    const result = validateAnswers(V1, { ...base, r1_status: "", p1_text: " " });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual({ r1_status: "此題必填", p1_text: "此題必填" });
  });

  it("single_select value must be one of the options (trim-then-exact, A06)", () => {
    const bad = validateAnswers(V1, { ...base, blocker: "有,尚未回報" });
    expect(bad.ok).toBe(false);
    expect(bad.errors.blocker).toBe("請從選項中選擇");
    const padded = validateAnswers(V1, { ...base, blocker: " 有，尚未回報 " });
    expect(padded.ok).toBe(true);
    expect(padded.normalized.blocker).toBe("有，尚未回報");
  });

  it("date must be a real YYYY-MM-DD", () => {
    const w = asForm(FIXTURE_WEEKLY_FEEDBACK[0].answers);
    for (const value of ["2026/08/31", "31-08-2026", "2026-13-01", "2026-02-30", "today"]) {
      const result = validateAnswers(WEEKLY_FEEDBACK_QUESTIONS, { ...w, week_start: value });
      expect(result.ok, value).toBe(false);
      expect(result.errors.week_start).toBe("日期格式須為 YYYY-MM-DD");
    }
    expect(validateAnswers(WEEKLY_FEEDBACK_QUESTIONS, { ...w, week_start: "2026-08-31" }).ok).toBe(true);
  });

  it("number must be a numeric string", () => {
    const questions: Question[] = [
      { key: "n", label: "數量", type: "number", required: true, order: 1, disabled: false },
    ];
    for (const value of ["abc", "1,000", "12a", ""]) {
      expect(validateAnswers(questions, { n: value }).ok, value).toBe(false);
    }
    expect(validateAnswers(questions, { n: "" }).errors.n).toBe("此題必填");
    expect(validateAnswers(questions, { n: "abc" }).errors.n).toBe("請輸入數字");
    for (const value of ["0", "12", "-3", "3.5", " 7 "]) {
      const result = validateAnswers(questions, { n: value });
      expect(result.ok, value).toBe(true);
      expect(result.normalized.n).toBe(value.trim());
    }
    expect(validateAnswers(questions, { n: 42 }).normalized.n).toBe("42");
  });

  it("free text and user_select accept any non-empty string", () => {
    const questions: Question[] = [
      { key: "t", label: "說明", type: "long_text", required: true, order: 1, disabled: false },
      { key: "u", label: "人員", type: "user_select", options: ["manager"], required: true, order: 2, disabled: false },
    ];
    const result = validateAnswers(questions, { t: "多行\n文字", u: "00000002-0000-4000-8000-000000000004" });
    expect(result.ok).toBe(true);
    expect(result.normalized).toEqual({ t: "多行\n文字", u: "00000002-0000-4000-8000-000000000004" });
  });
});
