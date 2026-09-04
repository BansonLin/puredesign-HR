import { describe, expect, it } from "vitest";

import { bySlot } from "@/lib/forms/resolve";
import type { Question } from "@/lib/forms/schema";
import { RULES_DEFAULTS, type RulesSettings } from "@/lib/rules/constants";
import { r1 } from "@/lib/rules/r1";
import { r2 } from "@/lib/rules/r2";
import { reconcile, runRules } from "@/lib/rules/run";
import { RulesSettingsError, parseRulesSettings, rulesSettingsErrors } from "@/lib/rules/settings";
import type { AlertDraft } from "@/lib/rules/types";
import {
  EXPECTED_ALERT_FREE_LOG_SEQS,
  EXPECTED_ALERTS,
  FIXTURE_DAILY_LOGS,
  NEWCOMER_DAILY_QUESTIONS,
  RULES_SETTINGS,
} from "@seed/fixtures";

/**
 * T11 rule tests: CLAUDE.md §7 R1 / R2 against the §11 fixture (8 daily
 * logs, newcomer_daily v1), the enabled switches, parameterization and
 * `parseRulesSettings` (PLAN 4.8).
 */

const V1: readonly Question[] = NEWCOMER_DAILY_QUESTIONS;
const SETTINGS: RulesSettings = parseRulesSettings(RULES_SETTINGS);

type FixtureLog = (typeof FIXTURE_DAILY_LOGS)[number];

function log(seq: number): FixtureLog {
  const found = FIXTURE_DAILY_LOGS.find((l) => l.seq === seq);
  if (!found) throw new Error(`no fixture log seq ${seq}`);
  return found;
}

function logOf(username: string, logDate: string): FixtureLog {
  const found = FIXTURE_DAILY_LOGS.find((l) => l.username === username && l.log_date === logDate);
  if (!found) throw new Error(`no fixture log for ${username} ${logDate}`);
  return found;
}

/** §6 / A05 (6): the latest non-deleted log of the same newcomer with a smaller log_date. */
function previousOf(current: FixtureLog): FixtureLog | null {
  const earlier = FIXTURE_DAILY_LOGS.filter(
    (l) => l.username === current.username && l.log_date < current.log_date,
  ).sort((a, b) => (a.log_date < b.log_date ? 1 : -1));
  return earlier[0] ?? null;
}

function slots(entry: FixtureLog | null) {
  return entry ? bySlot(V1, entry.answers) : null;
}

function run(current: FixtureLog, settings: RulesSettings = SETTINGS): AlertDraft[] {
  return runRules({
    current: bySlot(V1, current.answers),
    previous: slots(previousOf(current)),
    settings,
  });
}

const YEN_0903 = logOf("yen_yaling", "2026-09-03");
const HUNG_0903 = logOf("hung_hsiangting", "2026-09-03");
const DARREN_0903 = logOf("darren", "2026-09-03");
const HSIEH_0903 = logOf("hsieh_wenhsin", "2026-09-03");

const YEN_R1_ITEMS = [
  {
    i: 1,
    plan_text: "請款總表移到新表單",
    status: "持續中",
    reason: "案件利潤表工項明細不確定，已問 Patty",
  },
  {
    i: 3,
    plan_text: "鋁門窗宏偉報價",
    status: "持續中",
    reason: "宏偉訂金確認中",
  },
];

// ---------------------------------------------------------------------------
// §11 expected results
// ---------------------------------------------------------------------------

describe("§11 expected alerts (runRules with the seed settings)", () => {
  it("嚴雅齡 9/3 → exactly one R1 with items 1 and 3, no R2", () => {
    const drafts = run(YEN_0903);
    expect(drafts).toEqual([{ rule_key: "R1", detail: { items: YEN_R1_ITEMS } }]);
    expect(drafts.filter((d) => d.rule_key === "R2")).toEqual([]);
  });

  it("洪湘庭 9/3 → exactly one R2 with the blocker text, no R1", () => {
    const drafts = run(HUNG_0903);
    expect(drafts).toEqual([
      { rule_key: "R2", detail: { text: "Luma 免費版有次數限制，只做了 3 張圖" } },
    ]);
    expect(drafts.filter((d) => d.rule_key === "R1")).toEqual([]);
  });

  it("Darren 9/3 → zero (item 2 was planned 跨日, not 完成)", () => {
    const previous = slots(previousOf(DARREN_0903));
    expect(previous?.["plan.item2.expect"]).toBe("跨日");
    expect(bySlot(V1, DARREN_0903.answers)["result.item2.status"]).toBe("持續中");
    expect(run(DARREN_0903)).toEqual([]);
  });

  it("謝文心 9/3 → zero (items 2 and 3 are 昨日無此項, item 1 done)", () => {
    const current = bySlot(V1, HSIEH_0903.answers);
    expect(current["result.item2.status"]).toBe("昨日無此項");
    expect(current["result.item3.status"]).toBe("昨日無此項");
    expect(run(HSIEH_0903)).toEqual([]);
  });

  it("the four 9/2 logs → zero (no previous log)", () => {
    const firstDay = FIXTURE_DAILY_LOGS.filter((l) => l.log_date === "2026-09-02");
    expect(firstDay).toHaveLength(4);
    for (const entry of firstDay) {
      expect(previousOf(entry)).toBeNull();
      expect(run(entry)).toEqual([]);
    }
  });

  it("every seq in EXPECTED_ALERT_FREE_LOG_SEQS produces nothing", () => {
    for (const seq of EXPECTED_ALERT_FREE_LOG_SEQS) expect(run(log(seq))).toEqual([]);
  });

  it("all fixture logs in submission order deep-equal EXPECTED_ALERTS (rule_key + detail)", () => {
    const ordered = [...FIXTURE_DAILY_LOGS].sort((a, b) =>
      new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime(),
    );
    const produced = ordered.flatMap((entry) =>
      run(entry).map((draft) => ({
        log_seq: entry.seq,
        username: entry.username,
        rule_key: draft.rule_key,
        detail: draft.detail,
      })),
    );
    const expected = EXPECTED_ALERTS.map((a) => ({
      log_seq: a.log_seq,
      username: a.username,
      rule_key: a.rule_key,
      detail: a.detail,
    }));
    expect(produced).toEqual(expected);
    expect(produced).toHaveLength(2);
  });

  it("a fresh reconcile at each log's submitted_at stamps created_at = EXPECTED_ALERTS.created_at", () => {
    // D-23 (2): insert.created_at is the `now` handed to reconcile, which the
    // submit pipeline sets to the log's submitted_at (§11 「≈16.1h」 relies on it).
    for (const entry of FIXTURE_DAILY_LOGS) {
      const drafts = run(entry);
      const { insert } = reconcile({ existing: [], drafts, now: entry.submitted_at });
      expect(insert).toHaveLength(drafts.length);
      const expectedRows = EXPECTED_ALERTS.filter((a) => a.log_seq === entry.seq);
      expect(insert).toHaveLength(expectedRows.length);
      if (insert.length === 0) continue;
      const row = insert[0]!;
      const expectedRow = expectedRows.find((a) => a.rule_key === row.rule_key);
      expect(expectedRow).toBeDefined();
      expect(new Date(row.created_at).getTime()).toBe(new Date(expectedRow!.created_at).getTime());
      expect(new Date(row.created_at).getTime()).toBe(new Date(entry.submitted_at).getTime());
    }
  });
});

// ---------------------------------------------------------------------------
// parameterization and switches
// ---------------------------------------------------------------------------

describe("parameters and enabled switches", () => {
  it("expect_done='跨日' → 嚴雅齡 9/3 no longer triggers R1", () => {
    const settings: RulesSettings = {
      ...SETTINGS,
      R1: { enabled: true, params: { expect_done: "跨日", status_done: ["完成", "昨日無此項"] } },
    };
    expect(run(YEN_0903, settings)).toEqual([]);
  });

  it("expect_done='跨日' → Darren 9/3 triggers on item 2 instead", () => {
    const settings: RulesSettings = {
      ...SETTINGS,
      R1: { enabled: true, params: { expect_done: "跨日", status_done: ["完成", "昨日無此項"] } },
    };
    expect(run(DARREN_0903, settings)).toEqual([
      {
        rule_key: "R1",
        detail: {
          items: [{ i: 2, plan_text: "看木作功法百科", status: "持續中", reason: null }],
        },
      },
    ]);
  });

  it("status_done including 持續中 → 嚴雅齡 9/3 no longer triggers R1", () => {
    const settings: RulesSettings = {
      ...SETTINGS,
      R1: {
        enabled: true,
        params: { expect_done: "完成", status_done: ["完成", "昨日無此項", "持續中"] },
      },
    };
    expect(run(YEN_0903, settings)).toEqual([]);
  });

  it("R1.enabled=false → zero alerts for every fixture log except 洪湘庭's R2", () => {
    const settings: RulesSettings = { ...SETTINGS, R1: { ...SETTINGS.R1, enabled: false } };
    for (const entry of FIXTURE_DAILY_LOGS) {
      const drafts = run(entry, settings);
      expect(drafts.filter((d) => d.rule_key === "R1")).toEqual([]);
    }
    expect(run(YEN_0903, settings)).toEqual([]);
  });

  it("R2.enabled=false → 洪湘庭 9/3 zero alerts", () => {
    const settings: RulesSettings = { ...SETTINGS, R2: { ...SETTINGS.R2, enabled: false } };
    expect(run(HUNG_0903, settings)).toEqual([]);
    // R1 still runs
    expect(run(YEN_0903, settings)).toHaveLength(1);
  });

  it("both disabled → nothing at all", () => {
    const settings: RulesSettings = {
      R1: { ...SETTINGS.R1, enabled: false },
      R2: { ...SETTINGS.R2, enabled: false },
      R3: { enabled: true },
      A1: { enabled: true },
    };
    for (const entry of FIXTURE_DAILY_LOGS) expect(run(entry, settings)).toEqual([]);
  });

  it("unreported param changed → R2 follows the new literal", () => {
    const settings: RulesSettings = {
      ...SETTINGS,
      R2: { enabled: true, params: { unreported: "有，已找人處理中" } },
    };
    expect(run(HUNG_0903, settings)).toEqual([]);
    // 嚴雅齡 9/3: blocker 有，已找人處理中 with no detail text in the fixture
    expect(run(YEN_0903, settings).filter((d) => d.rule_key === "R2")).toEqual([
      { rule_key: "R2", detail: { text: null } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// r1 / r2 pure-function edges (A06 trim, A11 null)
// ---------------------------------------------------------------------------

describe("r1 / r2 edges", () => {
  const params = RULES_DEFAULTS.R1.params;

  it("r1: previous null → []", () => {
    expect(r1({ current: { "result.item1.status": "持續中" }, previous: null, params })).toEqual([]);
  });

  it("r1: null status never triggers, even when planned 完成 (A11)", () => {
    expect(
      r1({
        current: { "result.item1.status": null },
        previous: { "plan.item1.expect": "完成", "plan.item1.text": "x" },
        params,
      }),
    ).toEqual([]);
  });

  it("r1: comparisons trim both sides (A06), and plan_text / reason default to null", () => {
    expect(
      r1({
        current: { "result.item2.status": " 取消 " },
        previous: { "plan.item2.expect": "完成 " },
        params,
      }),
    ).toEqual([
      { rule_key: "R1", detail: { items: [{ i: 2, plan_text: null, status: " 取消 ", reason: null }] } },
    ]);
    expect(
      r1({
        current: { "result.item2.status": " 完成 " },
        previous: { "plan.item2.expect": "完成" },
        params,
      }),
    ).toEqual([]);
  });

  it("r2: only the current log matters; detail text null when not given", () => {
    const p = RULES_DEFAULTS.R2.params;
    expect(r2({ current: { "result.blocker.status": "有，尚未回報" }, previous: null, params: p })).toEqual([
      { rule_key: "R2", detail: { text: null } },
    ]);
    expect(r2({ current: { "result.blocker.status": "沒有" }, previous: null, params: p })).toEqual([]);
    expect(r2({ current: {}, previous: null, params: p })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseRulesSettings (zod, PLAN 4.8)
// ---------------------------------------------------------------------------

describe("parseRulesSettings", () => {
  it("accepts the seed RULES_SETTINGS and RULES_DEFAULTS unchanged", () => {
    expect(parseRulesSettings(RULES_SETTINGS)).toEqual(RULES_SETTINGS);
    expect(parseRulesSettings(RULES_DEFAULTS)).toEqual(RULES_DEFAULTS);
    expect(rulesSettingsErrors(RULES_DEFAULTS)).toEqual([]);
  });

  it("rejects a missing R1.params.expect_done", () => {
    const bad = {
      ...RULES_DEFAULTS,
      R1: { enabled: true, params: { status_done: ["完成"] } },
    };
    expect(rulesSettingsErrors(bad)).toEqual(["rules.R1.params.expect_done：expect_done 必須是字串"]);
    expect(() => parseRulesSettings(bad)).toThrow(RulesSettingsError);
    expect(() => parseRulesSettings(bad)).toThrow(
      "settings.rules 格式不正確：rules.R1.params.expect_done：expect_done 必須是字串",
    );
  });

  it("rejects status_done that is not an array", () => {
    const bad = {
      ...RULES_DEFAULTS,
      R1: { enabled: true, params: { expect_done: "完成", status_done: "完成" } },
    };
    expect(rulesSettingsErrors(bad)).toEqual([
      "rules.R1.params.status_done：status_done 必須是字串陣列",
    ]);
    expect(() => parseRulesSettings(bad)).toThrow(RulesSettingsError);
  });

  it("rejects an unknown rule key", () => {
    const bad = { ...RULES_DEFAULTS, R9: { enabled: true } };
    expect(rulesSettingsErrors(bad)).toEqual(["rules：未知的規則 「R9」（只允許 R1、R2、R3、A1）"]);
    expect(() => parseRulesSettings(bad)).toThrow(RulesSettingsError);
  });

  it("lists every reason at once", () => {
    const bad = {
      R1: { enabled: "yes", params: { expect_done: "", status_done: [] } },
      R2: { enabled: true, params: { unreported: "有，尚未回報", extra: 1 } },
      R3: { enabled: true },
    };
    let caught: unknown;
    try {
      parseRulesSettings(bad);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RulesSettingsError);
    const reasons = (caught as RulesSettingsError).reasons;
    expect(reasons).toContain("rules.R1.enabled：enabled 必須是布林值");
    expect(reasons).toContain("rules.R1.params.expect_done：expect_done 不得為空");
    expect(reasons).toContain("rules.R1.params.status_done：status_done 至少要有一個值");
    expect(reasons).toContain("rules.R2.params：未知的欄位 「extra」");
    expect(reasons).toContain("rules.A1：A1 必須是物件");
    expect(reasons.length).toBeGreaterThanOrEqual(5);
  });

  it("rejects non-objects", () => {
    expect(rulesSettingsErrors(null)).toEqual(["rules：rules 必須是物件"]);
    expect(rulesSettingsErrors("x")).toEqual(["rules：rules 必須是物件"]);
    expect(() => parseRulesSettings([])).toThrow(RulesSettingsError);
  });
});
