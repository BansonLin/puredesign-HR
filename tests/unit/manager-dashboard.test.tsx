import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AlertBadge, alertBadgeText, alertKindLabel, alertStateLabel } from "@/components/dashboard/AlertBadge";
import {
  buildNewcomerCard,
  latestLogBefore,
  LOG_STATUS_LABELS,
  NewcomerCard,
  newcomerScope,
  NO_PLAN_LABEL,
  parseDashboardSettings,
  PLAN_VERSION_MISSING_LABEL,
  planItemsOf,
  type DailyLogLike,
} from "@/components/dashboard/NewcomerCard";
import {
  alertDetailLines,
  buildTimeline,
  NO_LOGS_LABEL,
  NO_PREVIOUS_LOG_LABEL,
  NO_RESPONSE_LABEL,
  ON_BEHALF_LABEL,
  Timeline,
  type ResponderLike,
  type TimelineAlertLike,
  type TimelineLogLike,
  type TimelineResponseLike,
} from "@/components/dashboard/Timeline";
import { canAccessNewcomer, type Actor } from "@/lib/auth/policy";
import type { Json } from "@/lib/db/types";
import { readYesterdayPlan } from "@/lib/forms/resolve";
import { parseQuestions, type Question } from "@/lib/forms/schema";
import {
  BASE_PROFILES,
  CLOCK_0904_1200,
  CLOCK_0904_1800,
  CLOCK_0904_1830,
  DEPARTMENTS,
  FIXTURE_MANAGERS,
  FIXTURE_NEWCOMERS,
  FORM_TEMPLATES,
  SETTINGS,
} from "@seed/fixtures";
import { buildSeedPlan } from "@seed/plan";

/**
 * T17 /manager card + timeline builders against the §11 fixture (rows come
 * from `buildSeedPlan`, i.e. the same pipeline that seeds the database) with
 * the PLAN 4.9.5 fake clocks, and the components through react-dom/server.
 *
 * Acceptance (PLAN T17): 工務主任 only sees Darren; 工務主任 opening 嚴雅齡 is
 * denied by `canAccessNewcomer` (the page's 403); 採購主管 opening 嚴雅齡 sees
 * on 9/3 an R1 with two items and the 9/4 09:10 「已處理」 response; 信義總監
 * opening 洪湘庭 sees an R2 待回應 (逾時 at 9/4 18:00).
 */

// ---------------------------------------------------------------------------
// fixture → row shapes (natural keys → ids, as seed.ts does)
// ---------------------------------------------------------------------------

const PLAN = buildSeedPlan();
const TODAY_0904 = "2026-09-04";
const DASHBOARD_SETTINGS = parseDashboardSettings({
  daily_cutoff_time: SETTINGS.daily_cutoff_time,
  response_threshold_hours: SETTINGS.response_threshold_hours,
});

function departmentId(name: string | null): string | null {
  if (name === null) return null;
  const found = DEPARTMENTS.find((d) => d.name === name);
  if (!found) throw new Error(`unknown department ${name}`);
  return found.id;
}

type SeedPerson = (typeof FIXTURE_MANAGERS)[number] | (typeof FIXTURE_NEWCOMERS)[number] | (typeof BASE_PROFILES)[number];

/** A profile row shaped like `Tables<'profiles'>` for the columns the builders read. */
function profile(person: SeedPerson) {
  return {
    id: person.id,
    display_name: person.display_name,
    role: person.role,
    department_id: departmentId(person.department),
    status: person.status,
    start_date: person.start_date,
  };
}

function manager(username: string) {
  const found = FIXTURE_MANAGERS.find((m) => m.username === username);
  if (!found) throw new Error(`unknown manager ${username}`);
  return profile(found);
}

function newcomer(username: string) {
  const found = FIXTURE_NEWCOMERS.find((n) => n.username === username);
  if (!found) throw new Error(`unknown newcomer ${username}`);
  return profile(found);
}

const HR = profile(BASE_PROFILES.find((p) => p.username === "hr")!);

function parsed(questions: unknown): readonly Question[] {
  const result = parseQuestions(questions);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.questions;
}

const VERSIONS: ReadonlyMap<string, readonly Question[]> = new Map(
  FORM_TEMPLATES.map((t) => [t.v1.id, parsed(t.v1.questions)] as const),
);
const DAILY_V1 = FORM_TEMPLATES.find((t) => t.key === "newcomer_daily")!.v1.id;
const RESPONSE_V1 = FORM_TEMPLATES.find((t) => t.key === "manager_response")!.v1.id;

const logId = (seq: number) => `log-${seq}`;

const LOGS: (TimelineLogLike & DailyLogLike & { user_id: string })[] = PLAN.logs.map((log) => ({
  id: logId(log.seq),
  user_id: log.user_id,
  log_date: log.log_date,
  submitted_at: log.submitted_at,
  form_version_id: log.form_version_id,
  answers: log.answers as Json,
}));

const ALERTS: (TimelineAlertLike & { user_id: string })[] = PLAN.alerts.map((alert, index) => ({
  id: `alert-${index + 1}`,
  submission_id: logId(alert.log_seq),
  user_id: PLAN.logs.find((l) => l.seq === alert.log_seq)!.user_id,
  rule_key: alert.rule_key,
  detail: alert.detail as Json,
  status: alert.status,
  created_at: alert.created_at,
  responded_at: alert.responded_at,
}));

const RESPONSES: TimelineResponseLike[] = PLAN.responses.map((response) => ({
  id: `resp-${response.seq}`,
  user_id: response.user_id,
  target_submission_id: logId(response.target_log_seq),
  submitted_at: response.submitted_at,
  form_version_id: response.form_version_id,
  answers: response.answers as Json,
}));

const RESPONDERS: ReadonlyMap<string, ResponderLike> = new Map(
  [...FIXTURE_MANAGERS, ...BASE_PROFILES].map((p) => [
    p.id,
    { id: p.id, display_name: p.display_name, role: p.role } satisfies ResponderLike,
  ]),
);

const logsOf = (userId: string) => LOGS.filter((l) => l.user_id === userId);
const alertsOf = (userId: string) => ALERTS.filter((a) => a.user_id === userId);

function card(username: string, now: Date, opts: { logs?: DailyLogLike[]; versions?: ReadonlyMap<string, readonly Question[]> } = {}) {
  const person = newcomer(username);
  return buildNewcomerCard({
    newcomer: person,
    logs: opts.logs ?? logsOf(person.id),
    versions: opts.versions ?? VERSIONS,
    alerts: alertsOf(person.id),
    today: TODAY_0904,
    now,
    settings: DASHBOARD_SETTINGS,
  });
}

function timeline(username: string, now: Date, responses: TimelineResponseLike[] = RESPONSES) {
  const person = newcomer(username);
  return buildTimeline({
    logs: logsOf(person.id),
    versions: VERSIONS,
    alerts: alertsOf(person.id),
    responses,
    responders: RESPONDERS,
    now,
    thresholdHours: DASHBOARD_SETTINGS.thresholdHours,
  });
}

/** Rendered text without tags. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, "");

// ---------------------------------------------------------------------------
// settings / scope / access (§10 row 3)
// ---------------------------------------------------------------------------

describe("parseDashboardSettings", () => {
  it("reads the seed values and rejects malformed jsonb", () => {
    expect(DASHBOARD_SETTINGS).toEqual({ cutoff: "18:00", thresholdHours: 24 });
    expect(() => parseDashboardSettings({ daily_cutoff_time: "6pm", response_threshold_hours: 24 })).toThrow(
      "daily_cutoff_time",
    );
    expect(() => parseDashboardSettings({ daily_cutoff_time: "18:00", response_threshold_hours: "24" })).toThrow(
      "response_threshold_hours",
    );
    expect(() => parseDashboardSettings({ daily_cutoff_time: null, response_threshold_hours: null })).toThrow();
  });
});

describe("newcomerScope + canAccessNewcomer (工務主任只見 Darren)", () => {
  const construction = manager("mgr_construction");
  const procurement = manager("mgr_procurement");
  const xinyi = manager("mgr_xinyi");

  it("a manager is scoped to their department; hr / admin see all; no department → nobody", () => {
    expect(newcomerScope(construction)).toEqual({ kind: "department", departmentId: departmentId("工務") });
    expect(newcomerScope(HR)).toEqual({ kind: "all" });
    expect(newcomerScope({ role: "admin", department_id: null })).toEqual({ kind: "all" });
    expect(newcomerScope({ role: "ceo", department_id: null })).toEqual({ kind: "all" });
    expect(newcomerScope({ role: "manager", department_id: null })).toEqual({ kind: "none" });
    expect(newcomerScope({ role: "newcomer", department_id: departmentId("工務") })).toEqual({ kind: "none" });
  });

  it("工務主任 lists exactly Darren; hr lists all four", () => {
    const all = FIXTURE_NEWCOMERS.map((n) => profile(n));
    const visible = (actor: Actor) => all.filter((n) => canAccessNewcomer(actor, n)).map((n) => n.display_name);
    expect(visible(construction)).toEqual(["Darren"]);
    expect(visible(procurement)).toEqual(["嚴雅齡"]);
    expect(visible(xinyi)).toEqual(["洪湘庭"]);
    expect(visible(HR)).toEqual(["Darren", "嚴雅齡", "謝文心", "洪湘庭"]);
  });

  it("工務主任 opening 嚴雅齡 is denied (the page's 403); 採購主管 and hr are allowed", () => {
    const yen = newcomer("yen_yaling");
    expect(canAccessNewcomer(construction, yen)).toBe(false);
    expect(canAccessNewcomer(procurement, yen)).toBe(true);
    expect(canAccessNewcomer(HR, yen)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// newcomer card
// ---------------------------------------------------------------------------

describe("latestLogBefore / planItemsOf", () => {
  it("picks the latest log strictly before the date and ignores null log_date", () => {
    const darren = logsOf(newcomer("darren").id);
    expect(latestLogBefore(darren, "2026-09-04")?.log_date).toBe("2026-09-03");
    expect(latestLogBefore(darren, "2026-09-03")?.log_date).toBe("2026-09-02");
    expect(latestLogBefore(darren, "2026-09-02")).toBeNull();
    expect(latestLogBefore([{ log_date: null }, ...darren], "2026-09-10")?.log_date).toBe("2026-09-03");
  });

  it("marks the 最重要 item by option index of the version's plan.top_priority", () => {
    const yen0902 = LOGS.find((l) => l.user_id === newcomer("yen_yaling").id && l.log_date === "2026-09-02")!;
    const items = planItemsOf(readYesterdayPlan(yen0902.answers as Record<string, unknown>, VERSIONS.get(DAILY_V1)), VERSIONS.get(DAILY_V1));
    expect(items.map((i) => [i.no, i.text, i.expect, i.top])).toEqual([
      [1, "請款總表移到新表單", "完成", false],
      [2, "裕福門窗報價", "完成", true],
      [3, "鋁門窗宏偉報價", "完成", false],
    ]);
  });
});

describe("buildNewcomerCard (§11 fixture, fake clocks on 9/4)", () => {
  it("Darren at 9/4 12:00: today's plan from the 9/3 log, 未到時, no open alerts", () => {
    const c = card("darren", CLOCK_0904_1200);
    expect(c.displayName).toBe("Darren");
    expect(c.day).toBe(4);
    expect(c.todayStatus).toBe("pending");
    expect(c.openAlerts).toBe(0);
    expect(c.overdueAlerts).toBe(0);
    expect(c.plan?.sourceDate).toBe("2026-09-03");
    expect(c.plan?.versionMissing).toBe(false);
    expect(c.plan?.items.map((i) => [i.no, i.text, i.expect, i.top])).toEqual([
      [1, "文風19 木工維修敲定", "完成", true],
      [2, "跟主任跑案場", "跨日", false],
    ]);
  });

  it("R3: everybody 缺交 at 9/4 18:30, 未到時 at 12:00; a log dated today → 已交", () => {
    for (const n of FIXTURE_NEWCOMERS) {
      expect(card(n.username, CLOCK_0904_1830).todayStatus).toBe("missing");
      expect(card(n.username, CLOCK_0904_1200).todayStatus).toBe("pending");
    }
    const darren = newcomer("darren");
    const withToday: DailyLogLike[] = [
      ...logsOf(darren.id),
      { id: "log-today", log_date: TODAY_0904, form_version_id: DAILY_V1, answers: {} },
    ];
    const c = card("darren", CLOCK_0904_1830, { logs: withToday });
    expect(c.todayStatus).toBe("submitted");
    // today's plan still comes from the log BEFORE today (§8 「來自昨日日誌」)
    expect(c.plan?.sourceDate).toBe("2026-09-03");
  });

  it("A1: 洪湘庭's R2 counts as open at 12:00 and as open + overdue at 18:00; 嚴雅齡's responded R1 is not open", () => {
    const noon = card("hung_hsiangting", CLOCK_0904_1200);
    expect([noon.openAlerts, noon.overdueAlerts]).toEqual([1, 0]);
    const evening = card("hung_hsiangting", CLOCK_0904_1800);
    expect([evening.openAlerts, evening.overdueAlerts]).toEqual([1, 1]);
    const yen = card("yen_yaling", CLOCK_0904_1800);
    expect([yen.openAlerts, yen.overdueAlerts]).toEqual([0, 0]);
  });

  it("no log before today → plan null; unknown version → versionMissing", () => {
    expect(card("darren", CLOCK_0904_1200, { logs: [] }).plan).toBeNull();
    const c = card("darren", CLOCK_0904_1200, { versions: new Map() });
    expect(c.plan).toEqual({ sourceDate: "2026-09-03", items: [], versionMissing: true });
  });

  it("renders name (linked), day, status badges and the plan", () => {
    const c = card("hung_hsiangting", CLOCK_0904_1800);
    const html = renderToStaticMarkup(<NewcomerCard card={c} href={`/manager/newcomer/${c.id}`} />);
    expect(html).toContain(`href="/manager/newcomer/${c.id}"`);
    expect(html).toContain("洪湘庭");
    expect(html).toContain("第 4 天");
    expect(html).toContain(`今日 ${LOG_STATUS_LABELS.missing}`);
    expect(html).toContain("待回應預警 1");
    expect(html).toContain("逾時 1");
    expect(html).toContain("宗硯20期渲染圖 Luma 改圖");
    expect(html).toContain("來自 9/3 日誌");

    const noLink = renderToStaticMarkup(<NewcomerCard card={card("darren", CLOCK_0904_1200, { logs: [] })} />);
    expect(noLink).not.toContain("href=");
    expect(noLink).toContain(NO_PLAN_LABEL);
    expect(renderToStaticMarkup(<NewcomerCard card={card("darren", CLOCK_0904_1200, { versions: new Map() })} />)).toContain(
      PLAN_VERSION_MISSING_LABEL,
    );
  });
});

// ---------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------

describe("buildTimeline: 採購主管 opens 嚴雅齡 (9/4 18:00)", () => {
  const days = timeline("yen_yaling", CLOCK_0904_1800);

  it("one row per log, newest first, labelled with the log's own version", () => {
    expect(days.map((d) => d.date)).toEqual(["2026-09-03", "2026-09-02"]);
    expect(days[0].dateLabel).toBe("9/3");
    expect(days[0].submittedAtLabel).toBe("17:03");
    expect(days[0].versionMissing).toBe(false);
    expect(days[0].items[0].statusLabel).toBe("昨日項目一狀態");
    expect(days[0].items[0].reasonLabel).toBe("項目一未完成原因");
    expect(days[0].blocker.label).toBe("今日卡點");
  });

  it("9/3: yesterday's three items next to the settlement (plan from the 9/2 log by slot)", () => {
    const day = days[0];
    expect(day.previousDate).toBe("2026-09-02");
    expect(day.previousVersionMissing).toBe(false);
    expect(day.items.map((i) => [i.no, i.planText, i.planExpect, i.status, i.reason])).toEqual([
      [1, "請款總表移到新表單", "完成", "持續中", "案件利潤表工項明細不確定，已問 Patty"],
      [2, "裕福門窗報價", "完成", "完成", null],
      [3, "鋁門窗宏偉報價", "完成", "持續中", "宏偉訂金確認中"],
    ]);
    expect(day.blocker).toEqual({ label: "今日卡點", status: "有，已找人處理中", detail: null });
    expect(day.tomorrow.items.map((i) => [i.no, i.text, i.expect, i.top])).toEqual([
      [1, "案件利潤表持續更新", "跨日", false],
      [2, "了解各報價單", "跨日", false],
      [3, "宏偉訂金確認", "完成", true],
    ]);
    expect(day.tomorrow.supportNeed).toBe("不需要");
  });

  it("9/3: exactly one R1 (進度) with items 1 and 3, responded (16.1h < 24h → not late)", () => {
    const day = days[0];
    expect(day.alerts).toHaveLength(1);
    const [r1] = day.alerts;
    expect(r1.ruleKey).toBe("R1");
    expect(r1.kindLabel).toBe("進度");
    expect(r1.state).toBe("responded");
    expect(r1.lines).toEqual([
      "項目一：請款總表移到新表單｜持續中（案件利潤表工項明細不確定，已問 Patty）",
      "項目三：鋁門窗宏偉報價｜持續中（宏偉訂金確認中）",
    ]);
  });

  it("9/3: the 9/4 09:10 「已處理」 response by 採購主管, read through the response slots, not on behalf", () => {
    expect(days[0].responses).toEqual([
      {
        id: "resp-9",
        responderName: "採購主管",
        onBehalf: false,
        submittedAtLabel: "9/4 09:10",
        status: "已處理",
        comment: "已請 Patty 給工項對照表；宏偉訂金明早追",
      },
    ]);
  });

  it("two responses on one log are ordered by instant, not by the ISO string (D-42)", () => {
    // The same day written two ways: 09:10+08:00 is 01:10Z (earlier) and
    // 09:00Z is 17:00+08:00 (later). Sorted as plain strings 「09:00Z」 would
    // come first, so this case fails the moment `compareInstant` is replaced
    // by a lexicographic compare.
    const target = logId(PLAN.logs.find((l) => l.username === "yen_yaling" && l.log_date === "2026-09-03")!.seq);
    const base = RESPONSES.find((r) => r.target_submission_id === target)!;
    const days = timeline("yen_yaling", CLOCK_0904_1800, [
      { ...base, id: "resp-late", submitted_at: "2026-09-04T09:00:00Z" },
      { ...base, id: "resp-early", submitted_at: "2026-09-04T09:10:00+08:00" },
    ]);
    expect(days[0].responses.map((r) => [r.id, r.submittedAtLabel])).toEqual([
      ["resp-early", "9/4 09:10"],
      ["resp-late", "9/4 17:00"],
    ]);
  });

  it("9/2 (first log): no previous plan, no alerts, no responses", () => {
    const day = days[1];
    expect(day.previousDate).toBeNull();
    expect(day.items.every((i) => i.planText === null && i.planExpect === null)).toBe(true);
    expect(day.items.map((i) => i.status)).toEqual(["昨日無此項", "昨日無此項", "昨日無此項"]);
    expect(day.alerts).toEqual([]);
    expect(day.responses).toEqual([]);
  });
});

describe("buildTimeline: 信義總監 opens 洪湘庭", () => {
  it("9/3: one R2 (卡點) 待回應 at 9/4 12:00, 逾時 at 18:00, blocker text shown", () => {
    const noon = timeline("hung_hsiangting", CLOCK_0904_1200)[0];
    expect(noon.date).toBe("2026-09-03");
    expect(noon.alerts).toHaveLength(1);
    expect(noon.alerts[0].ruleKey).toBe("R2");
    expect(noon.alerts[0].kindLabel).toBe("卡點");
    expect(noon.alerts[0].state).toBe("open");
    expect(alertStateLabel(noon.alerts[0].state)).toBe("待回應");
    expect(noon.alerts[0].lines).toEqual(["Luma 免費版有次數限制，只做了 3 張圖"]);
    expect(noon.blocker).toEqual({
      label: "今日卡點",
      status: "有，尚未回報",
      detail: "Luma 免費版有次數限制，只做了 3 張圖",
    });
    expect(noon.extras).toEqual([{ label: "今日學到一件事", value: "使用 Luma 聊天功能輔助修圖" }]);
    expect(noon.responses).toEqual([]);

    const evening = timeline("hung_hsiangting", CLOCK_0904_1800)[0];
    expect(evening.alerts[0].state).toBe("overdue");
  });

  it("Darren 9/3 and 謝文心 9/3 carry no alert; Darren's 已讀，無需處理 response is still listed", () => {
    const darren = timeline("darren", CLOCK_0904_1800);
    expect(darren[0].alerts).toEqual([]);
    expect(darren[0].responses.map((r) => [r.responderName, r.status, r.comment])).toEqual([
      ["工務主任", "已讀，無需處理", null],
    ]);
    expect(darren[0].extras).toEqual([
      { label: "臨時新增工作", value: "文風19 安排木工維修隱藏門" },
      { label: "今日學到一件事", value: "知道哪裡看施工進度" },
    ]);
    expect(timeline("hsieh_wenhsin", CLOCK_0904_1800)[0].alerts).toEqual([]);
  });

  it("a response by hr / admin is tagged HR 代填; an unknown version yields versionMissing", () => {
    const hrResponse: TimelineResponseLike = {
      id: "resp-hr",
      user_id: HR.id,
      target_submission_id: logId(7),
      submitted_at: "2026-09-04T18:30:00+08:00",
      form_version_id: RESPONSE_V1,
      answers: { status: "需 HR 協助", comment: "HR 已聯絡 Luma 授權" },
    };
    const day = timeline("hung_hsiangting", CLOCK_0904_1800, [hrResponse])[0];
    expect(day.responses).toEqual([
      {
        id: "resp-hr",
        responderName: "HR",
        onBehalf: true,
        submittedAtLabel: "9/4 18:30",
        status: "需 HR 協助",
        comment: "HR 已聯絡 Luma 授權",
      },
    ]);

    const person = newcomer("hung_hsiangting");
    const broken = buildTimeline({
      logs: logsOf(person.id),
      versions: new Map(),
      alerts: alertsOf(person.id),
      responses: [],
      responders: RESPONDERS,
      now: CLOCK_0904_1800,
      thresholdHours: 24,
    });
    expect(broken[0].versionMissing).toBe(true);
    expect(broken[0].previousVersionMissing).toBe(true);
    expect(broken[0].items[0]).toEqual({
      no: 1,
      statusLabel: null,
      planText: null,
      planExpect: null,
      status: null,
      reasonLabel: null,
      reason: null,
    });
  });
});

describe("buildTimeline: closed and late-responded alerts (§7 A1 full path)", () => {
  // Darren's two logs carry no fixture alert, so they are the clean place to
  // hang the two states the §11 rows never reach: a `closed` alert (a
  // resubmitted log whose R1 no longer holds, §7 「不再成立的 open 預警改
  // closed(reason='resubmitted')」) and a `responded` one answered after the
  // 24h threshold (`responded_late`, statistics only).
  const DARREN_0903 = logId(5);
  const DARREN_0902 = logId(1);
  const EXTRA_ALERTS: (TimelineAlertLike & { closed_reason: string | null })[] = [
    {
      id: "alert-closed",
      submission_id: DARREN_0903,
      rule_key: "R1",
      detail: { items: [{ i: 1, plan_text: "文風19 木工維修敲定", status: "持續中", reason: null }] } as Json,
      status: "closed",
      created_at: "2026-09-03T17:01:00+08:00",
      responded_at: null,
      closed_reason: "resubmitted",
    },
    {
      id: "alert-late",
      submission_id: DARREN_0902,
      rule_key: "R2",
      detail: { text: "颱風假無法進場" } as Json,
      status: "responded",
      // 9/2 17:05 → 9/4 09:20 是 40.25h，超過 24h 門檻 → responded_late
      created_at: "2026-09-02T17:05:00+08:00",
      responded_at: "2026-09-04T09:20:00+08:00",
      closed_reason: null,
    },
  ];

  const days = buildTimeline({
    logs: logsOf(newcomer("darren").id),
    versions: VERSIONS,
    alerts: EXTRA_ALERTS,
    responses: [],
    responders: RESPONDERS,
    now: CLOCK_0904_1800,
    thresholdHours: DASHBOARD_SETTINGS.thresholdHours,
  });

  it("derives closed / responded_late and keeps the detail lines", () => {
    expect(days.map((d) => d.date)).toEqual(["2026-09-03", "2026-09-02"]);
    expect(days[0].alerts.map((a) => [a.id, a.ruleKey, a.state])).toEqual([
      ["alert-closed", "R1", "closed"],
    ]);
    expect(days[0].alerts[0].lines).toEqual(["項目一：文風19 木工維修敲定｜持續中"]);
    expect(days[1].alerts.map((a) => [a.id, a.ruleKey, a.state])).toEqual([
      ["alert-late", "R2", "responded_late"],
    ]);
    // Lateness is statistics only (§7 A1): both read 「已回應」 to the manager.
    expect(alertStateLabel("responded_late")).toBe(alertStateLabel("responded"));
  });

  it("renders 已關閉 for the closed alert and 已回應 for the late one", () => {
    const html = renderToStaticMarkup(<Timeline days={days} />);
    expect(html).toContain('data-state="closed"');
    expect(html).toContain('data-state="responded_late"');
    const text = textOf(html);
    expect(text).toContain("進度預警｜已關閉");
    expect(text).toContain("卡點預警｜已回應");
    expect(text).toContain("颱風假無法進場");
    // The response section is driven by the response rows, not by the alert
    // state: no manager_response was handed in, so both days keep the empty
    // state (the alert badge is the only thing that changed).
    expect(text.match(new RegExp(NO_RESPONSE_LABEL, "g"))).toHaveLength(2);
  });
});

describe("alertDetailLines / AlertBadge", () => {
  it("maps R1 → 進度, R2 → 卡點 and the derived states to their labels", () => {
    expect(alertKindLabel("R1")).toBe("進度");
    expect(alertKindLabel("R2")).toBe("卡點");
    expect(alertKindLabel("R9")).toBe("R9");
    expect(alertBadgeText("R2", "open")).toBe("卡點預警｜待回應");
    expect(alertBadgeText("R2", "overdue")).toBe("卡點預警｜逾時");
    expect(alertBadgeText("R1", "responded")).toBe("進度預警｜已回應");
    expect(alertBadgeText("R1", "responded_late")).toBe("進度預警｜已回應");
    expect(alertBadgeText("R1", "closed")).toBe("進度預警｜已關閉");
    const html = renderToStaticMarkup(<AlertBadge ruleKey="R2" state="overdue" />);
    expect(html).toContain('data-rule="R2"');
    expect(html).toContain('data-state="overdue"');
    expect(html).toContain("卡點預警｜逾時");
  });

  it("tolerates malformed detail", () => {
    expect(alertDetailLines("R1", null)).toEqual([]);
    expect(alertDetailLines("R1", { items: "x" })).toEqual([]);
    expect(alertDetailLines("R1", { items: [{ i: 2, plan_text: null, status: "取消", reason: null }] })).toEqual([
      "項目二：（無項目文字）｜取消",
    ]);
    expect(alertDetailLines("R2", { text: "" })).toEqual([]);
    expect(alertDetailLines("R2", "nope")).toEqual([]);
    expect(alertDetailLines("R9", { text: "x" })).toEqual([]);
  });
});

describe("Timeline component", () => {
  it("renders 嚴雅齡's rows: settlement, R1 badge with two items, the 已處理 response", () => {
    const html = renderToStaticMarkup(<Timeline days={timeline("yen_yaling", CLOCK_0904_1800)} />);
    const text = textOf(html);
    expect(html.match(/data-testid="timeline-day"/g)).toHaveLength(2);
    expect(html).toContain('data-date="2026-09-03"');
    expect(text).toContain("9/3 日誌");
    expect(text).toContain("對照 9/2 計畫");
    expect(text).toContain("昨日項目一狀態");
    expect(text).toContain("請款總表移到新表單");
    expect(text).toContain("持續中｜案件利潤表工項明細不確定，已問 Patty");
    expect(text).toContain("進度預警｜已回應");
    expect(text).toContain("項目一：請款總表移到新表單");
    expect(text).toContain("項目三：鋁門窗宏偉報價");
    expect(text).toContain("採購主管");
    expect(text).toContain("9/4 09:10");
    expect(text).toContain("已處理｜已請 Patty 給工項對照表；宏偉訂金明早追");
    expect(text).toContain(NO_PREVIOUS_LOG_LABEL);
    expect(text).not.toContain(ON_BEHALF_LABEL);
    expect(text).not.toContain(NO_RESPONSE_LABEL);
  });

  it("洪湘庭: 卡點預警｜待回應 with 尚未回應; HR 代填 tag on an hr response", () => {
    const text = textOf(renderToStaticMarkup(<Timeline days={timeline("hung_hsiangting", CLOCK_0904_1200)} />));
    expect(text).toContain("卡點預警｜待回應");
    expect(text).toContain("Luma 免費版有次數限制，只做了 3 張圖");
    expect(text).toContain(NO_RESPONSE_LABEL);
    expect(text).toContain("有，尚未回報：Luma 免費版有次數限制，只做了 3 張圖");

    const hrDay = timeline("hung_hsiangting", CLOCK_0904_1800, [
      {
        id: "resp-hr",
        user_id: HR.id,
        target_submission_id: logId(7),
        submitted_at: "2026-09-04T18:30:00+08:00",
        form_version_id: RESPONSE_V1,
        answers: { status: "需 HR 協助", comment: null },
      },
    ]);
    const hrText = textOf(renderToStaticMarkup(<Timeline days={hrDay} />));
    // The alert row itself is unchanged (the write path flips it, not the
    // timeline builder): still `open`, 24h54m old at 18:00 → 逾時.
    expect(hrText).toContain("卡點預警｜逾時");
    expect(hrText).toContain(ON_BEHALF_LABEL);
    expect(hrText).toContain("需 HR 協助");
  });

  it("action slot: rendered per day unless readOnly; empty state", () => {
    const days = timeline("darren", CLOCK_0904_1800);
    const action = (day: { logId: string }) => <button type="button">回應 {day.logId}</button>;
    const withAction = renderToStaticMarkup(<Timeline days={days} renderAction={action} />);
    expect(withAction).toContain("回應 log-5");
    expect(withAction).toContain("回應 log-1");
    const readOnly = renderToStaticMarkup(<Timeline days={days} readOnly renderAction={action} />);
    expect(readOnly).not.toContain("回應 log-");
    expect(renderToStaticMarkup(<Timeline days={[]} />)).toContain(NO_LOGS_LABEL);
  });
});
