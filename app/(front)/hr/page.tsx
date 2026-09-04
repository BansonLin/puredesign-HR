import type { Metadata } from "next";

import { AlertList } from "@/components/dashboard/AlertList";
import { CopySummaryButton } from "@/components/dashboard/CopySummaryButton";
import { InterventionList } from "@/components/dashboard/InterventionList";
import { parseDashboardSettings, rawAnswersOf } from "@/components/dashboard/NewcomerCard";
import { TodaySubmissions } from "@/components/dashboard/TodaySubmissions";
import { requireRole } from "@/lib/auth/guard";
import { listAlertsWithSubmission } from "@/lib/db/queries/alerts";
import { getVersionById } from "@/lib/db/queries/forms";
import { listMilestones } from "@/lib/db/queries/milestones";
import { activeNewcomers } from "@/lib/db/queries/profiles";
import { getSettings } from "@/lib/db/queries/settings";
import { listLogs, listResponsesForSubmissions } from "@/lib/db/queries/submissions";
import { bySlot } from "@/lib/forms/resolve";
import { parseQuestions, type Question } from "@/lib/forms/schema";
import { buildHrDashboard } from "@/lib/metrics/dashboard";
import { buildDailySummary } from "@/lib/metrics/summary";
import { formatDate, taipeiDateOf } from "@/lib/time";

export const metadata: Metadata = { title: "人資儀表板" };

const HR_PATH = "/hr";

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
 * /hr (CLAUDE.md §8, PLAN T20 — dashboard part one): 今日交件, 待處理預警,
 * HR 介入清單 and the one-line summary. hr / admin only (§10; newcomer,
 * manager and ceo get 403 from `requireRole`). The page reads rows, takes
 * `now` exactly once, hands everything to `buildHrDashboard` (D-31) and
 * renders; every number and list is derived there with that `now`.
 *
 * Responses are loaded through the daily logs they target
 * (`listResponsesForSubmissions`), so the population's logs up to today are
 * read without a start date (as /manager does); a response made in the
 * last 7 days may target an older log and must still reach the 需 HR 協助
 * segment (A04). `response.status` / `response.comment` are resolved by
 * slot through each response's own form version (D-17).
 */
export default async function HrPage() {
  await requireRole(["hr", "admin"], { next: HR_PATH });
  const now = new Date();
  const today = taipeiDateOf(now);

  const [rawSettings, newcomers] = await Promise.all([getSettings(), activeNewcomers()]);
  const settings = parseDashboardSettings(rawSettings);
  const userIds = newcomers.map((newcomer) => newcomer.id);

  const [logs, alerts, milestones] = await Promise.all([
    listLogs({ userIds, dateTo: today }),
    listAlertsWithSubmission({ userIds }),
    listMilestones({ userIds, pendingOnly: true }),
  ]);
  const responseRows = await listResponsesForSubmissions(logs.map((log) => log.id));
  const versions = await loadVersions(responseRows.map((response) => response.form_version_id));
  const responses = responseRows.map((response) => {
    const questions = versions.get(response.form_version_id);
    const slots = questions ? bySlot(questions, rawAnswersOf(response.answers)) : {};
    return {
      ...response,
      response_status: slots["response.status"] ?? null,
      response_comment: slots["response.comment"] ?? null,
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
  const summary = buildDailySummary({
    ...dashboard.summary,
    baseUrl: process.env.APP_BASE_URL ?? "",
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
    </div>
  );
}
