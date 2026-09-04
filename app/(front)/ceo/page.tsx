import type { Metadata } from "next";

import { AlertList } from "@/components/dashboard/AlertList";
import { DepartmentStats, parseWorkweekSetting } from "@/components/dashboard/DepartmentStats";
import { InterventionList } from "@/components/dashboard/InterventionList";
import { MetricsTiles } from "@/components/dashboard/MetricsTiles";
import { MilestoneDue } from "@/components/dashboard/MilestoneDue";
import { parseDashboardSettings, rawAnswersOf } from "@/components/dashboard/NewcomerCard";
import { NewcomerOverview } from "@/components/dashboard/NewcomerOverview";
import { TodaySubmissions } from "@/components/dashboard/TodaySubmissions";
import { Badge } from "@/components/ui/badge";
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
import { formatDate, taipeiDateOf } from "@/lib/time";

export const metadata: Metadata = { title: "營運儀表板" };

const CEO_PATH = "/ceo";
const READ_ONLY_LABEL = "唯讀";

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
 * /ceo (CLAUDE.md §8「與 /hr 相同唯讀，僅儀表板與新人總覽，無操作按鈕」,
 * PLAN T26): the same blocks as /hr, fed by the same `buildHrDashboard(now)`
 * and the same lib/metrics pure functions, so the two roles can never read
 * different numbers off the same database.
 *
 * `requireRole(['ceo'])` — admin is deliberately NOT in the list: §10 gives
 * admin the HR view (`homeFor('admin') === '/hr'`), and /ceo exists only to
 * strip the operations. manager / newcomer / hr / admin therefore get 403,
 * and ceo gets 403 on /hr, /manager and /admin from those pages' own guards.
 *
 * Read-only means literally no `button` and no `form` inside `<main>` (the
 * logout button lives in the app header, app/(front)/layout.tsx):
 *   - no 「複製今日一行摘要」 (`CopySummaryButton`), so `APP_BASE_URL` is not
 *     read here either — the one-line summary is HR's tool (§8, A13);
 *   - no 回應 drawer (that is /manager, §10 row 4) and no CSV export
 *     (§10 row 9 allows ceo, but the export lives on /hr/newcomer/[id],
 *     which ceo has no link to);
 *   - every newcomer name renders as plain text: `hrefFor={null}` on
 *     `NewcomerOverview`, `AlertList` and `InterventionList`, so the page
 *     contains no `/hr/newcomer` or `/manager/newcomer` link the CEO would
 *     only meet a 403 (or an HR-only page) behind.
 *
 * Like /hr the page takes `now` exactly once, reads rows, and leaves every
 * number to the pure functions; nothing here compares times.
 */
export default async function CeoPage() {
  await requireRole(["ceo"], { next: CEO_PATH });
  const now = new Date();
  const today = taipeiDateOf(now);

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
        <h1 className="text-xl font-semibold">
          營運儀表板
          <Badge variant="outline" className="ml-2 align-middle">
            {READ_ONLY_LABEL}
          </Badge>
        </h1>
        <p className="text-sm text-muted-foreground">{formatDate(today)}</p>
      </div>
      <TodaySubmissions today={dashboard.today} />
      <AlertList entries={dashboard.pendingAlerts} hrefFor={null} />
      <InterventionList intervention={dashboard.intervention} hrefFor={null} />
      <DepartmentStats stats={stats} />
      <MetricsTiles rates={rates} />
      <NewcomerOverview rows={overview} departments={departments} hrefFor={null} />
      <MilestoneDue milestones={dashboard.milestones} />
    </div>
  );
}
