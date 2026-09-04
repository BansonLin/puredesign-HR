import type { Metadata } from "next";

import { AlertList } from "@/components/dashboard/AlertList";
import { CopySummaryButton } from "@/components/dashboard/CopySummaryButton";
import { DepartmentStats, parseWorkweekSetting } from "@/components/dashboard/DepartmentStats";
import { InterventionList } from "@/components/dashboard/InterventionList";
import { MetricsTiles } from "@/components/dashboard/MetricsTiles";
import { MilestoneDue } from "@/components/dashboard/MilestoneDue";
import { parseDashboardSettings, rawAnswersOf } from "@/components/dashboard/NewcomerCard";
import { NewcomerOverview } from "@/components/dashboard/NewcomerOverview";
import { TodaySubmissions } from "@/components/dashboard/TodaySubmissions";
import { requireRole } from "@/lib/auth/guard";
import { listAlertsWithSubmission } from "@/lib/db/queries/alerts";
import { listDepartments } from "@/lib/db/queries/departments";
import { getVersionById } from "@/lib/db/queries/forms";
import { listMilestones } from "@/lib/db/queries/milestones";
import { activeNewcomers, listProfiles } from "@/lib/db/queries/profiles";
import { getSettings } from "@/lib/db/queries/settings";
import { listLogs, listResponsesForSubmissions } from "@/lib/db/queries/submissions";
import { bySlot } from "@/lib/forms/resolve";
import { parseQuestions, type Question } from "@/lib/forms/schema";
import { buildHrDashboard } from "@/lib/metrics/dashboard";
import { departmentStats7d } from "@/lib/metrics/department";
import { newcomerOverview } from "@/lib/metrics/newcomer";
import { alertRates } from "@/lib/metrics/rates";
import { buildDailySummary } from "@/lib/metrics/summary";
import { formatDate, taipeiDateOf } from "@/lib/time";

export const metadata: Metadata = { title: "人資儀表板" };

const HR_PATH = "/hr";
const BASE_URL_MISSING = "APP_BASE_URL 未設定";

/**
 * `APP_BASE_URL` (§4) for the one-line summary link. Missing or blank throws
 * instead of silently producing 「…｜/」, a link HR would paste into the LINE
 * group and nobody could open (same principle as `parseDashboardSettings` /
 * `parseWorkweekSetting`: no silent defaults).
 */
function requireBaseUrl(): string {
  const baseUrl = process.env.APP_BASE_URL;
  if (baseUrl === undefined || baseUrl.trim() === "") throw new Error(BASE_URL_MISSING);
  return baseUrl;
}

/** Parsed questions of the given form versions, keyed by id (unparseable / missing versions are left out). */
async function loadVersions(ids: Iterable<string>): Promise<Map<string, readonly Question[]>> {
  const unique = [...new Set(ids)];
  const rows = await Promise.all(unique.map((id) => getVersionById(id)));
  const versions = new Map<string, readonly Question[]>();
  for (const row of rows) {
    if (!row) continue;
    const parsed = parseQuestions(row.questions);
    if (parsed.ok) versions.set(row.id, parsed.questions);
  }
  return versions;
}

/**
 * /hr (CLAUDE.md §8, PLAN T20 + T24): 今日交件, 待處理預警, HR 介入清單,
 * the one-line summary, 近 7 日各部門統計, 三指標, 新人總覽 and 節點到期清單.
 * hr / admin only (§10; newcomer, manager and ceo get 403 from `requireRole`).
 * The page reads rows, takes `now` exactly once, hands everything to the pure
 * functions (`buildHrDashboard` D-31; `alertRates` / `departmentStats7d` /
 * `newcomerOverview` D-33) and renders; every number is derived there with
 * that `now`. The only write on this page is the clipboard copy.
 *
 * Responses are loaded through the daily logs they target
 * (`listResponsesForSubmissions`), so the population's logs up to today are
 * read without a start date (as /manager does); a response made in the
 * last 7 days may target an older log and must still reach the 需 HR 協助
 * segment (A04). `response.status` / `response.comment` are resolved by
 * slot through each response's own form version (D-17), and the responder's
 * role comes from `listProfiles()` so an HR stand-in is labelled (D-35).
 *
 * `listProfiles()` is also handed to `alertRates` so `sample` accounts can
 * never reach the three metrics (A02), even though the alert query is already
 * scoped to `activeNewcomers()`. Milestones are loaded in full (not
 * `pendingOnly`): 新人總覽's 階段 needs all three rows (`stageOf`), while
 * 節點到期 drops the done ones itself.
 */
export default async function HrPage() {
  await requireRole(["hr", "admin"], { next: HR_PATH });
  const now = new Date();
  const today = taipeiDateOf(now);
  const baseUrl = requireBaseUrl();

  const [rawSettings, newcomers, departments, profiles] = await Promise.all([
    getSettings(),
    activeNewcomers(),
    listDepartments(),
    listProfiles(),
  ]);
  const settings = parseDashboardSettings(rawSettings);
  const workweek = parseWorkweekSetting(rawSettings.workweek);
  const userIds = newcomers.map((newcomer) => newcomer.id);

  const [logs, alerts, milestones] = await Promise.all([
    listLogs({ userIds, dateTo: today }),
    listAlertsWithSubmission({ userIds }),
    listMilestones({ userIds }),
  ]);
  const responseRows = await listResponsesForSubmissions(logs.map((log) => log.id));
  const versions = await loadVersions(responseRows.map((response) => response.form_version_id));
  const roleById = new Map(profiles.map((profile) => [profile.id, profile.role] as const));
  const responses = responseRows.map((response) => {
    const questions = versions.get(response.form_version_id);
    const slots = questions ? bySlot(questions, rawAnswersOf(response.answers)) : {};
    return {
      ...response,
      response_status: slots["response.status"] ?? null,
      response_comment: slots["response.comment"] ?? null,
      responder_role: roleById.get(response.user_id) ?? null,
    };
  });

  const dashboard = buildHrDashboard({
    now,
    data: {
      newcomers,
      logs,
      alerts,
      responses,
      milestones,
      settings: {
        daily_cutoff_time: settings.cutoff,
        response_threshold_hours: settings.thresholdHours,
      },
    },
  });
  const summary = buildDailySummary({ ...dashboard.summary, baseUrl });
  const rates = alertRates({
    alerts,
    responses,
    profiles,
    thresholdHours: settings.thresholdHours,
    now,
  });
  const stats = departmentStats7d({
    departments,
    newcomers,
    logs,
    alerts,
    settings: { daily_cutoff_time: settings.cutoff, workweek },
    now,
  });
  const overview = newcomerOverview({
    newcomers,
    logs,
    alerts,
    milestones,
    settings: { daily_cutoff_time: settings.cutoff, workweek },
    now,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">人資儀表板</h1>
        <p className="text-sm text-muted-foreground">{formatDate(today)}</p>
      </div>
      <CopySummaryButton text={summary} />
      <TodaySubmissions today={dashboard.today} />
      <AlertList entries={dashboard.pendingAlerts} />
      <InterventionList intervention={dashboard.intervention} />
      <DepartmentStats stats={stats} />
      <MetricsTiles rates={rates} />
      <NewcomerOverview rows={overview} departments={departments} />
      <MilestoneDue milestones={dashboard.milestones} />
    </div>
  );
}
