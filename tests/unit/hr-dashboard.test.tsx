import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AlertList,
  defaultNewcomerHref,
  NO_PENDING_ALERTS_LABEL,
  openHoursLabel,
  PENDING_ALERT_NEWCOMER_PATH,
} from "@/components/dashboard/AlertList";
import {
  clipboardWriter,
  COPIED_LABEL,
  COPY_LABEL,
  CopySummaryButton,
  FALLBACK_MESSAGE,
} from "@/components/dashboard/CopySummaryButton";
import {
  DEPARTMENT_COLUMNS,
  DepartmentStats,
  NO_DEPARTMENTS_LABEL,
  parseWorkweekSetting,
} from "@/components/dashboard/DepartmentStats";
import {
  InterventionList,
  NEED_HR_TITLE,
  NO_NEED_HR_LABEL,
  NO_OVERDUE_LABEL,
  OVERDUE_TITLE,
} from "@/components/dashboard/InterventionList";
import {
  METRIC_LABELS,
  MetricsTiles,
  NO_ALERTS_LABEL,
  NO_RATE_LABEL,
} from "@/components/dashboard/MetricsTiles";
import {
  MilestoneDue,
  NO_MILESTONE_DUE_LABEL,
} from "@/components/dashboard/MilestoneDue";
import {
  HR_NEWCOMER_PATH,
  NewcomerOverview,
  NO_NEWCOMERS_LABEL,
} from "@/components/dashboard/NewcomerOverview";
import {
  NO_MISSING_LABEL,
  PENDING_LIST_TITLE,
  TODAY_COUNTER_LABELS,
  TodaySubmissions,
} from "@/components/dashboard/TodaySubmissions";
import {
  buildHrDashboard,
  type DashboardAlert,
  type DashboardLog,
  type DashboardMilestone,
  type DashboardNewcomer,
  type DashboardResponse,
  type HrDashboardData,
} from "@/lib/metrics/dashboard";
import { departmentStats7d } from "@/lib/metrics/department";
import { newcomerOverview } from "@/lib/metrics/newcomer";
import { alertRates, type MetricProfile } from "@/lib/metrics/rates";
import { buildDailySummary, summaryLink } from "@/lib/metrics/summary";
import { RESPONSE_STATUS_NEED_HR } from "@/lib/rules/constants";
import { toInstant, type Instant, type Workweek } from "@/lib/time";
import { milestonesFor } from "@/lib/time/milestones";
import {
  CLOCK_0903_1800,
  CLOCK_0904_1200,
  CLOCK_0904_1800,
  DEPARTMENTS,
  EXPECTED_ESCALATION,
  EXPECTED_METRICS_0904_1800,
  EXPECTED_MISSING_0904,
  EXPECTED_SUMMARY_0903_1800,
  FIXTURE_NEWCOMERS,
  SETTINGS,
} from "@seed/fixtures";
import { buildSeedPlan } from "@seed/plan";

/**
 * /hr dashboard blocks (PLAN T20 + T24): every section component and the copy
 * button rendered through react-dom/server with the output of
 * `buildHrDashboard` / `alertRates` / `departmentStats7d` / `newcomerOverview`
 * on the §11 seed plan at the PLAN 4.9.5 fake clocks. The database snapshot
 * helper (`dataAsOf`) mirrors tests/unit/dashboard.test.ts.
 *
 * Acceptance (T20): at 9/4 18:00 the 缺交名單 lists all four newcomers, the
 * 待處理預警 block names 洪湘庭 (R2, 逾時) and links to her timeline, and
 * the HR 介入清單 lists 洪湘庭 under 逾時未回.
 * Acceptance (T24): at 9/4 18:00 the three tiles read 0% / 50% / 50%, 新人總覽
 * lists the four newcomers (嚴雅齡 100%, 洪湘庭 0%), 近 7 日各部門統計 has the
 * four departments, and 節點到期 is empty until 9/24, where the four D30 land.
 */

const BASE_URL = "http://localhost:3000";
const PLAN = buildSeedPlan();

type Newcomer = DashboardNewcomer & { username: string };
type Log = DashboardLog & { id: string };
/** `response_submission_id` links a responded alert to its response row (誤報率). */
type Alert = DashboardAlert & {
  detail: Record<string, unknown>;
  response_submission_id: string | null;
};
type Response = DashboardResponse & { id: string; response_comment: string | null };
type Data = HrDashboardData<Newcomer, Log, Alert, Response, DashboardMilestone>;

const SETTINGS_ROWS = {
  daily_cutoff_time: SETTINGS.daily_cutoff_time,
  response_threshold_hours: SETTINGS.response_threshold_hours,
};

const ms = (instant: Instant) => toInstant(instant).getTime();
const submissionId = (logSeq: number) => `seq-${logSeq}`;
const responseId = (seq: number) => `response-${seq}`;

const ALL_MILESTONES: DashboardMilestone[] = FIXTURE_NEWCOMERS.flatMap((n) =>
  milestonesFor(n.start_date).map((due) => ({
    id: `${n.username}-${due.kind}`,
    user_id: n.id,
    kind: due.kind,
    due_date: due.due_date,
    done_at: null,
  })),
);

/** The seed rows as the database would hold them at `now`. */
function dataAsOf(now: Instant, overrides: Partial<Data> = {}): Data {
  const nowMs = ms(now);
  const logs: Log[] = PLAN.logs
    .filter((log) => ms(log.submitted_at) <= nowMs)
    .map((log) => ({ id: submissionId(log.seq), user_id: log.user_id, log_date: log.log_date }));
  const alerts: Alert[] = PLAN.alerts
    .filter((alert) => ms(alert.created_at) <= nowMs)
    .map((alert) => {
      const log = PLAN.logs.find((l) => l.seq === alert.log_seq)!;
      const responded = alert.responded_at !== null && ms(alert.responded_at) <= nowMs;
      return {
        id: `alert-${alert.log_seq}-${alert.rule_key}`,
        submission_id: submissionId(alert.log_seq),
        user_id: log.user_id,
        rule_key: alert.rule_key,
        status: responded ? "responded" : "open",
        created_at: alert.created_at,
        responded_at: responded ? alert.responded_at : null,
        response_submission_id:
          responded && alert.response_seq !== null ? responseId(alert.response_seq) : null,
        detail: alert.detail,
        submission: { id: submissionId(alert.log_seq), user_id: log.user_id, log_date: log.log_date },
      };
    });
  const responses: Response[] = PLAN.responses
    .filter((r) => ms(r.submitted_at) <= nowMs)
    .map((r) => ({
      id: responseId(r.seq),
      user_id: r.user_id,
      target_user_id: r.target_user_id,
      target_submission_id: submissionId(r.target_log_seq),
      submitted_at: r.submitted_at,
      response_status: (r.answers.status as string | null) ?? null,
      response_comment: (r.answers.comment as string | null) ?? null,
    }));
  return {
    newcomers: FIXTURE_NEWCOMERS,
    logs,
    alerts,
    responses,
    milestones: ALL_MILESTONES,
    settings: SETTINGS_ROWS,
    ...overrides,
  };
}

const dashboardAt = (now: Instant, overrides: Partial<Data> = {}) =>
  buildHrDashboard({ now, data: dataAsOf(now, overrides) });

const byUsername = (username: string): Newcomer => {
  const found = FIXTURE_NEWCOMERS.find((p) => p.username === username);
  if (!found) throw new Error(`unknown newcomer ${username}`);
  return found;
};

const HUNG = byUsername("hung_hsiangting");
const YEN = byUsername("yen_yaling");

/** Text between tags, for name / label assertions. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ");

/** `[label, value]` of every 今日交件 counter, in render order. */
const countersOf = (html: string): string[][] =>
  [...html.matchAll(/data-counter="([^"]+)"[^>]*>[\s\S]*?<span[^>]*>(\d+)<\/span>/g)].map((m) => [
    m[1],
    m[2],
  ]);

/** One `<tr …>` of a table, picked by one of its data attributes. */
const rowOf = (html: string, attribute: string, value: string): string => {
  const match = html.match(new RegExp(`<tr[^>]*${attribute}="${value}"[\\s\\S]*?</tr>`));
  if (!match) throw new Error(`no row with ${attribute}="${value}"`);
  return match[0];
};

/** Cell texts of one table row, in column order. */
const cellsOf = (row: string): string[] =>
  [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
    textOf(m[1]).replace(/\s+/g, " ").trim(),
  );

/** The percentage shown on one 三指標 tile. */
const tileValueOf = (html: string, label: string): string => {
  const match = html.match(
    new RegExp(`data-metric="${label}"[\\s\\S]*?data-testid="metric-value"[^>]*>([^<]*)<`),
  );
  if (!match) throw new Error(`no tile for ${label}`);
  return match[1];
};

const departmentIdOf = (name: string): string => {
  const found = DEPARTMENTS.find((d) => d.name === name);
  if (!found) throw new Error(`unknown department ${name}`);
  return found.id;
};

/** The fixture newcomers as `profiles` rows (department name → id), for lib/metrics. */
type OverviewNewcomer = Newcomer & { department_id: string | null };
const NEWCOMERS_WITH_DEPARTMENT: OverviewNewcomer[] = FIXTURE_NEWCOMERS.map((n) => ({
  ...n,
  department_id: departmentIdOf(n.department),
}));

/**
 * `listAlertsWithSubmission()` inner-joins on `deleted_at is null` (A05 (1)),
 * so its rows always belong to a live log; lib/metrics reads that flag as a
 * second gate, and the page spells it out the same way.
 */
type MetricAlertRow = Alert & { submission: { deleted_at: string | null } };
const metricAlertsOf = (alerts: readonly Alert[]): MetricAlertRow[] =>
  alerts.map((alert) => ({
    ...alert,
    submission: { ...alert.submission, deleted_at: null as string | null },
  }));

const METRIC_SETTINGS = {
  daily_cutoff_time: SETTINGS.daily_cutoff_time,
  workweek: SETTINGS.workweek as Workweek,
};

/** 三指標 at `now` (A08); `profiles` drops `sample` accounts (A02). */
const ratesAt = (
  now: Instant,
  opts: { alerts?: readonly MetricAlertRow[]; profiles?: readonly MetricProfile[] } = {},
) => {
  const data = dataAsOf(now);
  return alertRates({
    alerts: opts.alerts ?? metricAlertsOf(data.alerts),
    responses: data.responses,
    profiles: opts.profiles,
    thresholdHours: SETTINGS.response_threshold_hours,
    now,
  });
};

const statsAt = (now: Instant, departments: readonly (typeof DEPARTMENTS)[number][] = DEPARTMENTS) => {
  const data = dataAsOf(now);
  return departmentStats7d({
    departments,
    newcomers: NEWCOMERS_WITH_DEPARTMENT,
    logs: data.logs,
    alerts: metricAlertsOf(data.alerts),
    settings: METRIC_SETTINGS,
    now,
  });
};

const overviewAt = (now: Instant, newcomers: readonly OverviewNewcomer[] = NEWCOMERS_WITH_DEPARTMENT) => {
  const data = dataAsOf(now);
  return newcomerOverview({
    newcomers,
    logs: data.logs,
    alerts: metricAlertsOf(data.alerts),
    milestones: ALL_MILESTONES,
    settings: METRIC_SETTINGS,
    now,
  });
};

// ---------------------------------------------------------------------------
// 今日交件
// ---------------------------------------------------------------------------

describe("TodaySubmissions (今日交件)", () => {
  it("9/4 18:00: counters 4/0/4/0 and the 缺交名單 lists all four newcomers", () => {
    const { today } = dashboardAt(CLOCK_0904_1800);
    const html = renderToStaticMarkup(<TodaySubmissions today={today} />);
    expect(html).toContain('data-testid="today-submissions"');
    expect(html).toContain("2026/09/04");
    const counters = [...html.matchAll(/data-counter="([^"]+)"[^>]*>[\s\S]*?<span[^>]*>(\d+)<\/span>/g)].map(
      (m) => [m[1], m[2]],
    );
    expect(counters).toEqual([
      ["應交", "4"],
      ["已交", "0"],
      ["缺交", "4"],
      ["未到時", "0"],
    ]);
    const missing = html.match(/data-testid="missing-list"[\s\S]*?<\/ul>/)![0];
    for (const username of EXPECTED_MISSING_0904.at_1830) {
      expect(textOf(missing)).toContain(byUsername(username).display_name);
    }
    expect(missing.match(/data-user-id=/g)).toHaveLength(4);
    expect(html).not.toContain(PENDING_LIST_TITLE);
  });

  it("9/4 12:00: nobody missing, 未到時名單 lists all four", () => {
    const { today } = dashboardAt(CLOCK_0904_1200);
    const html = renderToStaticMarkup(<TodaySubmissions today={today} />);
    expect(html).toContain(NO_MISSING_LABEL);
    expect(html).not.toContain('data-testid="missing-list"');
    const pending = html.match(/data-testid="pending-list"[\s\S]*?<\/ul>/)![0];
    expect(pending.match(/data-user-id=/g)).toHaveLength(4);
    expect(textOf(pending)).toContain("洪湘庭");
  });

  it("9/3 18:00: counters 4/4/0/0, no missing and no 未到時 list", () => {
    const { today } = dashboardAt(CLOCK_0903_1800);
    const html = renderToStaticMarkup(<TodaySubmissions today={today} />);
    expect(countersOf(html)).toEqual([
      [TODAY_COUNTER_LABELS.expected, "4"],
      [TODAY_COUNTER_LABELS.submitted, "4"],
      [TODAY_COUNTER_LABELS.missing, "0"],
      [TODAY_COUNTER_LABELS.pending, "0"],
    ]);
    expect(html).toContain(NO_MISSING_LABEL);
    expect(html).not.toContain('data-testid="pending-list"');
  });

  it("does not use a <table> (375px: nothing to scroll horizontally)", () => {
    const html = renderToStaticMarkup(<TodaySubmissions today={dashboardAt(CLOCK_0904_1800).today} />);
    expect(html).not.toContain("<table");
  });
});

// ---------------------------------------------------------------------------
// 待處理預警
// ---------------------------------------------------------------------------

describe("AlertList (待處理預警)", () => {
  it("9/4 18:00: exactly 洪湘庭's R2, marked 逾時, linked to her timeline", () => {
    const { pendingAlerts } = dashboardAt(CLOCK_0904_1800);
    const html = renderToStaticMarkup(<AlertList entries={pendingAlerts} />);
    expect(html.match(/data-testid="pending-alert"/g)).toHaveLength(1);
    expect(html).toContain(`data-user-id="${HUNG.id}"`);
    expect(html).toContain('data-state="overdue"');
    expect(textOf(html)).toContain("洪湘庭");
    expect(textOf(html)).toContain("卡點預警");
    expect(textOf(html)).toContain("逾時");
    expect(html).toContain(`href="${PENDING_ALERT_NEWCOMER_PATH}/${HUNG.id}"`);
    expect(html).toContain("9/3 日誌");
    expect(html).toContain(openHoursLabel(pendingAlerts[0].openHours));
    // R2 detail text (§11: Luma 免費版有次數限制) is shown
    expect(textOf(html)).toContain("Luma");
    // 嚴雅齡's R1 was responded at 9/4 09:10 and is not pending any more
    expect(html).not.toContain(`data-user-id="${YEN.id}"`);
  });

  it("9/3 18:00: both alerts pending (嚴雅齡 R1 first, then 洪湘庭 R2), 待回應", () => {
    const { pendingAlerts } = dashboardAt(CLOCK_0903_1800);
    const html = renderToStaticMarkup(<AlertList entries={pendingAlerts} />);
    expect(html.match(/data-testid="pending-alert"/g)).toHaveLength(2);
    expect(html.indexOf(YEN.id)).toBeLessThan(html.indexOf(HUNG.id));
    expect(html).not.toContain('data-state="overdue"');
    expect(textOf(html)).toContain("進度預警");
    expect(textOf(html)).toContain("待回應");
    expect(textOf(html)).toContain("項目一");
  });

  it("empty list shows the empty label", () => {
    const html = renderToStaticMarkup(<AlertList entries={[]} />);
    expect(html).toContain(NO_PENDING_ALERTS_LABEL);
    expect(html).not.toContain('data-testid="pending-alert"');
  });

  it("hrefFor overrides the link (T25: /hr/newcomer/[id])", () => {
    const { pendingAlerts } = dashboardAt(CLOCK_0904_1800);
    const html = renderToStaticMarkup(
      <AlertList entries={pendingAlerts} hrefFor={(id) => `/hr/newcomer/${id}`} />,
    );
    expect(html).toContain(`href="/hr/newcomer/${HUNG.id}"`);
    expect(defaultNewcomerHref("x")).toBe("/manager/newcomer/x");
  });

  it("openHoursLabel floors to whole hours and never goes negative", () => {
    expect(openHoursLabel(24.9)).toBe("已 24 小時未回");
    expect(openHoursLabel(0.5)).toBe("已 0 小時未回");
    expect(openHoursLabel(-1)).toBe("已 0 小時未回");
  });
});

// ---------------------------------------------------------------------------
// HR 介入清單
// ---------------------------------------------------------------------------

describe("InterventionList (HR 介入清單)", () => {
  it("9/4 18:00: 洪湘庭 under 逾時未回 (EXPECTED_ESCALATION), 需 HR 協助 empty", () => {
    const { intervention } = dashboardAt(CLOCK_0904_1800);
    expect(intervention.overdue.map((e) => e.newcomer.username)).toEqual([
      ...EXPECTED_ESCALATION.at_1800.hr_intervention,
    ]);
    const html = renderToStaticMarkup(<InterventionList intervention={intervention} />);
    expect(html.match(/data-testid="overdue-entry"/g)).toHaveLength(1);
    expect(html).toContain(`data-user-id="${HUNG.id}"`);
    expect(textOf(html)).toContain("洪湘庭");
    expect(textOf(html)).toContain("卡點預警");
    expect(html).toContain(`href="${PENDING_ALERT_NEWCOMER_PATH}/${HUNG.id}"`);
    expect(html).toContain(`${OVERDUE_TITLE}（1）`);
    expect(html).toContain(`${NEED_HR_TITLE}（0）`);
    expect(html).toContain(NO_NEED_HR_LABEL);
  });

  it("9/4 12:00: nothing overdue yet, both segments empty", () => {
    const { intervention } = dashboardAt(CLOCK_0904_1200);
    expect(intervention.overdue).toEqual([]);
    const html = renderToStaticMarkup(<InterventionList intervention={intervention} />);
    expect(html).toContain(NO_OVERDUE_LABEL);
    expect(html).toContain(NO_NEED_HR_LABEL);
    expect(html).not.toContain('data-testid="overdue-entry"');
  });

  it("a 需 HR 協助 response within 7 days is listed with the manager's comment", () => {
    const base = dataAsOf(CLOCK_0904_1800);
    const needHr: Response = {
      ...base.responses[0],
      id: "response-need-hr",
      response_status: RESPONSE_STATUS_NEED_HR,
      response_comment: "請 HR 協助安排採購訓練",
    };
    const { intervention } = dashboardAt(CLOCK_0904_1800, { responses: [needHr] });
    expect(intervention.needHr).toHaveLength(1);
    const html = renderToStaticMarkup(<InterventionList intervention={intervention} />);
    expect(html.match(/data-testid="need-hr-entry"/g)).toHaveLength(1);
    expect(html).toContain('data-response-id="response-need-hr"');
    expect(textOf(html)).toContain(YEN.display_name);
    expect(textOf(html)).toContain("請 HR 協助安排採購訓練");
    expect(html).toContain("2026/09/04 09:10");
    expect(html).toContain(`${NEED_HR_TITLE}（1）`);
  });
});

// ---------------------------------------------------------------------------
// 複製一行摘要
// ---------------------------------------------------------------------------

describe("CopySummaryButton", () => {
  it("initial render: the summary in a read-only box plus a primary copy button", () => {
    const { summary } = dashboardAt(CLOCK_0903_1800);
    const text = buildDailySummary({ ...summary, baseUrl: BASE_URL });
    expect(text).toBe(
      `${EXPECTED_SUMMARY_0903_1800.date_label} 新人日誌｜${EXPECTED_SUMMARY_0903_1800.submitted}/${EXPECTED_SUMMARY_0903_1800.expected} 已交｜預警 ${EXPECTED_SUMMARY_0903_1800.alerts} 筆：${EXPECTED_SUMMARY_0903_1800.alert_lines.join("、")}｜待主管回應：${EXPECTED_SUMMARY_0903_1800.awaiting_response}｜${BASE_URL}/`,
    );
    const html = renderToStaticMarkup(<CopySummaryButton text={text} />);
    expect(html).toContain('data-testid="copy-summary"');
    expect(html).toContain('data-state="idle"');
    expect(html).toMatch(/<textarea[^>]*readonly/i);
    expect(html).toContain("4/4 已交");
    expect(html).toContain("嚴雅齡（進度）、洪湘庭（卡點）");
    expect(html).toMatch(/<button[^>]*data-primary/);
    expect(html).toContain(COPY_LABEL);
    expect(html).not.toContain(COPIED_LABEL);
    expect(html).not.toContain(FALLBACK_MESSAGE);
  });

  /**
   * The page throws 「APP_BASE_URL 未設定」 rather than falling back to `""`
   * (T24 minor (a)). `app/(front)/hr/page.tsx` cannot be imported here — it
   * pulls in `lib/auth/guard` and `lib/db`, both `server-only` — so what is
   * pinned instead is the behaviour that made the silent fallback harmful:
   * an empty base URL produces a bare 「/」 that nobody can open from LINE.
   */
  it("an empty APP_BASE_URL would produce a useless 「/」 link", () => {
    const { summary } = dashboardAt(CLOCK_0903_1800);
    expect(summaryLink("")).toBe("/");
    expect(buildDailySummary({ ...summary, baseUrl: "" })).toMatch(/｜\/$/);
    expect(buildDailySummary({ ...summary, baseUrl: BASE_URL })).toMatch(/｜http:\/\/localhost:3000\/$/);
  });

  describe("clipboardWriter", () => {
    const withNavigator = <T,>(value: unknown, run: () => T): T => {
      const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
      Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
      try {
        return run();
      } finally {
        if (original) Object.defineProperty(globalThis, "navigator", original);
        else delete (globalThis as { navigator?: unknown }).navigator;
      }
    };

    it("no clipboard on navigator → null (the LINE in-app browser)", () => {
      expect(withNavigator({}, clipboardWriter)).toBeNull();
    });

    it("writeText is not a function → null", () => {
      expect(withNavigator({ clipboard: { writeText: "nope" } }, clipboardWriter)).toBeNull();
    });

    it("a real clipboard → a writer that delegates to writeText", async () => {
      const written: string[] = [];
      const clipboard = {
        writeText: (text: string) => {
          written.push(text);
          return Promise.resolve();
        },
      };
      const write = withNavigator({ clipboard }, clipboardWriter);
      expect(write).toBeTypeOf("function");
      await write!("9/3 新人日誌");
      expect(written).toEqual(["9/3 新人日誌"]);
    });
  });
});

// ---------------------------------------------------------------------------
// 三指標 (T24)
// ---------------------------------------------------------------------------

describe("MetricsTiles (三指標)", () => {
  it("9/4 18:00: 誤報率 0%, 主管回應率 50%, 24h 內回應率 50%", () => {
    const rates = ratesAt(CLOCK_0904_1800);
    expect(rates.falsePositive).toMatchObject(EXPECTED_METRICS_0904_1800.false_alarm);
    expect(rates.response).toMatchObject(EXPECTED_METRICS_0904_1800.response_rate);
    expect(rates.within24h).toMatchObject(EXPECTED_METRICS_0904_1800.response_within_threshold);
    expect(rates.late).toBe(EXPECTED_METRICS_0904_1800.late_alerts);

    const html = renderToStaticMarkup(<MetricsTiles rates={rates} />);
    expect(tileValueOf(html, METRIC_LABELS.falsePositive)).toBe("0%");
    expect(tileValueOf(html, METRIC_LABELS.response)).toBe("50%");
    expect(tileValueOf(html, METRIC_LABELS.within24h)).toBe("50%");
    // the denominator is shown next to each percentage (A08(e))
    expect(html).toContain("0 / 1");
    expect(html).toContain("1 / 2");
    expect(html).toContain("預警母體 2 筆・逾時回應 0 筆");
    expect(html).not.toContain(NO_ALERTS_LABEL);
    expect(html).not.toContain("<table");
  });

  it("no alerts: every tile shows 「—」, never NaN", () => {
    const rates = alertRates({
      alerts: [],
      responses: [],
      thresholdHours: SETTINGS.response_threshold_hours,
      now: CLOCK_0904_1800,
    });
    const html = renderToStaticMarkup(<MetricsTiles rates={rates} />);
    for (const label of Object.values(METRIC_LABELS)) {
      expect(tileValueOf(html, label)).toBe(NO_RATE_LABEL);
    }
    expect(html).toContain(NO_ALERTS_LABEL);
    expect(html).not.toContain("NaN");
  });

  it("(A02) a sample newcomer's alert is excluded once profiles are passed", () => {
    const base = metricAlertsOf(dataAsOf(CLOCK_0904_1800).alerts);
    const sampleId = "00000002-0000-4000-8000-000000000099";
    const withSample: MetricAlertRow[] = [
      ...base,
      {
        ...base[0],
        id: "alert-sample",
        user_id: sampleId,
        status: "open",
        responded_at: null,
        response_submission_id: null,
      },
    ];
    const profiles: MetricProfile[] = [
      ...NEWCOMERS_WITH_DEPARTMENT.map((n) => ({ id: n.id, status: n.status })),
      { id: sampleId, status: "sample" as const },
    ];
    // without profiles the sample alert would drag the population to 3
    expect(ratesAt(CLOCK_0904_1800, { alerts: withSample })).toMatchObject({
      total: 3,
      response: { numerator: 1, denominator: 3 },
    });
    const rates = ratesAt(CLOCK_0904_1800, { alerts: withSample, profiles });
    expect(rates.total).toBe(EXPECTED_METRICS_0904_1800.response_rate.denominator);
    expect(rates.response).toMatchObject(EXPECTED_METRICS_0904_1800.response_rate);
    expect(rates.within24h).toMatchObject(EXPECTED_METRICS_0904_1800.response_within_threshold);
    expect(tileValueOf(renderToStaticMarkup(<MetricsTiles rates={rates} />), METRIC_LABELS.response)).toBe(
      "50%",
    );
  });
});

// ---------------------------------------------------------------------------
// 近 7 日各部門統計 (T24)
// ---------------------------------------------------------------------------

describe("DepartmentStats (近 7 日各部門統計)", () => {
  it("9/4 18:00: four departments in sort_order; 採購 100%, 信義設計 0%, 工務／設計 「—」", () => {
    const stats = statsAt(CLOCK_0904_1800);
    const html = renderToStaticMarkup(<DepartmentStats stats={stats} />);
    expect(html.match(/data-testid="department-row"/g)).toHaveLength(4);
    expect(html).toContain("8/29–9/4");
    for (const column of DEPARTMENT_COLUMNS) expect(html).toContain(`>${column}<`);
    const order = [...html.matchAll(/data-department-id="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(DEPARTMENTS.map((d) => d.id));
    // 部門 / 新人 / 應交 / 已交 / 缺交 / 預警 / 已回應 / 回應率
    expect(cellsOf(rowOf(html, "data-department-id", departmentIdOf("採購")))).toEqual([
      "採購",
      "1",
      "4",
      "2",
      "2",
      "1",
      "1",
      "100%",
    ]);
    expect(cellsOf(rowOf(html, "data-department-id", departmentIdOf("信義設計")))).toEqual([
      "信義設計",
      "1",
      "4",
      "2",
      "2",
      "1",
      "0",
      "0%",
    ]);
    expect(cellsOf(rowOf(html, "data-department-id", departmentIdOf("工務")))).toEqual([
      "工務",
      "1",
      "4",
      "2",
      "2",
      "0",
      "0",
      NO_RATE_LABEL,
    ]);
  });

  it("the table scrolls inside its own container (375px: the page body must not)", () => {
    const html = renderToStaticMarkup(<DepartmentStats stats={statsAt(CLOCK_0904_1800)} />);
    expect(html).toMatch(/data-slot="table-container"[^>]*class="[^"]*overflow-x-auto/);
  });

  it("no departments: empty label, no table", () => {
    const html = renderToStaticMarkup(<DepartmentStats stats={statsAt(CLOCK_0904_1800, [])} />);
    expect(html).toContain(NO_DEPARTMENTS_LABEL);
    expect(html).not.toContain("<table");
  });

  it("parseWorkweekSetting rejects anything but the two schemes (no silent default)", () => {
    expect(parseWorkweekSetting(SETTINGS.workweek)).toBe("mon_fri");
    expect(parseWorkweekSetting("mon_sat")).toBe("mon_sat");
    expect(() => parseWorkweekSetting("mon_sun")).toThrow("settings.workweek");
    expect(() => parseWorkweekSetting(null)).toThrow("settings.workweek");
  });
});

// ---------------------------------------------------------------------------
// 新人總覽 (T24)
// ---------------------------------------------------------------------------

describe("NewcomerOverview (新人總覽)", () => {
  it("9/4 18:00: four rows, 嚴雅齡 回應率 100% / 洪湘庭 0%, names link to /hr/newcomer/[id]", () => {
    const rows = overviewAt(CLOCK_0904_1800);
    const html = renderToStaticMarkup(
      <NewcomerOverview rows={rows} departments={DEPARTMENTS} />,
    );
    expect(html.match(/data-testid="overview-row"/g)).toHaveLength(4);
    for (const newcomer of NEWCOMERS_WITH_DEPARTMENT) {
      expect(html).toContain(`href="${HR_NEWCOMER_PATH}/${newcomer.id}"`);
      expect(textOf(html)).toContain(newcomer.display_name);
    }
    // 姓名 / 部門 / 第 N 天 / 階段 / 下一節點 / 累計預警 / 回應率 / 缺交率
    expect(cellsOf(rowOf(html, "data-user-id", YEN.id))).toEqual([
      "嚴雅齡",
      "採購",
      "第 4 天",
      "第一階段（D30 前）",
      "D30 2026/10/01",
      "1",
      "100%",
      "50%",
    ]);
    expect(cellsOf(rowOf(html, "data-user-id", HUNG.id))).toEqual([
      "洪湘庭",
      "信義設計",
      "第 4 天",
      "第一階段（D30 前）",
      "D30 2026/10/01",
      "1",
      "0%",
      "50%",
    ]);
    expect(html).toMatch(/data-slot="table-container"[^>]*class="[^"]*overflow-x-auto/);
  });

  it("hrefFor={null} renders plain names (T26 /ceo has no link to /hr/newcomer)", () => {
    const html = renderToStaticMarkup(
      <NewcomerOverview
        rows={overviewAt(CLOCK_0904_1800)}
        departments={DEPARTMENTS}
        hrefFor={null}
      />,
    );
    expect(html).not.toContain(HR_NEWCOMER_PATH);
    expect(html).not.toContain("<a ");
    expect(textOf(html)).toContain("洪湘庭");
  });

  it("no start date / no department: 「尚未設定到職日」, 「未指派部門」, 缺交率 「—」", () => {
    const orphan: OverviewNewcomer = {
      ...NEWCOMERS_WITH_DEPARTMENT[0],
      id: "orphan-1",
      username: "orphan",
      display_name: "無到職日",
      start_date: null,
      department_id: null,
    };
    const html = renderToStaticMarkup(
      <NewcomerOverview rows={overviewAt(CLOCK_0904_1800, [orphan])} departments={DEPARTMENTS} />,
    );
    const cells = cellsOf(rowOf(html, "data-user-id", "orphan-1"));
    expect(cells[1]).toBe("未指派部門");
    expect(cells[2]).toBe("尚未設定到職日");
    expect(cells[7]).toBe(NO_RATE_LABEL);
    expect(html).not.toContain("NaN");
  });

  it("no active newcomers: empty label, no table", () => {
    const html = renderToStaticMarkup(<NewcomerOverview rows={[]} departments={DEPARTMENTS} />);
    expect(html).toContain(NO_NEWCOMERS_LABEL);
    expect(html).not.toContain("<table");
  });
});

// ---------------------------------------------------------------------------
// 節點到期清單 (T24, A09)
// ---------------------------------------------------------------------------

describe("MilestoneDue (節點到期)", () => {
  it("9/4 18:00: nothing due within 7 days (D30 is 10/01)", () => {
    const html = renderToStaticMarkup(<MilestoneDue milestones={dashboardAt(CLOCK_0904_1800).milestones} />);
    expect(html).toContain(NO_MILESTONE_DUE_LABEL);
    expect(html).toContain("9/4–9/11");
    expect(html).not.toContain('data-testid="milestone-entry"');
  });

  it("9/24 (window end 10/01 included): four D30 entries, 7 天後到期", () => {
    const html = renderToStaticMarkup(
      <MilestoneDue milestones={dashboardAt("2026-09-24T09:00:00+08:00").milestones} />,
    );
    expect(html.match(/data-testid="milestone-entry"/g)).toHaveLength(4);
    expect(html.match(/data-kind="D30"/g)).toHaveLength(4);
    expect(html).toContain("2026/10/01");
    expect(textOf(html)).toContain("7 天後到期");
    expect(html).not.toContain('data-overdue="true"');
    for (const newcomer of FIXTURE_NEWCOMERS) {
      expect(textOf(html)).toContain(newcomer.display_name);
    }
  });

  it("(A09) an overdue pending milestone is flagged and sorts first", () => {
    const overdue: DashboardMilestone = {
      id: "milestone-overdue",
      user_id: HUNG.id,
      kind: "D30",
      due_date: "2026-09-20",
      done_at: null,
    };
    const { milestones } = dashboardAt("2026-09-24T09:00:00+08:00", {
      milestones: [...ALL_MILESTONES, overdue],
    });
    const html = renderToStaticMarkup(<MilestoneDue milestones={milestones} />);
    const entries = [...html.matchAll(/data-milestone-id="([^"]+)"/g)].map((m) => m[1]);
    expect(entries[0]).toBe("milestone-overdue");
    expect(entries).toHaveLength(5);
    expect(html).toContain('data-overdue="true"');
    expect(textOf(html)).toContain("逾期 4 天");
  });
});
