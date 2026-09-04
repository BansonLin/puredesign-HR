import { describe, expect, it } from "vitest";

import { milestonesFor } from "@/lib/time/milestones";
import { weekStartMonday } from "@/lib/time";
import {
  BASE_PROFILES,
  CLOCK_0903_1800,
  CLOCK_0904_1200,
  CLOCK_0904_1800,
  CLOCK_0904_1830,
  DEPARTMENTS,
  E2E_FRESH_PROFILE,
  EXPECTED_ALERTS,
  EXPECTED_MILESTONE_DUE_DATES,
  EXPECTED_ROW_COUNTS,
  FIXTURE_DAILY_LOGS,
  FIXTURE_MANAGERS,
  FIXTURE_NEWCOMERS,
  FIXTURE_PROFILES,
  FIXTURE_RESPONSES,
  FIXTURE_START_DATE,
  FIXTURE_WEEKLY_FEEDBACK,
  FORM_TEMPLATES,
  MANAGER_RESPONSE_QUESTIONS,
  NEWCOMER_DAILY_QUESTIONS,
  RULES_SETTINGS,
  SETTINGS,
  WEEKLY_FEEDBACK_QUESTIONS,
  YEN_R1_RESPONSE_LAG_MS,
  type FixtureDailyLog,
  type SeedQuestion,
} from "@seed/fixtures";

/**
 * T04 fixture sanity (PLAN 4.9.4 / 4.9.5, CLAUDE.md §6 / §11). These checks
 * pin the seed data itself; the form engine (T10) and rules (T11) tests
 * consume the same fixture afterwards.
 */

/** CLAUDE.md §6 slot list (25). lib/forms/slots.ts (T10) is the runtime source; this copy pins the seed. */
const SLOTS = [
  "plan.item1.text",
  "plan.item1.expect",
  "plan.item2.text",
  "plan.item2.expect",
  "plan.item3.text",
  "plan.item3.expect",
  "plan.top_priority",
  "plan.support.need",
  "plan.support.detail",
  "result.item1.status",
  "result.item1.reason",
  "result.item2.status",
  "result.item2.reason",
  "result.item3.status",
  "result.item3.reason",
  "result.extra_work",
  "result.blocker.status",
  "result.blocker.detail",
  "result.learned",
  "response.status",
  "response.comment",
  "weekly.start_date",
  "weekly.good",
  "weekly.improve",
  "weekly.next_focus",
] as const;

const FIXED_UUID = /^0000000[1-9]-0000-4000-8000-0000000000\d{2}$/;
/** profiles_username_chk in 20260904020004_profiles.sql. */
const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{1,31}$/;

const VERSIONS: Array<{ key: string; questions: readonly SeedQuestion[]; count: number }> = [
  { key: "newcomer_daily", questions: NEWCOMER_DAILY_QUESTIONS, count: 19 },
  { key: "manager_response", questions: MANAGER_RESPONSE_QUESTIONS, count: 2 },
  { key: "weekly_feedback", questions: WEEKLY_FEEDBACK_QUESTIONS, count: 4 },
];

function bySlot(questions: readonly SeedQuestion[], slot: string): SeedQuestion {
  const found = questions.filter((q) => q.slot === slot);
  expect(found, `slot ${slot} must bind exactly one question`).toHaveLength(1);
  return found[0];
}

describe("base.ts — form templates v1 (§11)", () => {
  it("has the three fixed template keys, each with v1", () => {
    expect(FORM_TEMPLATES.map((t) => t.key)).toEqual([
      "newcomer_daily",
      "manager_response",
      "weekly_feedback",
    ]);
    for (const t of FORM_TEMPLATES) {
      expect(t.v1.version_no).toBe(1);
      expect(t.id).toMatch(FIXED_UUID);
      expect(t.v1.id).toMatch(FIXED_UUID);
    }
    expect(FORM_TEMPLATES.map((t) => t.v1.questions.length)).toEqual([19, 2, 4]);
  });

  it.each(VERSIONS)("$key: $count questions, unique keys, order 1..n, no disabled", (v) => {
    expect(v.questions).toHaveLength(v.count);
    const keys = v.questions.map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const q of v.questions) expect(q.key).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(v.questions.map((q) => q.order)).toEqual(
      Array.from({ length: v.count }, (_, i) => i + 1),
    );
    expect(v.questions.every((q) => q.disabled === false)).toBe(true);
  });

  it.each(VERSIONS)("$key: every slot is a §6 slot and bound at most once", (v) => {
    const slots = v.questions.map((q) => q.slot).filter((s): s is string => s !== null);
    for (const slot of slots) expect(SLOTS).toContain(slot);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it.each(VERSIONS)("$key: show_if only points at an existing question with a smaller order", (v) => {
    for (const q of v.questions) {
      if (!q.show_if) continue;
      const target = v.questions.find((t) => t.key === q.show_if?.question_key);
      expect(target, `${q.key}.show_if → ${q.show_if.question_key}`).toBeDefined();
      expect(target!.order).toBeLessThan(q.order);
      if (q.show_if.op === "in") expect(Array.isArray(q.show_if.value)).toBe(true);
      if (q.show_if.op === "eq" || q.show_if.op === "neq") expect(typeof q.show_if.value).toBe("string");
      if (q.show_if.op === "not_empty") expect(q.show_if.value).toBeUndefined();
    }
  });

  it.each(VERSIONS)("$key: single_select has ≥ 2 options; other types have none", (v) => {
    for (const q of v.questions) {
      if (q.type === "single_select") {
        expect(q.options, q.key).toBeDefined();
        expect(q.options!.length, q.key).toBeGreaterThanOrEqual(2);
        expect(new Set(q.options).size).toBe(q.options!.length);
      } else {
        expect(q.options, q.key).toBeUndefined();
      }
    }
  });

  it("newcomer_daily matches §11 question by question", () => {
    const q = NEWCOMER_DAILY_QUESTIONS;
    expect(q.map((x) => x.key)).toEqual([
      "r1_status", "r1_reason", "r2_status", "r2_reason", "r3_status", "r3_reason",
      "extra_work", "blocker", "blocker_detail", "learned",
      "p1_text", "p1_expect", "p2_text", "p2_expect", "p3_text", "p3_expect",
      "top", "support", "support_detail",
    ]);
    expect(q.filter((x) => x.required).map((x) => x.key)).toEqual([
      "r1_status", "r2_status", "r3_status", "blocker", "p1_text", "p1_expect", "top", "support",
    ]);
    expect(bySlot(q, "result.item1.status").options).toEqual(["完成", "持續中", "取消", "昨日無此項"]);
    expect(bySlot(q, "result.item1.reason").show_if).toEqual({
      question_key: "r1_status", op: "in", value: ["持續中", "取消"],
    });
    expect(bySlot(q, "result.blocker.status").options).toEqual([
      "沒有", "有，已找人處理中", "有，已解決", "有，尚未回報",
    ]);
    expect(bySlot(q, "result.blocker.detail").show_if).toEqual({
      question_key: "blocker", op: "neq", value: "沒有",
    });
    expect(bySlot(q, "plan.item2.expect").show_if).toEqual({ question_key: "p2_text", op: "not_empty" });
    expect(bySlot(q, "plan.item3.expect").show_if).toEqual({ question_key: "p3_text", op: "not_empty" });
    expect(bySlot(q, "plan.top_priority").options).toEqual(["項目一", "項目二", "項目三"]);
    expect(bySlot(q, "plan.support.detail").show_if).toEqual({ question_key: "support", op: "eq", value: "需要" });
    expect(q.find((x) => x.key === "blocker")?.label).toBe("今日卡點");
    expect(q.find((x) => x.key === "top")?.label).toBe("明日最重要的一件事");
  });

  it("manager_response and weekly_feedback match §11", () => {
    expect(MANAGER_RESPONSE_QUESTIONS.map((x) => [x.key, x.type, x.required, x.slot])).toEqual([
      ["status", "single_select", true, "response.status"],
      ["comment", "short_text", false, "response.comment"],
    ]);
    expect(MANAGER_RESPONSE_QUESTIONS[0].options).toEqual(["已讀，無需處理", "已處理", "需 HR 協助"]);
    expect(WEEKLY_FEEDBACK_QUESTIONS.map((x) => [x.key, x.type, x.required, x.slot])).toEqual([
      ["week_start", "date", true, "weekly.start_date"],
      ["good", "short_text", true, "weekly.good"],
      ["improve", "short_text", true, "weekly.improve"],
      ["next_focus", "short_text", true, "weekly.next_focus"],
    ]);
  });
});

describe("base.ts — settings (PLAN 4.8) and rule parameters vs bound options", () => {
  it("has the four keys with the documented values", () => {
    expect(Object.keys(SETTINGS)).toEqual([
      "daily_cutoff_time", "response_threshold_hours", "rules", "workweek",
    ]);
    expect(SETTINGS.daily_cutoff_time).toBe("18:00");
    expect(SETTINGS.response_threshold_hours).toBe(24);
    expect(SETTINGS.workweek).toBe("mon_fri");
    expect(SETTINGS.rules).toEqual({
      R1: { enabled: true, params: { expect_done: "完成", status_done: ["完成", "昨日無此項"] } },
      R2: { enabled: true, params: { unreported: "有，尚未回報" } },
      R3: { enabled: true },
      A1: { enabled: true },
    });
  });

  it("R1 expect_done / status_done exist in the options of the bound questions (§6 publish rule)", () => {
    for (const i of [1, 2, 3]) {
      const expect_q = bySlot(NEWCOMER_DAILY_QUESTIONS, `plan.item${i}.expect`);
      expect(expect_q.options).toContain(RULES_SETTINGS.R1.params.expect_done);
      const status_q = bySlot(NEWCOMER_DAILY_QUESTIONS, `result.item${i}.status`);
      for (const v of RULES_SETTINGS.R1.params.status_done) expect(status_q.options).toContain(v);
      bySlot(NEWCOMER_DAILY_QUESTIONS, `plan.item${i}.text`);
      bySlot(NEWCOMER_DAILY_QUESTIONS, `result.item${i}.reason`);
    }
  });

  it("R2 unreported exists in the blocker options; detail slot is bound", () => {
    expect(bySlot(NEWCOMER_DAILY_QUESTIONS, "result.blocker.status").options).toContain(
      RULES_SETTINGS.R2.params.unreported,
    );
    bySlot(NEWCOMER_DAILY_QUESTIONS, "result.blocker.detail");
  });

  it("response.status carries both metric literals (A06)", () => {
    const status = bySlot(MANAGER_RESPONSE_QUESTIONS, "response.status");
    expect(status.options).toContain("已讀，無需處理");
    expect(status.options).toContain("需 HR 協助");
  });
});

describe("base.ts / fixture.ts — accounts (PLAN 4.9.4, A01/A02/A03)", () => {
  const all = [...BASE_PROFILES, ...FIXTURE_PROFILES];

  it("departments are the §11 four with sort_order 1..4 and fixed ids", () => {
    expect(DEPARTMENTS.map((d) => d.name)).toEqual(["工務", "採購", "設計", "信義設計"]);
    expect(DEPARTMENTS.map((d) => d.sort_order)).toEqual([1, 2, 3, 4]);
    for (const d of DEPARTMENTS) expect(d.id).toMatch(FIXED_UUID);
  });

  it("12 accounts with unique fixed ids and DB-valid usernames", () => {
    expect(all).toHaveLength(12);
    expect(new Set(all.map((p) => p.id)).size).toBe(12);
    expect(new Set(all.map((p) => p.username)).size).toBe(12);
    for (const p of all) {
      expect(p.id).toMatch(FIXED_UUID);
      expect(p.username).toMatch(USERNAME_RE);
      expect(p.display_name.trim().length).toBeGreaterThan(0);
    }
    expect(BASE_PROFILES.map((p) => [p.username, p.role])).toEqual([
      ["banson", "admin"], ["hr", "hr"], ["ceo", "ceo"],
    ]);
  });

  it("department and manager references resolve to seeded rows", () => {
    const deptNames = new Set<string>(DEPARTMENTS.map((d) => d.name));
    const usernames = new Set<string>(all.map((p) => p.username));
    for (const p of all) {
      if (p.department !== null) expect(deptNames.has(p.department), p.username).toBe(true);
      if (p.manager_username !== null) {
        expect(usernames.has(p.manager_username), p.username).toBe(true);
        expect(p.manager_username).not.toBe(p.username);
      }
    }
  });

  it("four managers, four active newcomers on 2026-09-01, correct department/manager", () => {
    expect(FIXTURE_MANAGERS.map((m) => [m.username, m.display_name, m.department])).toEqual([
      ["mgr_construction", "工務主任", "工務"],
      ["mgr_procurement", "採購主管", "採購"],
      ["mgr_design", "設計副主任", "設計"],
      ["mgr_xinyi", "信義總監", "信義設計"],
    ]);
    expect(
      FIXTURE_NEWCOMERS.map((n) => [n.username, n.display_name, n.department, n.manager_username]),
    ).toEqual([
      ["darren", "Darren", "工務", "mgr_construction"],
      ["yen_yaling", "嚴雅齡", "採購", "mgr_procurement"],
      ["hsieh_wenhsin", "謝文心", "設計", "mgr_design"],
      ["hung_hsiangting", "洪湘庭", "信義設計", "mgr_xinyi"],
    ]);
    for (const n of FIXTURE_NEWCOMERS) {
      expect(n.role).toBe("newcomer");
      expect(n.status).toBe("active");
      expect(n.start_date).toBe(FIXTURE_START_DATE);
      expect(n.must_change_password).toBe(false);
    }
    for (const p of [...BASE_PROFILES, ...FIXTURE_MANAGERS]) {
      expect(p.must_change_password).toBe(false);
      expect(p.status).toBe("active");
    }
  });

  it("e2e_fresh is a sample newcomer that must change its password", () => {
    expect(E2E_FRESH_PROFILE).toMatchObject({
      username: "e2e_fresh",
      role: "newcomer",
      status: "sample",
      must_change_password: true,
      department: "工務",
      manager_username: "mgr_construction",
      start_date: FIXTURE_START_DATE,
    });
    expect(FIXTURE_PROFILES.at(-1)).toBe(E2E_FRESH_PROFILE);
  });
});

describe("fixture.ts — §11 submissions", () => {
  const v1Keys = NEWCOMER_DAILY_QUESTIONS.map((q) => q.key);
  const logBySeq = new Map(FIXTURE_DAILY_LOGS.map((l) => [l.seq, l]));
  /** Widened view of the `as const` logs for value comparisons TS would otherwise flag as impossible. */
  const LOGS: readonly FixtureDailyLog[] = FIXTURE_DAILY_LOGS;

  it("8 logs, 2 responses, 1 weekly feedback with seq 1..11", () => {
    expect(FIXTURE_DAILY_LOGS).toHaveLength(8);
    expect(FIXTURE_RESPONSES).toHaveLength(2);
    expect(FIXTURE_WEEKLY_FEEDBACK).toHaveLength(1);
    expect(
      [...FIXTURE_DAILY_LOGS, ...FIXTURE_RESPONSES, ...FIXTURE_WEEKLY_FEEDBACK].map((s) => s.seq),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("every log's answers carry exactly the v1 keys (A11: key kept, null when empty)", () => {
    for (const log of LOGS) {
      expect(Object.keys(log.answers).sort(), `seq ${log.seq}`).toEqual([...v1Keys].sort());
      for (const [k, v] of Object.entries(log.answers)) {
        expect(v === null || (typeof v === "string" && v.trim() === v && v !== ""), `seq ${log.seq}.${k}`).toBe(true);
      }
    }
    for (const r of FIXTURE_RESPONSES) {
      expect(Object.keys(r.answers).sort()).toEqual(MANAGER_RESPONSE_QUESTIONS.map((q) => q.key).sort());
    }
    for (const w of FIXTURE_WEEKLY_FEEDBACK) {
      expect(Object.keys(w.answers).sort()).toEqual(WEEKLY_FEEDBACK_QUESTIONS.map((q) => q.key).sort());
    }
  });

  it("single_select answers are one of the question's options", () => {
    for (const log of FIXTURE_DAILY_LOGS) {
      for (const q of NEWCOMER_DAILY_QUESTIONS) {
        const v = log.answers[q.key];
        if (q.type === "single_select" && v !== null) {
          expect(q.options, `seq ${log.seq}.${q.key}=${v}`).toContain(v);
        }
      }
    }
    for (const r of FIXTURE_RESPONSES) {
      expect(MANAGER_RESPONSE_QUESTIONS[0].options).toContain(r.answers.status);
    }
  });

  it("hidden questions (show_if false) are stored as null", () => {
    for (const log of LOGS) {
      const a = log.answers;
      for (const i of [1, 2, 3] as const) {
        const status = a[`r${i}_status`];
        if (status !== "持續中" && status !== "取消") expect(a[`r${i}_reason`], `seq ${log.seq}`).toBeNull();
      }
      if (a.blocker === "沒有") expect(a.blocker_detail, `seq ${log.seq}`).toBeNull();
      if (a.p2_text === null) expect(a.p2_expect, `seq ${log.seq}`).toBeNull();
      if (a.p3_text === null) expect(a.p3_expect, `seq ${log.seq}`).toBeNull();
      if (a.support !== "需要") expect(a.support_detail, `seq ${log.seq}`).toBeNull();
      // required questions are always answered
      for (const q of NEWCOMER_DAILY_QUESTIONS) {
        if (q.required) expect(a[q.key], `seq ${log.seq}.${q.key}`).not.toBeNull();
      }
    }
  });

  it("submitted_at (+08:00) converts to the UTC instants of PLAN 4.9.4", () => {
    const table: Array<[number, string, string, string]> = [
      [1, "darren", "2026-09-02", "2026-09-02T09:05:00.000Z"],
      [2, "yen_yaling", "2026-09-02", "2026-09-02T09:12:00.000Z"],
      [3, "hsieh_wenhsin", "2026-09-02", "2026-09-02T09:20:00.000Z"],
      [4, "hung_hsiangting", "2026-09-02", "2026-09-02T09:30:00.000Z"],
      [5, "darren", "2026-09-03", "2026-09-03T09:01:00.000Z"],
      [6, "yen_yaling", "2026-09-03", "2026-09-03T09:03:00.000Z"],
      [7, "hung_hsiangting", "2026-09-03", "2026-09-03T09:06:00.000Z"],
      [8, "hsieh_wenhsin", "2026-09-03", "2026-09-03T09:23:00.000Z"],
    ];
    expect(
      FIXTURE_DAILY_LOGS.map((l) => [l.seq, l.username, l.log_date, new Date(l.submitted_at).toISOString()]),
    ).toEqual(table);
    for (const l of FIXTURE_DAILY_LOGS) expect(l.submitted_at).toMatch(/\+08:00$/);
    expect(FIXTURE_RESPONSES.map((r) => new Date(r.submitted_at).toISOString())).toEqual([
      "2026-09-04T01:10:00.000Z",
      "2026-09-04T01:20:00.000Z",
    ]);
    expect(new Date(FIXTURE_WEEKLY_FEEDBACK[0].submitted_at).toISOString()).toBe("2026-09-04T09:00:00.000Z");
  });

  it("嚴雅齡 9/3 (seq 6) matches §11", () => {
    const a = logBySeq.get(6)!.answers;
    expect(a).toMatchObject({
      r1_status: "持續中",
      r1_reason: "案件利潤表工項明細不確定，已問 Patty",
      r2_status: "完成",
      r2_reason: null,
      r3_status: "持續中",
      r3_reason: "宏偉訂金確認中",
      blocker: "有，已找人處理中",
      blocker_detail: null,
      p1_text: "案件利潤表持續更新",
      p1_expect: "跨日",
      p2_text: "了解各報價單",
      p2_expect: "跨日",
      p3_text: "宏偉訂金確認",
      p3_expect: "完成",
      top: "項目三",
    });
    // her 9/2 plan (seq 2) is what R1 compares against: all three expected "完成"
    const prev = logBySeq.get(2)!.answers;
    expect([prev.p1_text, prev.p1_expect]).toEqual(["請款總表移到新表單", "完成"]);
    expect([prev.p2_text, prev.p2_expect]).toEqual(["裕福門窗報價", "完成"]);
    expect([prev.p3_text, prev.p3_expect]).toEqual(["鋁門窗宏偉報價", "完成"]);
    expect(prev.top).toBe("項目二");
  });

  it("洪湘庭 9/3 (seq 7) matches §11", () => {
    const a = logBySeq.get(7)!.answers;
    expect(a).toMatchObject({
      r1_status: "完成",
      r2_status: "持續中",
      r3_status: "昨日無此項",
      blocker: "有，尚未回報",
      blocker_detail: "Luma 免費版有次數限制，只做了 3 張圖",
      learned: "使用 Luma 聊天功能輔助修圖",
      p1_text: "宗硯20期渲染圖 Luma 改圖",
      p1_expect: "跨日",
      p2_text: null,
      p3_text: null,
    });
    const prev = logBySeq.get(4)!.answers;
    expect([prev.p1_expect, prev.p2_expect, prev.p3_expect]).toEqual(["完成", "跨日", null]);
  });

  it("Darren 9/3 and 謝文心 9/3 cannot trigger R1 (跨日 / 昨日無此項 / no previous item)", () => {
    const darren = logBySeq.get(5)!.answers;
    const darrenPrev = logBySeq.get(1)!.answers;
    expect([darren.r1_status, darren.r2_status, darren.r3_status]).toEqual(["完成", "持續中", "完成"]);
    expect(darrenPrev.p2_expect).toBe("跨日");
    expect(darren.extra_work).toBe("文風19 安排木工維修隱藏門");
    expect(darren.learned).toBe("知道哪裡看施工進度");
    const hsieh = logBySeq.get(8)!.answers;
    const hsiehPrev = logBySeq.get(3)!.answers;
    expect([hsieh.r1_status, hsieh.r2_status, hsieh.r3_status]).toEqual(["完成", "昨日無此項", "昨日無此項"]);
    expect([hsiehPrev.p2_text, hsiehPrev.p2_expect, hsiehPrev.p3_text, hsiehPrev.p3_expect]).toEqual([null, null, null, null]);
    expect(hsieh.extra_work).toBe("深周二路農舍立面");
  });

  it("responses target the right logs and carry §11 answers", () => {
    expect(FIXTURE_RESPONSES.map((r) => [r.username, r.target_username, r.target_log_seq])).toEqual([
      ["mgr_procurement", "yen_yaling", 6],
      ["mgr_construction", "darren", 5],
    ]);
    for (const r of FIXTURE_RESPONSES) {
      expect(logBySeq.get(r.target_log_seq)?.username).toBe(r.target_username);
      const manager = FIXTURE_MANAGERS.find((m) => m.username === r.username);
      const newcomer = FIXTURE_NEWCOMERS.find((n) => n.username === r.target_username);
      expect(newcomer?.manager_username).toBe(manager?.username);
    }
    expect(FIXTURE_RESPONSES[0].answers).toEqual({
      status: "已處理",
      comment: "已請 Patty 給工項對照表；宏偉訂金明早追",
    });
    expect(FIXTURE_RESPONSES[1].answers).toEqual({ status: "已讀，無需處理", comment: null });
  });

  it("weekly feedback: Monday week_start in both column and answers, three §11 lines", () => {
    const w = FIXTURE_WEEKLY_FEEDBACK[0];
    expect(w.username).toBe("mgr_construction");
    expect(w.target_username).toBe("darren");
    expect(w.week_start).toBe("2026-08-31");
    expect(weekStartMonday(w.week_start)).toBe(w.week_start);
    expect(w.answers).toEqual({
      week_start: "2026-08-31",
      good: "案場紀律好，拍照上傳準時",
      improve: "木工協調要自己先問工班時間",
      next_focus: "文風19 木工維修獨立收尾",
    });
  });
});

describe("expected.ts — alerts, clocks, milestones, row counts", () => {
  it("two expected alerts hanging on 嚴雅齡 9/3 (R1) and 洪湘庭 9/3 (R2)", () => {
    expect(EXPECTED_ALERTS.map((a) => [a.log_seq, a.username, a.rule_key, a.status])).toEqual([
      [6, "yen_yaling", "R1", "responded"],
      [7, "hung_hsiangting", "R2", "open"],
    ]);
    const logBySeq = new Map(FIXTURE_DAILY_LOGS.map((l) => [l.seq, l]));
    for (const a of EXPECTED_ALERTS) {
      const log = logBySeq.get(a.log_seq)!;
      expect(log.username).toBe(a.username);
      expect(new Date(a.created_at).getTime()).toBe(new Date(log.submitted_at).getTime());
    }
    expect(EXPECTED_ALERTS[0].detail.items.map((i) => i.i)).toEqual([1, 3]);
    expect(EXPECTED_ALERTS[1].detail.text).toBe("Luma 免費版有次數限制，只做了 3 張圖");
  });

  it("嚴雅齡 R1 responded_at − created_at is exactly 16h07m (not late at 24h)", () => {
    const r1 = EXPECTED_ALERTS[0];
    const lag = new Date(r1.responded_at).getTime() - new Date(r1.created_at).getTime();
    expect(lag).toBe(YEN_R1_RESPONSE_LAG_MS);
    expect(lag).toBe((16 * 60 + 7) * 60_000);
    expect(lag).toBeLessThan(SETTINGS.response_threshold_hours * 3_600_000);
    const response = FIXTURE_RESPONSES.find((r) => r.seq === r1.response_seq)!;
    expect(new Date(response.submitted_at).getTime()).toBe(new Date(r1.responded_at).getTime());
  });

  it("clocks are the PLAN 4.9.5 UTC instants", () => {
    expect(CLOCK_0903_1800.toISOString()).toBe("2026-09-03T10:00:00.000Z");
    expect(CLOCK_0904_1200.toISOString()).toBe("2026-09-04T04:00:00.000Z");
    expect(CLOCK_0904_1800.toISOString()).toBe("2026-09-04T10:00:00.000Z");
    expect(CLOCK_0904_1830.toISOString()).toBe("2026-09-04T10:30:00.000Z");
    // 洪湘庭 R2: 18h54m open at 12:00, 24h54m at 18:00
    const created = new Date(EXPECTED_ALERTS[1].created_at).getTime();
    expect((CLOCK_0904_1200.getTime() - created) / 3_600_000).toBeCloseTo(18.9, 1);
    expect((CLOCK_0904_1800.getTime() - created) / 3_600_000).toBeCloseTo(24.9, 1);
  });

  it("milestone due dates equal milestonesFor(2026-09-01) and the §11 row counts add up", () => {
    expect(milestonesFor(EXPECTED_MILESTONE_DUE_DATES.start_date)).toEqual([
      { kind: "D30", due_date: EXPECTED_MILESTONE_DUE_DATES.D30 },
      { kind: "D60", due_date: EXPECTED_MILESTONE_DUE_DATES.D60 },
      { kind: "D90", due_date: EXPECTED_MILESTONE_DUE_DATES.D90 },
    ]);
    expect(EXPECTED_ROW_COUNTS.base.profiles).toBe(BASE_PROFILES.length);
    expect(EXPECTED_ROW_COUNTS.full.profiles).toBe(BASE_PROFILES.length + FIXTURE_PROFILES.length);
    expect(EXPECTED_ROW_COUNTS.full.milestones).toBe(
      FIXTURE_PROFILES.filter((p) => p.start_date !== null).length * 3,
    );
    expect(EXPECTED_ROW_COUNTS.full.submissions).toBe(
      FIXTURE_DAILY_LOGS.length + FIXTURE_RESPONSES.length + FIXTURE_WEEKLY_FEEDBACK.length,
    );
    expect(EXPECTED_ROW_COUNTS.full.alerts).toBe(EXPECTED_ALERTS.length);
    expect(EXPECTED_ROW_COUNTS.full.departments).toBe(DEPARTMENTS.length);
  });
});
