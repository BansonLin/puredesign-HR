import type { Metadata } from "next";
import Link from "next/link";

import {
  buildNewcomerCard,
  NewcomerCard,
  parseDashboardSettings,
} from "@/components/dashboard/NewcomerCard";
import { NewcomerHeader } from "@/components/dashboard/NewcomerHeader";
import { buildTimeline, Timeline, type ResponderLike } from "@/components/dashboard/Timeline";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { canRespond, requireNewcomerAccess } from "@/lib/auth/guard";
import { listAlertsWithSubmission } from "@/lib/db/queries/alerts";
import { getVersionById } from "@/lib/db/queries/forms";
import { listMilestones } from "@/lib/db/queries/milestones";
import { getProfileByAuthId } from "@/lib/db/queries/profiles";
import { getSettings } from "@/lib/db/queries/settings";
import { listLogs, listResponsesForSubmissions } from "@/lib/db/queries/submissions";
import { parseQuestions, type Question } from "@/lib/forms/schema";
import { taipeiDateOf } from "@/lib/time";

export const metadata: Metadata = { title: "新人時間軸" };

const MANAGER_PATH = "/manager";
const ON_BEHALF_MODE_TITLE = "HR 代填模式";
const ON_BEHALF_MODE_TEXT = "您不是這位新人的部門主管；在此回應預警會標註為 HR 代填。";

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
 * /manager/newcomer/[id] (CLAUDE.md §8, PLAN T17): the newcomer's timeline.
 * `requireNewcomerAccess` enforces §10 row 3 (a manager of another
 * department gets 403; hr / ceo / admin may open anyone). The read-only
 * part: header, today's card, and one row per daily log (newest first).
 * T18 adds the 「回應」 action through `Timeline`'s `renderAction` slot.
 */
export default async function ManagerNewcomerPage({ params }: PageProps) {
  const { id } = await params;
  const { actor, newcomer } = await requireNewcomerAccess(id, {
    next: `${MANAGER_PATH}/newcomer/${id}`,
  });
  const now = new Date();
  const today = taipeiDateOf(now);

  const [rawSettings, logs, milestones, alerts] = await Promise.all([
    getSettings(),
    listLogs({ userId: newcomer.id }),
    listMilestones({ userId: newcomer.id }),
    listAlertsWithSubmission({ userIds: [newcomer.id] }),
  ]);
  const settings = parseDashboardSettings(rawSettings);

  const responses = await listResponsesForSubmissions(logs.map((log) => log.id));
  const [versions, responders] = await Promise.all([
    loadVersions([
      ...logs.map((log) => log.form_version_id),
      ...responses.map((response) => response.form_version_id),
    ]),
    loadResponders(responses.map((response) => response.user_id)),
  ]);

  const card = buildNewcomerCard({ newcomer, logs, versions, alerts, today, now, settings });
  const days = buildTimeline({
    logs,
    versions,
    alerts,
    responses,
    responders,
    now,
    thresholdHours: settings.thresholdHours,
  });
  const onBehalf = canRespond(actor, newcomer).on_behalf;

  return (
    <div className="flex flex-col gap-4">
      <Link href={MANAGER_PATH} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        ← 我的新人
      </Link>
      <NewcomerHeader
        displayName={newcomer.display_name}
        startDate={newcomer.start_date}
        milestones={milestones}
        today={today}
      />
      {onBehalf ? (
        <Alert data-testid="on-behalf-mode">
          <AlertDescription>
            <span className="font-medium">{ON_BEHALF_MODE_TITLE}</span>
            <span className="ml-1">{ON_BEHALF_MODE_TEXT}</span>
          </AlertDescription>
        </Alert>
      ) : null}
      <NewcomerCard card={card} />
      <h2 className="text-lg font-semibold">時間軸</h2>
      <Timeline days={days} />
    </div>
  );
}
