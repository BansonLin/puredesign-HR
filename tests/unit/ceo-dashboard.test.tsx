import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AlertList } from "@/components/dashboard/AlertList";
import { CopySummaryButton } from "@/components/dashboard/CopySummaryButton";
import { DepartmentStats } from "@/components/dashboard/DepartmentStats";
import { InterventionList } from "@/components/dashboard/InterventionList";
import { MetricsTiles } from "@/components/dashboard/MetricsTiles";
import { MilestoneDue } from "@/components/dashboard/MilestoneDue";
import {
  hrNewcomerHref,
  HR_NEWCOMER_PATH,
  NewcomerOverview,
} from "@/components/dashboard/NewcomerOverview";
import { TodaySubmissions } from "@/components/dashboard/TodaySubmissions";
import type { DepartmentRow } from "@/lib/metrics/department";
import { departmentStats7d } from "@/lib/metrics/department";
import {
  buildHrDashboard,
  type DashboardAlert,
  type DashboardLog,
  type DashboardMilestone,
  type DashboardNewcomer,
  type DashboardResponse,
  type HrDashboardData,
} from "@/lib/metrics/dashboard";
import { newcomerOverview } from "@/lib/metrics/newcomer";
import { alertRates } from "@/lib/metrics/rates";
import { toInstant, type Instant, type Workweek } from "@/lib/time";
import { milestonesFor } from "@/lib/time/milestones";
import {
  CLOCK_0904_1800,
  DEPARTMENTS,
  FIXTURE_NEWCOMERS,
  SETTINGS,
} from "@seed/fixtures";
import { buildSeedPlan } from "@seed/plan";

/**
 * /ceo (CLAUDE.md §8「與 /hr 相同唯讀，僅儀表板與新人總覽，無操作按鈕」,
 * PLAN T26). The page itself imports `server-only` through lib/auth/guard and
 * lib/db, so Vitest cannot render it; what this file renders instead is the
 * exact block combination `app/(front)/ceo/page.tsx` returns — the same
 * `buildHrDashboard` / `alertRates` / `departmentStats7d` / `newcomerOverview`
 * output as /hr on the §11 seed plan at the 9/4 18:00 fake clock, with the
 * read-only props the page passes (`hrefFor={null}`) and without
 * `CopySummaryButton`.
 *
 * Acceptance: the rendered markup contains no `<button`, no `<form` and no
 * `/hr/newcomer` link, while the same blocks rendered the /hr way (default /
 * `hrNewcomerHref` links, plus the copy button) do contain both a link and a
 * button — i.e. the difference is the props, not a different dashboard.
 * `main` therefore has zero button/form elements; the only button of a signed-in
 * /ceo page is 登出, which lives in the header of app/(front)/layout.tsx.
 */

const PLAN = buildSeedPlan();

type Newcomer = DashboardNewcomer & { username: string; department_id: string | null };
type Log = DashboardLog & { id: string };
/** `response_submission_id` links a responded alert to its response row (誤報率). */
type Alert = DashboardAlert & {
  detail: Record<string, unknown>;
  response_submission_id: string | null;
};
type Response = DashboardResponse & { id: string; response_comment: string | null };
type Data = HrDashboardData<Newcomer, Log, Alert, Response, DashboardMilestone>;

const ms = (instant: Instant) => toInstant(instant).getTime();
const submissionId = (logSeq: number) => `seq-${logSeq}`;
const responseId = (seq: number) => `response-${seq}`;

const departmentIdOf = (name: string): string => {
  const found = DEPARTMENTS.find((d) => d.name === name);
  if (!found) throw new Error(`unknown department ${name}`);
  return found.id;
};

/** The fixture newcomers as `profiles` rows (department name → id). */
const NEWCOMERS: Newcomer[] = FIXTURE_NEWCOMERS.map((n) => ({
  ...n,
  department_id: departmentIdOf(n.department),
}));

const ALL_MILESTONES: DashboardMilestone[] = FIXTURE_NEWCOMERS.flatMap((n) =>
  milestonesFor(n.start_date).map((due) => ({
    id: `${n.username}-${due.kind}`,
    user_id: n.id,
    kind: due.kind,
    due_date: due.due_date,
    done_at: null,
  })),
);

const SETTINGS_ROWS = {
  daily_cutoff_time: SETTINGS.daily_cutoff_time,
  response_threshold_hours: SETTINGS.response_threshold_hours,
};

const METRIC_SETTINGS = {
  daily_cutoff_time: SETTINGS.daily_cutoff_time,
  workweek: SETTINGS.workweek as Workweek,
};

/** The seed rows as the database would hold them at `now` (mirrors hr-dashboard.test.tsx). */
function dataAsOf(now: Instant): Data {
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
    newcomers: NEWCOMERS,
    logs,
    alerts,
    responses,
    milestones: ALL_MILESTONES,
    settings: SETTINGS_ROWS,
  };
}

/**
 * `listAlertsWithSubmission()` inner-joins on `deleted_at is null` (A05 (1));
 * lib/metrics reads that flag as a second gate and both pages spell it out.
 */
const metricAlertsOf = (alerts: readonly Alert[]) =>
  alerts.map((alert) => ({
    ...alert,
    submission: { ...alert.submission, deleted_at: null as string | null },
  }));

/** Everything the two pages compute from one injected `now`. */
function viewAt(now: Instant) {
  const data = dataAsOf(now);
  const metricAlerts = metricAlertsOf(data.alerts);
  return {
    dashboard: buildHrDashboard({ now, data }),
    rates: alertRates({
      alerts: metricAlerts,
      responses: data.responses,
      thresholdHours: SETTINGS.response_threshold_hours,
      now,
    }),
    stats: departmentStats7d({
      departments: DEPARTMENTS as readonly DepartmentRow[],
      newcomers: NEWCOMERS,
      logs: data.logs,
      alerts: metricAlerts,
      settings: METRIC_SETTINGS,
      now,
    }),
    overview: newcomerOverview({
      newcomers: NEWCOMERS,
      logs: data.logs,
      alerts: metricAlerts,
      milestones: ALL_MILESTONES,
      settings: METRIC_SETTINGS,
      now,
    }),
  };
}

type View = ReturnType<typeof viewAt>;

/** The blocks of app/(front)/ceo/page.tsx, in render order (no copy button). */
function CeoBlocks({ view }: { view: View }) {
  const { dashboard, rates, stats, overview } = view;
  return (
    <div>
      <TodaySubmissions today={dashboard.today} />
      <AlertList entries={dashboard.pendingAlerts} hrefFor={null} />
      <InterventionList intervention={dashboard.intervention} hrefFor={null} />
      <DepartmentStats stats={stats} />
      <MetricsTiles rates={rates} />
      <NewcomerOverview rows={overview} departments={DEPARTMENTS} hrefFor={null} />
      <MilestoneDue milestones={dashboard.milestones} />
    </div>
  );
}

/** The same blocks the /hr way: linked names plus 「複製今日一行摘要」. */
function HrBlocks({ view }: { view: View }) {
  const { dashboard, rates, stats, overview } = view;
  return (
    <div>
      <CopySummaryButton text="9/4 新人日誌｜0/4 已交" />
      <TodaySubmissions today={dashboard.today} />
      <AlertList entries={dashboard.pendingAlerts} hrefFor={hrNewcomerHref} />
      <InterventionList intervention={dashboard.intervention} hrefFor={hrNewcomerHref} />
      <DepartmentStats stats={stats} />
      <MetricsTiles rates={rates} />
      <NewcomerOverview rows={overview} departments={DEPARTMENTS} />
      <MilestoneDue milestones={dashboard.milestones} />
    </div>
  );
}

/** Text between tags, for name assertions. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ");

const VIEW_0904_1800 = viewAt(CLOCK_0904_1800);
const CEO_HTML = renderToStaticMarkup(<CeoBlocks view={VIEW_0904_1800} />);
const HR_HTML = renderToStaticMarkup(<HrBlocks view={VIEW_0904_1800} />);

describe("/ceo blocks (唯讀儀表板)", () => {
  it("9/4 18:00: renders no button and no form element", () => {
    expect(CEO_HTML).not.toContain("<button");
    expect(CEO_HTML).not.toContain("<form");
  });

  it("9/4 18:00: has no link to /hr/newcomer (nor any other newcomer page)", () => {
    expect(CEO_HTML).not.toContain(`href="${HR_NEWCOMER_PATH}`);
    expect(CEO_HTML).not.toContain('href="/hr/newcomer');
    expect(CEO_HTML).not.toContain('href="/manager/newcomer');
  });

  it("9/4 18:00: still shows the dashboard blocks and 新人總覽 with the names as plain text", () => {
    for (const testId of [
      "today-submissions",
      "pending-alerts",
      "intervention",
      "department-stats",
      "metrics",
      "newcomer-overview",
      "milestone-due",
    ]) {
      expect(CEO_HTML).toContain(`data-testid="${testId}"`);
    }
    const text = textOf(CEO_HTML);
    for (const newcomer of NEWCOMERS) {
      expect(text).toContain(newcomer.display_name);
    }
    // 洪湘庭's open R2 is listed, but her name in that card carries no href.
    expect(CEO_HTML).toContain('data-testid="pending-alert"');
    expect(CEO_HTML).toContain('data-testid="overdue-entry"');
  });

  it("the same blocks rendered the /hr way do link to /hr/newcomer and do have a button", () => {
    expect(HR_HTML).toContain('href="/hr/newcomer');
    expect(HR_HTML).toContain("<button");
    // …so the /ceo difference is the props, not a smaller dashboard.
    for (const testId of ["today-submissions", "pending-alerts", "newcomer-overview"]) {
      expect(HR_HTML).toContain(`data-testid="${testId}"`);
    }
  });
});
