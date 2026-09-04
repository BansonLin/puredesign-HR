import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildHistoryRows,
  HISTORY_NO_ALERTS_LABEL,
  HISTORY_NO_RESPONSE_LABEL,
  HISTORY_NO_WEEKLY_LABEL,
  HISTORY_ON_BEHALF_LABEL,
  HISTORY_VERSION_MISSING_LABEL,
  HistoryList,
  logSummaryFields,
  NO_HISTORY_LABEL,
  type HistoryAlertLike,
  type HistoryLogLike,
  type HistoryResponseLike,
  type HistoryWeeklyLike,
} from "@/components/dashboard/HistoryList";
import type { ResponderLike } from "@/components/dashboard/Timeline";
import type { Json } from "@/lib/db/types";
import { parseQuestions, type Question } from "@/lib/forms/schema";
import { RESPONSE_STATUS_NO_ACTION } from "@/lib/rules/constants";
import {
  BASE_PROFILES,
  CLOCK_0904_1200,
  CLOCK_0904_1800,
  FIXTURE_MANAGERS,
  FIXTURE_NEWCOMERS,
  FIXTURE_WEEKLY_FEEDBACK,
  FORM_TEMPLATES,
  SETTINGS,
} from "@seed/fixtures";
import { buildSeedPlan } from "@seed/plan";

/**
 * T21 /me/history builder against the §11 fixture (rows from `buildSeedPlan`,
 * the same pipeline that seeds the database) with the PLAN 4.9.5 fake
 * clocks, and the component through react-dom/server.
 *
 * Acceptance (PLAN T21): Darren 9/3 has no alert but the 「已讀，無需處理」
 * response and the 8/31 weekly feedback (three lines); 嚴雅齡 9/3 has a
 * responded R1 with 「已處理」 and the one-line comment; 洪湘庭 9/3 has an R2
 * awaiting response; no logs → 「還沒有日誌」.
 */

// ---------------------------------------------------------------------------
// fixture → row shapes (natural keys → ids, as seed.ts does)
// ---------------------------------------------------------------------------

const PLAN = buildSeedPlan();
const THRESHOLD_HOURS = SETTINGS.response_threshold_hours as number;

function parsed(questions: unknown): readonly Question[] {
  const result = parseQuestions(questions);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.questions;
}

const VERSIONS: ReadonlyMap<string, readonly Question[]> = new Map(
  FORM_TEMPLATES.map((t) => [t.v1.id, parsed(t.v1.questions)] as const),
);
const DAILY_V1 = FORM_TEMPLATES.find((t) => t.key === "newcomer_daily")!.v1.id;

function newcomerId(username: string): string {
  const found = FIXTURE_NEWCOMERS.find((n) => n.username === username);
  if (!found) throw new Error(`unknown newcomer ${username}`);
  return found.id;
}

const logId = (seq: number) => `log-${seq}`;

const LOGS: (HistoryLogLike & { user_id: string })[] = PLAN.logs.map((log) => ({
  id: logId(log.seq),
  user_id: log.user_id,
  log_date: log.log_date,
  submitted_at: log.submitted_at,
  form_version_id: log.form_version_id,
  answers: log.answers as Json,
}));

const ALERTS: (HistoryAlertLike & { user_id: string })[] = PLAN.alerts.map((alert, index) => ({
  id: `alert-${index + 1}`,
  submission_id: logId(alert.log_seq),
  user_id: PLAN.logs.find((l) => l.seq === alert.log_seq)!.user_id,
  rule_key: alert.rule_key,
  detail: alert.detail as Json,
  status: alert.status,
  created_at: alert.created_at,
  responded_at: alert.responded_at,
}));

const RESPONSES: HistoryResponseLike[] = PLAN.responses.map((response) => ({
  id: `resp-${response.seq}`,
  user_id: response.user_id,
  target_submission_id: logId(response.target_log_seq),
  submitted_at: response.submitted_at,
  form_version_id: response.form_version_id,
  answers: response.answers as Json,
}));

const WEEKLY: (HistoryWeeklyLike & { target_user_id: string })[] = PLAN.weekly.map((entry) => ({
  id: `weekly-${entry.seq}`,
  user_id: entry.user_id,
  target_user_id: entry.target_user_id,
  week_start: entry.week_start,
  submitted_at: entry.submitted_at,
  form_version_id: entry.form_version_id,
  answers: entry.answers as Json,
}));

const RESPONDERS: ReadonlyMap<string, ResponderLike> = new Map(
  [...FIXTURE_MANAGERS, ...BASE_PROFILES].map((p) => [
    p.id,
    { id: p.id, display_name: p.display_name, role: p.role } satisfies ResponderLike,
  ]),
);
const HR = BASE_PROFILES.find((p) => p.username === "hr")!;

/** What the page hands the builder for one signed-in newcomer (§10 row 2: own rows only). */
function rowsOf(username: string, now: Date, overrides: Partial<Parameters<typeof buildHistoryRows>[0]> = {}) {
  const id = newcomerId(username);
  const logs = LOGS.filter((l) => l.user_id === id);
  const logIds = new Set(logs.map((l) => l.id));
  return buildHistoryRows({
    logs,
    versions: VERSIONS,
    alerts: ALERTS.filter((a) => a.user_id === id),
    responses: RESPONSES.filter((r) => r.target_submission_id !== null && logIds.has(r.target_submission_id)),
    weekly: WEEKLY.filter((w) => w.target_user_id === id),
    responders: RESPONDERS,
    now,
    thresholdHours: THRESHOLD_HOURS,
    ...overrides,
  });
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, "");

// ---------------------------------------------------------------------------
// builder
// ---------------------------------------------------------------------------

describe("buildHistoryRows — ordering and summary", () => {
  it("lists own logs newest first, one row per log_date, with the week's Monday", () => {
    const rows = rowsOf("darren", CLOCK_0904_1800);
    expect(rows.map((r) => r.date)).toEqual(["2026-09-03", "2026-09-02"]);
    expect(rows.map((r) => r.dateLabel)).toEqual(["9/3", "9/2"]);
    expect(rows.map((r) => r.weekStart)).toEqual(["2026-08-31", "2026-08-31"]);
    expect(rows[0].submittedAtLabel).toBe("17:01");
    expect(rows.every((r) => !r.versionMissing)).toBe(true);
  });

  it("the summary uses the log's own version labels and only visible, answered questions", () => {
    const rows = rowsOf("darren", CLOCK_0904_1800);
    const summary = rows[0].summary; // Darren 9/3
    const byKey = Object.fromEntries(summary.map((f) => [f.key, f]));
    expect(byKey.r1_status).toEqual({ key: "r1_status", label: "昨日項目一狀態", value: "完成" });
    expect(byKey.r2_status.value).toBe("持續中");
    expect(byKey.extra_work).toEqual({ key: "extra_work", label: "臨時新增工作", value: "文風19 安排木工維修隱藏門" });
    expect(byKey.learned.value).toBe("知道哪裡看施工進度");
    expect(byKey.p1_text.value).toBe("文風19 木工維修敲定");
    // r1_reason is hidden (r1_status = 完成) and r2_reason was left blank → neither is listed.
    expect(byKey.r1_reason).toBeUndefined();
    expect(byKey.r2_reason).toBeUndefined();
    // p3_expect is hidden because p3_text is empty (show_if not_empty).
    expect(byKey.p3_text).toBeUndefined();
    expect(byKey.p3_expect).toBeUndefined();
    // Order follows the version's `order`.
    expect(summary.map((f) => f.key).slice(0, 3)).toEqual(["r1_status", "r2_status", "r3_status"]);
  });

  it("a missing version yields versionMissing and an empty summary", () => {
    const rows = rowsOf("darren", CLOCK_0904_1800, { versions: new Map() });
    expect(rows[0].versionMissing).toBe(true);
    expect(rows[0].summary).toEqual([]);
    expect(logSummaryFields(null, {})).toEqual([]);
  });

  it("ignores logs without log_date and alerts of other people's logs", () => {
    const darren = newcomerId("darren");
    const rows = buildHistoryRows({
      logs: [...LOGS.filter((l) => l.user_id === darren), { ...LOGS[0], id: "undated", log_date: null }],
      versions: VERSIONS,
      alerts: ALERTS, // includes 嚴雅齡's R1 and 洪湘庭's R2, hung on other submissions
      responses: RESPONSES,
      weekly: WEEKLY,
      responders: RESPONDERS,
      now: CLOCK_0904_1800,
      thresholdHours: THRESHOLD_HOURS,
    });
    expect(rows.map((r) => r.logId)).toEqual([logId(5), logId(1)]);
    expect(rows.flatMap((r) => r.alerts)).toEqual([]);
  });
});

describe("buildHistoryRows — §11 acceptance rows", () => {
  it("Darren 9/3: no alert, the 「已讀，無需處理」 response, and the 8/31 weekly feedback (three lines)", () => {
    const [d0903, d0902] = rowsOf("darren", CLOCK_0904_1800);
    expect(d0903.alerts).toEqual([]);
    expect(d0903.responses).toHaveLength(1);
    expect(d0903.responses[0]).toMatchObject({
      responderName: "工務主任",
      onBehalf: false,
      submittedAtLabel: "9/4 09:20",
      status: RESPONSE_STATUS_NO_ACTION,
      comment: null,
    });

    expect(d0903.weekly).toHaveLength(1);
    const weekly = d0903.weekly[0];
    const expected = FIXTURE_WEEKLY_FEEDBACK[0];
    expect(weekly).toMatchObject({
      weekStart: "2026-08-31",
      weekStartLabel: "8/31",
      authorName: "工務主任",
      onBehalf: false,
      submittedAtLabel: "9/4 17:00",
      versionMissing: false,
    });
    expect(weekly.lines).toEqual([
      { key: "weekly.good", label: "做得好的一件事", value: expected.answers.good },
      { key: "weekly.improve", label: "要改的一件事", value: expected.answers.improve },
      { key: "weekly.next_focus", label: "下週重點", value: expected.answers.next_focus },
    ]);
    // 9/2 is in the same week: the same feedback shows there, with no response.
    expect(d0902.weekly.map((w) => w.id)).toEqual([weekly.id]);
    expect(d0902.responses).toEqual([]);
    expect(d0902.alerts).toEqual([]);
  });

  it("嚴雅齡 9/3: one R1, responded, with 「已處理」 and the one-line comment; no weekly feedback", () => {
    const [y0903, y0902] = rowsOf("yen_yaling", CLOCK_0904_1800);
    expect(y0903.alerts).toHaveLength(1);
    expect(y0903.alerts[0]).toMatchObject({ ruleKey: "R1", kindLabel: "進度", state: "responded" });
    expect(y0903.alerts[0].lines).toHaveLength(2);
    expect(y0903.alerts[0].lines[0]).toContain("項目一");
    expect(y0903.alerts[0].lines[1]).toContain("項目三");
    expect(y0903.responses).toHaveLength(1);
    expect(y0903.responses[0]).toMatchObject({
      responderName: "採購主管",
      onBehalf: false,
      submittedAtLabel: "9/4 09:10",
      status: "已處理",
      comment: "已請 Patty 給工項對照表；宏偉訂金明早追",
    });
    expect(y0903.weekly).toEqual([]);
    expect(y0902.alerts).toEqual([]);
  });

  it("洪湘庭 9/3: one R2 awaiting response (待回應 at 9/4 12:00, 逾時 at 9/4 18:00)", () => {
    const noon = rowsOf("hung_hsiangting", CLOCK_0904_1200)[0];
    expect(noon.date).toBe("2026-09-03");
    expect(noon.alerts).toHaveLength(1);
    expect(noon.alerts[0]).toMatchObject({ ruleKey: "R2", kindLabel: "卡點", state: "open" });
    expect(noon.alerts[0].lines).toEqual(["Luma 免費版有次數限制，只做了 3 張圖"]);
    expect(noon.responses).toEqual([]);

    const evening = rowsOf("hung_hsiangting", CLOCK_0904_1800)[0];
    expect(evening.alerts[0].state).toBe("overdue");
  });

  it("謝文心 9/3: zero alerts, no response, no weekly feedback", () => {
    const [h0903] = rowsOf("hsieh_wenhsin", CLOCK_0904_1800);
    expect(h0903.alerts).toEqual([]);
    expect(h0903.responses).toEqual([]);
    expect(h0903.weekly).toEqual([]);
  });

  it("a response or weekly feedback written by hr / admin is flagged on_behalf", () => {
    const darren = newcomerId("darren");
    const darrenLogs = LOGS.filter((l) => l.user_id === darren);
    const hrResponse: HistoryResponseLike = {
      ...RESPONSES.find((r) => r.id === "resp-10")!,
      id: "resp-hr",
      user_id: HR.id,
      submitted_at: "2026-09-04T10:00:00+08:00",
    };
    const hrWeekly: HistoryWeeklyLike = { ...WEEKLY[0], id: "weekly-hr", user_id: HR.id };
    const rows = rowsOf("darren", CLOCK_0904_1800, {
      logs: darrenLogs,
      responses: [hrResponse],
      weekly: [hrWeekly],
    });
    expect(rows[0].responses[0]).toMatchObject({ responderName: "HR", onBehalf: true });
    expect(rows[0].weekly[0]).toMatchObject({ authorName: "HR", onBehalf: true });
  });
});

// ---------------------------------------------------------------------------
// component (react-dom/server)
// ---------------------------------------------------------------------------

describe("HistoryList", () => {
  it("renders 「還沒有日誌」 when there is no log", () => {
    const html = renderToStaticMarkup(<HistoryList rows={[]} />);
    expect(html).toContain(NO_HISTORY_LABEL);
    expect(html).toContain('data-testid="history-empty"');
    expect(html).not.toContain('data-testid="history-row"');
  });

  it("renders Darren's rows: summary labels, the response, the weekly lines, no alert", () => {
    const html = renderToStaticMarkup(<HistoryList rows={rowsOf("darren", CLOCK_0904_1800)} />);
    expect(html.match(/data-testid="history-row"/g)).toHaveLength(2);
    expect(html.indexOf('data-date="2026-09-03"')).toBeLessThan(html.indexOf('data-date="2026-09-02"'));
    const text = textOf(html);
    expect(text).toContain("9/3 日誌");
    expect(text).toContain("昨日項目一狀態完成");
    expect(text).toContain("臨時新增工作文風19 安排木工維修隱藏門");
    expect(text).toContain(HISTORY_NO_ALERTS_LABEL);
    expect(text).toContain(`工務主任9/4 09:20${RESPONSE_STATUS_NO_ACTION}`);
    expect(text).toContain("週回饋（8/31 起）");
    expect(text).toContain("做得好的一件事案場紀律好，拍照上傳準時");
    expect(text).toContain("要改的一件事木工協調要自己先問工班時間");
    expect(text).toContain("下週重點文風19 木工維修獨立收尾");
    expect(html).not.toContain(HISTORY_ON_BEHALF_LABEL);
    expect(html).not.toContain("<table");
  });

  it("renders 嚴雅齡's R1 badge (已回應) with 「已處理｜一句話」 and 「本週尚無週回饋」", () => {
    const html = renderToStaticMarkup(<HistoryList rows={rowsOf("yen_yaling", CLOCK_0904_1800)} />);
    expect(html).toContain('data-rule="R1"');
    expect(html).toContain('data-state="responded"');
    const text = textOf(html);
    expect(text).toContain("進度預警｜已回應");
    expect(text).toContain("已處理｜已請 Patty 給工項對照表；宏偉訂金明早追");
    expect(text).toContain(HISTORY_NO_WEEKLY_LABEL);
  });

  it("renders 洪湘庭's R2 as 待回應 / 逾時 with 「主管尚未回應」", () => {
    const noon = textOf(renderToStaticMarkup(<HistoryList rows={rowsOf("hung_hsiangting", CLOCK_0904_1200)} />));
    expect(noon).toContain("卡點預警｜待回應");
    expect(noon).toContain("Luma 免費版有次數限制，只做了 3 張圖");
    expect(noon).toContain(HISTORY_NO_RESPONSE_LABEL);
    const evening = textOf(renderToStaticMarkup(<HistoryList rows={rowsOf("hung_hsiangting", CLOCK_0904_1800)} />));
    expect(evening).toContain("卡點預警｜逾時");
  });

  it("tags an hr response 「HR 代填」 and reports a missing version", () => {
    const darren = newcomerId("darren");
    const hrResponse: HistoryResponseLike = {
      ...RESPONSES.find((r) => r.id === "resp-10")!,
      id: "resp-hr",
      user_id: HR.id,
    };
    const tagged = renderToStaticMarkup(
      <HistoryList rows={rowsOf("darren", CLOCK_0904_1800, { responses: [hrResponse] })} />,
    );
    expect(tagged).toContain(HISTORY_ON_BEHALF_LABEL);

    const missing = renderToStaticMarkup(
      <HistoryList
        rows={rowsOf("darren", CLOCK_0904_1800, {
          logs: LOGS.filter((l) => l.user_id === darren && l.form_version_id === DAILY_V1),
          versions: new Map(),
        })}
      />,
    );
    expect(missing).toContain(HISTORY_VERSION_MISSING_LABEL);
  });
});
