import type { Metadata } from "next";
import Link from "next/link";

import { parseWorkweekSetting } from "@/components/dashboard/DepartmentStats";
import { parseDashboardSettings } from "@/components/dashboard/NewcomerCard";
import {
  buildNinetyDayOverview,
  NinetyDayOverview,
} from "@/components/dashboard/NinetyDayOverview";
import { buildTimeline, Timeline, type ResponderLike } from "@/components/dashboard/Timeline";
import { Button } from "@/components/ui/button";
import { requireNewcomerAccess, requireRole } from "@/lib/auth/guard";
import { listAlertsWithSubmission } from "@/lib/db/queries/alerts";
import { getVersionById } from "@/lib/db/queries/forms";
import { listMilestones } from "@/lib/db/queries/milestones";
import { getProfileByAuthId } from "@/lib/db/queries/profiles";
import { getSettings } from "@/lib/db/queries/settings";
import { listLogs, listResponsesForSubmissions } from "@/lib/db/queries/submissions";
import { parseQuestions, type Question } from "@/lib/forms/schema";

export const metadata: Metadata = { title: "新人 90 天總覽" };

const HR_PATH = "/hr";
const EXPORT_PATH = "/api/export/newcomer";
const EXPORT_LABEL = "匯出 CSV";
const BACK_LABEL = "← 人資儀表板";
const TIMELINE_TITLE = "時間軸";

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

async function loadResponders(ids: Iterable<string>): Promise<Map<string, ResponderLike>> {
  const unique = [...new Set(ids)];
  const rows = await Promise.all(unique.map((id) => getProfileByAuthId(id)));
  const responders = new Map<string, ResponderLike>();
  for (const row of rows) {
    if (row) responders.set(row.id, { id: row.id, display_name: row.display_name, role: row.role });
  }
  return responders;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * /hr/newcomer/[id] (CLAUDE.md §8, PLAN T25): 90 天總覽 + the read-only
 * timeline + the per-newcomer CSV export. `requireRole(['hr','admin'])`
 * keeps managers and the CEO out of the HR view (they have /manager and
 * /ceo), `requireNewcomerAccess` then resolves the newcomer and re-applies
 * §10 row 3 (an id that is not a newcomer → 403).
 *
 * The page only reads rows, takes `now` once and hands everything to the
 * pure builders (`buildNinetyDayOverview`, `buildTimeline`); no number and
 * no time comparison happens here. The timeline is the T17 component reused
 * with `readOnly` — HR responds from /manager/newcomer/[id] (§10 代填), so
 * no response slot is passed. The 節點紀錄表單 (notes / outcome) is Phase 3.
 */
export default async function HrNewcomerPage({ params }: PageProps) {
  const { id } = await params;
  const path = `${HR_PATH}/newcomer/${id}`;
  await requireRole(["hr", "admin"], { next: path });
  const { newcomer } = await requireNewcomerAccess(id, { next: path });
  const now = new Date();

  const [rawSettings, logs, milestones, alerts] = await Promise.all([
    getSettings(),
    listLogs({ userId: newcomer.id }),
    listMilestones({ userId: newcomer.id }),
    listAlertsWithSubmission({ userIds: [newcomer.id] }),
  ]);
  const settings = parseDashboardSettings(rawSettings);
  const workweek = parseWorkweekSetting(rawSettings.workweek);

  const responses = await listResponsesForSubmissions(logs.map((log) => log.id));
  const [versions, responders] = await Promise.all([
    loadVersions([
      ...logs.map((log) => log.form_version_id),
      ...responses.map((response) => response.form_version_id),
    ]),
    loadResponders(responses.map((response) => response.user_id)),
  ]);

  const overview = buildNinetyDayOverview({
    newcomer,
    logs,
    alerts,
    milestones,
    settings: { daily_cutoff_time: settings.cutoff, workweek },
    now,
  });
  const days = buildTimeline({
    logs,
    versions,
    alerts,
    responses,
    responders,
    now,
    thresholdHours: settings.thresholdHours,
  });

  return (
    <div className="flex flex-col gap-4">
      <Link href={HR_PATH} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        {BACK_LABEL}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{newcomer.display_name}</h1>
        <Button asChild variant="outline" data-primary>
          <a href={`${EXPORT_PATH}/${newcomer.id}`} download data-testid="export-csv">
            {EXPORT_LABEL}
          </a>
        </Button>
      </div>
      <NinetyDayOverview data={overview} />
      <h2 className="text-lg font-semibold">{TIMELINE_TITLE}</h2>
      <Timeline days={days} readOnly />
    </div>
  );
}
