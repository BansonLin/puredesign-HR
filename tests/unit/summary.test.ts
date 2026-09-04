import { describe, expect, it } from "vitest";
import { EXPECTED_SUMMARY_0903_1800 } from "@seed/fixtures";
import {
  ALERT_RULE_LABELS,
  SUMMARY_SEPARATOR,
  alertRuleLabel,
  buildDailySummary,
  summaryLink,
  type DailySummaryInput,
} from "@/lib/metrics/summary";

/**
 * T19 one-line summary (PLAN A13, §8 format). The pure formatter is pinned
 * to the §11 expectation for 9/3 18:00 and to the T19 row for 9/4 18:00;
 * the facts behind both lines come from `buildHrDashboard`, which
 * tests/unit/dashboard.test.ts feeds into this same function.
 */

const BASE_URL = "http://localhost:3000";

/** The 9/3 18:00 facts as `EXPECTED_SUMMARY_0903_1800` states them. */
const FACTS_0903: DailySummaryInput = {
  date: "2026-09-03",
  submitted: EXPECTED_SUMMARY_0903_1800.submitted,
  expected: EXPECTED_SUMMARY_0903_1800.expected,
  todayAlerts: [
    { display_name: "嚴雅齡", rule_key: "R1" },
    { display_name: "洪湘庭", rule_key: "R2" },
  ],
  openCount: EXPECTED_SUMMARY_0903_1800.awaiting_response,
  baseUrl: BASE_URL,
};

describe("buildDailySummary (§8 一行摘要, PLAN A13)", () => {
  it("9/3 18:00 → 9/3 新人日誌｜4/4 已交｜預警 2 筆：嚴雅齡（進度）、洪湘庭（卡點）｜待主管回應：2｜{APP_BASE_URL}/", () => {
    expect(buildDailySummary(FACTS_0903)).toBe(
      "9/3 新人日誌｜4/4 已交｜預警 2 筆：嚴雅齡（進度）、洪湘庭（卡點）｜待主管回應：2｜http://localhost:3000/",
    );
  });

  it("every field of EXPECTED_SUMMARY_0903_1800 appears in its own segment", () => {
    const segments = buildDailySummary(FACTS_0903).split(SUMMARY_SEPARATOR);
    expect(segments).toHaveLength(5);
    expect(segments[0]).toBe(`${EXPECTED_SUMMARY_0903_1800.date_label} 新人日誌`);
    expect(segments[1]).toBe(
      `${EXPECTED_SUMMARY_0903_1800.submitted}/${EXPECTED_SUMMARY_0903_1800.expected} 已交`,
    );
    expect(segments[2]).toBe(
      `預警 ${EXPECTED_SUMMARY_0903_1800.alerts} 筆：${EXPECTED_SUMMARY_0903_1800.alert_lines.join("、")}`,
    );
    expect(segments[3]).toBe(`待主管回應：${EXPECTED_SUMMARY_0903_1800.awaiting_response}`);
    expect(segments[4]).toBe(`${BASE_URL}/`);
    expect(EXPECTED_SUMMARY_0903_1800.missing).toEqual([]);
  });

  it("9/4 18:00 → 0/4 已交、預警 0 筆（no list）、待主管回應：1", () => {
    const line = buildDailySummary({
      date: "2026-09-04",
      submitted: 0,
      expected: 4,
      todayAlerts: [],
      openCount: 1,
      baseUrl: BASE_URL,
    });
    expect(line).toBe("9/4 新人日誌｜0/4 已交｜預警 0 筆｜待主管回應：1｜http://localhost:3000/");
    expect(line).toContain("0/4 已交");
    expect(line).toContain("預警 0 筆");
    expect(line).not.toContain("預警 0 筆：");
    expect(line).toContain("待主管回應：1");
  });

  it("renders the date as M/D without zero padding (Taipei calendar date, no clock involved)", () => {
    const at = (date: string) =>
      buildDailySummary({ ...FACTS_0903, date }).split(SUMMARY_SEPARATOR)[0];
    expect(at("2026-09-11")).toBe("9/11 新人日誌");
    expect(at("2026-10-01")).toBe("10/1 新人日誌");
    expect(at("2026-12-25")).toBe("12/25 新人日誌");
  });

  it("names alerts in the given order; a single alert has no separator", () => {
    const one = buildDailySummary({
      ...FACTS_0903,
      todayAlerts: [{ display_name: "洪湘庭", rule_key: "R2" }],
    });
    expect(one.split(SUMMARY_SEPARATOR)[2]).toBe("預警 1 筆：洪湘庭（卡點）");
    const reversed = buildDailySummary({
      ...FACTS_0903,
      todayAlerts: [...FACTS_0903.todayAlerts].reverse(),
    });
    expect(reversed.split(SUMMARY_SEPARATOR)[2]).toBe("預警 2 筆：洪湘庭（卡點）、嚴雅齡（進度）");
  });

  it("the same newcomer with both R1 and R2 is listed twice (one entry per alert)", () => {
    const line = buildDailySummary({
      ...FACTS_0903,
      todayAlerts: [
        { display_name: "嚴雅齡", rule_key: "R1" },
        { display_name: "嚴雅齡", rule_key: "R2" },
      ],
    });
    expect(line.split(SUMMARY_SEPARATOR)[2]).toBe("預警 2 筆：嚴雅齡（進度）、嚴雅齡（卡點）");
  });

  it("R1 → 進度, R2 → 卡點, unknown keys fall back to the key", () => {
    expect(ALERT_RULE_LABELS).toEqual({ R1: "進度", R2: "卡點" });
    expect(alertRuleLabel("R1")).toBe("進度");
    expect(alertRuleLabel("R2")).toBe("卡點");
    expect(alertRuleLabel("R9")).toBe("R9");
    expect(
      buildDailySummary({ ...FACTS_0903, todayAlerts: [{ display_name: "X", rule_key: "R9" }] }),
    ).toContain("預警 1 筆：X（R9）");
  });

  it("links to the root path of APP_BASE_URL regardless of trailing slashes or whitespace", () => {
    expect(summaryLink("http://localhost:3000")).toBe("http://localhost:3000/");
    expect(summaryLink("http://localhost:3000/")).toBe("http://localhost:3000/");
    expect(summaryLink("https://onboard.example.com//")).toBe("https://onboard.example.com/");
    expect(summaryLink(" https://onboard.example.com ")).toBe("https://onboard.example.com/");
    const line = buildDailySummary({ ...FACTS_0903, baseUrl: "https://onboard.example.com/" });
    expect(line.endsWith("｜https://onboard.example.com/")).toBe(true);
    expect(line).not.toContain("/hr");
  });

  it("does not modify its input", () => {
    const input: DailySummaryInput = {
      ...FACTS_0903,
      todayAlerts: [...FACTS_0903.todayAlerts],
    };
    const snapshot = structuredClone(input);
    buildDailySummary(input);
    expect(input).toEqual(snapshot);
  });
});
