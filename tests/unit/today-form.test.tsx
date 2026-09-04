import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NO_YESTERDAY_PLAN_MESSAGE, TodayForm, topItemNo, topPriorityOptions, type YesterdayInfo } from "@/app/(front)/me/today/TodayForm";
import type { FormActionState } from "@/components/forms/FormRenderer";
import { readYesterdayPlan } from "@/lib/forms/resolve";
import { parseQuestions, type Question } from "@/lib/forms/schema";
import { FIXTURE_DAILY_LOGS, NEWCOMER_DAILY_QUESTIONS } from "@seed/fixtures";

/**
 * T15 `TodayForm` through react-dom/server (initial state of the client
 * hooks, like the renderer tests): block one shows yesterday's items above
 * the three `r{i}_status` questions, the 「最重要」 badge follows the
 * `plan.top_priority` option index, the no-plan hint appears once when there
 * is no previous log, and `previousVersionMissing` hides the hints and
 * disables the submit button.
 */

const noop = async (): Promise<FormActionState> => ({ ok: true });

function v1(): readonly Question[] {
  const parsed = parseQuestions(NEWCOMER_DAILY_QUESTIONS);
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.questions;
}

const QUESTIONS = v1();
const V1_TOP_OPTIONS = topPriorityOptions(QUESTIONS);

function fixtureLog(username: string, logDate: string) {
  const found = FIXTURE_DAILY_LOGS.find((l) => l.username === username && l.log_date === logDate);
  if (!found) throw new Error(`no fixture log for ${username} ${logDate}`);
  return found;
}

/** 嚴雅齡's 9/2 log as "yesterday" for her 9/3 form. */
function yenYesterday(): YesterdayInfo {
  const log = fixtureLog("yen_yaling", "2026-09-02");
  return {
    dateLabel: "9/2",
    plan: readYesterdayPlan(log.answers, QUESTIONS),
    topOptions: V1_TOP_OPTIONS,
  };
}

function render(props: {
  yesterday: YesterdayInfo | null;
  previousVersionMissing?: boolean;
}) {
  return renderToStaticMarkup(
    <TodayForm
      questions={QUESTIONS}
      initialAnswers={null}
      yesterday={props.yesterday}
      previousVersionMissing={props.previousVersionMissing}
      savedPlan={null}
      action={noop}
    />,
  );
}

/** Rendered text without tags (yesterday's line is split over several spans). */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/** The `data-testid="yesterday-item-N"` block (outer html). */
function yesterdayItem(html: string, no: 1 | 2 | 3): string {
  const marker = `data-testid="yesterday-item-${no}"`;
  const at = html.indexOf(marker);
  if (at === -1) throw new Error(`no yesterday-item-${no}`);
  const start = html.lastIndexOf("<div", at);
  const end = html.indexOf("</div>", at);
  return html.slice(start, end);
}

describe("topItemNo / topPriorityOptions", () => {
  it("maps the option label by index (items[i] ↔ options[i]) and returns null otherwise", () => {
    expect(V1_TOP_OPTIONS).toEqual(["項目一", "項目二", "項目三"]);
    expect(topItemNo("項目一", V1_TOP_OPTIONS)).toBe(1);
    expect(topItemNo("項目二", V1_TOP_OPTIONS)).toBe(2);
    expect(topItemNo("項目三", V1_TOP_OPTIONS)).toBe(3);
    expect(topItemNo("項目四", V1_TOP_OPTIONS)).toBeNull();
    expect(topItemNo(null, V1_TOP_OPTIONS)).toBeNull();
    expect(topItemNo("項目一", null)).toBeNull();
    // a relabelled version: the index, not the literal, decides
    expect(topItemNo("B", ["A", "B", "C"])).toBe(2);
    expect(topItemNo("D", ["A", "B", "C", "D"])).toBeNull();
    // no (enabled) top_priority question → null
    expect(topPriorityOptions(QUESTIONS.filter((q) => q.slot !== "plan.top_priority"))).toBeNull();
    expect(
      topPriorityOptions(
        QUESTIONS.map((q) => (q.slot === "plan.top_priority" ? { ...q, disabled: true } : q)),
      ),
    ).toBeNull();
  });
});

describe("TodayForm: block one with 嚴雅齡's 9/2 plan as yesterday", () => {
  const html = render({ yesterday: yenYesterday() });
  const text = textOf(html);

  it("shows the three yesterday items above the r{i}_status questions", () => {
    expect(text).toContain("昨日項目一：請款總表移到新表單（預計 完成）");
    expect(text).toContain("昨日項目二：裕福門窗報價（預計 完成）");
    expect(text).toContain("昨日項目三：鋁門窗宏偉報價（預計 完成）");
    for (const no of [1, 2, 3] as const) {
      const item = html.indexOf(`data-testid="yesterday-item-${no}"`);
      const label = html.indexOf(`id="q-r${no}_status-label"`);
      expect(item).toBeGreaterThan(-1);
      expect(label).toBeGreaterThan(-1);
      expect(item).toBeLessThan(label);
    }
    expect((html.match(/data-testid="yesterday-item-/g) ?? []).length).toBe(3);
  });

  it("puts the 最重要 badge on item 2 only (top = 項目二 → options[1])", () => {
    expect(yesterdayItem(html, 2)).toContain("最重要");
    expect(yesterdayItem(html, 1)).not.toContain("最重要");
    expect(yesterdayItem(html, 3)).not.toContain("最重要");
  });

  it("renders the two section headings in order and the date reference", () => {
    const first = html.indexOf("昨日計畫結算");
    const second = html.indexOf("今日回報與明日計畫");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(html).toContain("對照 9/2 日誌的明日計畫");
    expect(html).not.toContain(NO_YESTERDAY_PLAN_MESSAGE);
    expect(html).not.toContain("請選『昨日無此項』");
  });

  it("no badge when the top label is not among the version's options", () => {
    // (the v1 label 「明日最重要的一件事」 also contains 最重要, so look inside the item blocks)
    const relabelled = render({
      yesterday: { ...yenYesterday(), topOptions: ["A", "B", "C"] },
    });
    const noQuestion = render({ yesterday: { ...yenYesterday(), topOptions: null } });
    for (const no of [1, 2, 3] as const) {
      expect(yesterdayItem(relabelled, no)).not.toContain("最重要");
      expect(yesterdayItem(noQuestion, no)).not.toContain("最重要");
    }
  });

  it("submit button enabled, labelled 儲存今日日誌", () => {
    const button = html.slice(html.lastIndexOf("<button"), html.lastIndexOf("</button>") + 9);
    expect(button).toContain("儲存今日日誌");
    expect(button).not.toMatch(/ disabled=""/);
  });
});

describe("TodayForm: no previous log", () => {
  const html = render({ yesterday: null });

  it("shows 昨天沒有計畫 exactly once and no per-item lines", () => {
    expect((html.match(new RegExp(NO_YESTERDAY_PLAN_MESSAGE, "g")) ?? []).length).toBe(1);
    expect(html).not.toContain("data-testid=\"yesterday-item-");
    expect(html).not.toContain("昨日沒有項目");
    // the three status questions are still rendered (and required)
    for (const no of [1, 2, 3]) expect(html).toContain(`id="q-r${no}_status"`);
  });

  it("a previous log with an empty plan → per-item 昨日沒有項目 hints, no 昨天沒有計畫", () => {
    const empty = render({
      yesterday: { dateLabel: "9/2", plan: readYesterdayPlan(null, null), topOptions: null },
    });
    expect(empty).not.toContain(NO_YESTERDAY_PLAN_MESSAGE);
    expect(textOf(empty)).toContain("昨日沒有項目一，請選『昨日無此項』");
    expect(textOf(empty)).toContain("昨日沒有項目三，請選『昨日無此項』");
  });
});

describe("TodayForm: previousVersionMissing", () => {
  const html = render({
    yesterday: { dateLabel: "9/2", plan: readYesterdayPlan(null, null), topOptions: null },
    previousVersionMissing: true,
  });

  it("renders no per-item hint and no 昨天沒有計畫 (the page's alert is the only message)", () => {
    expect(html).not.toContain("請選『昨日無此項』");
    expect(html).not.toContain(NO_YESTERDAY_PLAN_MESSAGE);
    expect(html).not.toContain("data-testid=\"yesterday-item-");
    expect(html).toContain("昨日計畫結算");
  });

  it("disables the submit button while the controls stay editable", () => {
    const button = html.slice(html.lastIndexOf("<button"), html.lastIndexOf("</button>") + 9);
    expect(button).toMatch(/ disabled=""/);
    expect(button).toContain("儲存今日日誌");
    expect(html.slice(0, html.lastIndexOf("<button"))).not.toMatch(/ disabled=""/);
  });
});
