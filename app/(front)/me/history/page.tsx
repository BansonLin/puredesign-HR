import type { Metadata } from "next";

import { buildHistoryRows, HistoryList } from "@/components/dashboard/HistoryList";
import { parseDashboardSettings } from "@/components/dashboard/NewcomerCard";
import type { ResponderLike } from "@/components/dashboard/Timeline";
import { requireRole } from "@/lib/auth/guard";
import { listAlertsWithSubmission } from "@/lib/db/queries/alerts";
import { getVersionById } from "@/lib/db/queries/forms";
import { getProfileByAuthId } from "@/lib/db/queries/profiles";
import { getSettings } from "@/lib/db/queries/settings";
import {
  listLogs,
  listResponsesForSubmissions,
  listWeeklyFeedback,
} from "@/lib/db/queries/submissions";
import { parseQuestions, type Question } from "@/lib/forms/schema";
import { formatDate, taipeiDateOf } from "@/lib/time";

export const metadata: Metadata = { title: "歷史" };

const HISTORY_PATH = "/me/history";

/**
 * Parsed questions of the given form versions, keyed by id. A version that
 * cannot be used is left out of the map either way, but the two reasons are
 * kept apart for the reader (§6 history is rendered with the version it was
 * written against): the row is gone, or the row exists and its `questions`
 * jsonb does not parse (`unparseable`).
 */
async function loadVersions(
  ids: Iterable<string>,
): Promise<{ versions: Map<string, readonly Question[]>; unparseable: Set<string> }> {
  const unique = [...new Set(ids)];
  const rows = await Promise.all(unique.map((id) => getVersionById(id)));
  const versions = new Map<string, readonly Question[]>();
  const unparseable = new Set<string>();
  for (const row of rows) {
    if (!row) continue;
    const parsed = parseQuestions(row.questions);
    if (parsed.ok) versions.set(row.id, parsed.questions);
    else unparseable.add(row.id);
  }
  return { versions, unparseable };
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

/**
 * /me/history (CLAUDE.md §8, PLAN T21). Newcomer only (§10 row 2): every
 * query is keyed on the signed-in profile — own logs (`user_id`), alerts of
 * those logs (`userIds: [me]`), responses targeting those logs, weekly
 * feedback whose target is me. `now` is read exactly once here and injected
 * into the pure builder (`buildHistoryRows`), which derives the A1 alert
 * states and the week of each day.
 */
export default async function HistoryPage() {
  const profile = await requireRole(["newcomer"], { next: HISTORY_PATH });
  const now = new Date();
  const today = taipeiDateOf(now);

  const [rawSettings, logs, alerts, weekly] = await Promise.all([
    getSettings(),
    listLogs({ userId: profile.id }),
    listAlertsWithSubmission({ userIds: [profile.id] }),
    listWeeklyFeedback({ targetUserId: profile.id }),
  ]);
  const settings = parseDashboardSettings(rawSettings);

  const responses = await listResponsesForSubmissions(logs.map((log) => log.id));
  const [{ versions, unparseable }, responders] = await Promise.all([
    loadVersions([
      ...logs.map((log) => log.form_version_id),
      ...responses.map((response) => response.form_version_id),
      ...weekly.map((entry) => entry.form_version_id),
    ]),
    loadResponders([
      ...responses.map((response) => response.user_id),
      ...weekly.map((entry) => entry.user_id),
    ]),
  ]);

  const rows = buildHistoryRows({
    logs,
    versions,
    alerts,
    responses,
    weekly,
    responders,
    unparseableVersionIds: unparseable,
    now,
    thresholdHours: settings.thresholdHours,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">歷史</h1>
        <p className="text-sm text-muted-foreground">{formatDate(today)}</p>
      </div>
      <HistoryList rows={rows} />
    </div>
  );
}
