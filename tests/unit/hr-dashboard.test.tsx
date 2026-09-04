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
  COPIED_LABEL,
  COPY_LABEL,
  CopySummaryButton,
  FALLBACK_MESSAGE,
} from "@/components/dashboard/CopySummaryButton";
import {
  InterventionList,
  NEED_HR_TITLE,
  NO_NEED_HR_LABEL,
  NO_OVERDUE_LABEL,
  OVERDUE_TITLE,
} from "@/components/dashboard/InterventionList";
import {
  NO_MISSING_LABEL,
  PENDING_LIST_TITLE,
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
import { buildDailySummary } from "@/lib/metrics/summary";
import { RESPONSE_STATUS_NEED_HR } from "@/lib/rules/constants";
import { toInstant, type Instant } from "@/lib/time";
import { milestonesFor } from "@/lib/time/milestones";
import {
  CLOCK_0903_1800,
  CLOCK_0904_1200,
  CLOCK_0904_1800,
  EXPECTED_ESCALATION,
  EXPECTED_MISSING_0904,
  EXPECTED_SUMMARY_0903_1800,
  FIXTURE_NEWCOMERS,
  SETTINGS,
} from "@seed/fixtures";
import { buildSeedPlan } from "@seed/plan";

/**
 * T20 /hr dashboard blocks (PLAN T20): the three section components and the
 * copy button rendered through react-dom/server with the output of
 * `buildHrDashboard` on the §11 seed plan at the PLAN 4.9.5 fake clocks.
 * The database snapshot helper (`dataAsOf`) mirrors tests/unit/dashboard.test.ts.
 *
 * Acceptance: at 9/4 18:00 the 缺交名單 lists all four newcomers, the
 * 待處理預警 block names 洪湘庭 (R2, 逾時) and links to her timeline, and
 * the HR 介入清單 lists 洪湘庭 under 逾時未回.
 */

const BASE_URL = "http://localhost:3000";
const PLAN = buildSeedPlan();

type Newcomer = DashboardNewcomer & { username: string };
type Log = DashboardLog & { id: string };
type Alert = DashboardAlert & { detail: Record<string, unknown> };
type Response = DashboardResponse & { id: string; response_comment: string | null };
type Data = HrDashboardData<Newcomer, Log, Alert, Response, DashboardMilestone>;

const SETTINGS_ROWS = {
  daily_cutoff_time: SETTINGS.daily_cutoff_time,
  response_threshold_hours: SETTINGS.response_threshold_hours,
};

const ms = (instant: Instant) => toInstant(instant).getTime();
const submissionId = (logSeq: number) => `seq-${logSeq}`;

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
        detail: alert.detail,
        submission: { id: submissionId(alert.log_seq), user_id: log.user_id, log_date: log.log_date },
      };
    });
  const responses: Response[] = PLAN.responses
    .filter((r) => ms(r.submitted_at) <= nowMs)
    .map((r) => ({
      id: `response-${r.seq}`,
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

  it("9/3 18:00: 4/4 submitted, no missing", () => {
    const { today } = dashboardAt(CLOCK_0903_1800);
    const html = renderToStaticMarkup(<TodaySubmissions today={today} />);
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
});
