import type { Metadata } from "next";

import {
  buildNewcomerCard,
  latestLogBefore,
  newcomerScope,
  NewcomerCard,
  parseDashboardSettings,
} from "@/components/dashboard/NewcomerCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { canAccessNewcomer, requireRole } from "@/lib/auth/guard";
import { listAlertsWithSubmission } from "@/lib/db/queries/alerts";
import { getVersionById } from "@/lib/db/queries/forms";
import { activeNewcomers } from "@/lib/db/queries/profiles";
import { getSettings } from "@/lib/db/queries/settings";
import { listLogs, type Submission } from "@/lib/db/queries/submissions";
import { parseQuestions, type Question } from "@/lib/forms/schema";
import { formatDate, taipeiDateOf } from "@/lib/time";

export const metadata: Metadata = { title: "我的新人" };

const MANAGER_PATH = "/manager";

const ON_BEHALF_MODE_TITLE = "HR 代填模式";
const ON_BEHALF_MODE_TEXT = "您看到的是全部部門的 active 新人；在此回應預警或填週回饋會標註為 HR 代填。";
const NO_DEPARTMENT_TEXT = "您的帳號尚未設定部門，請聯絡 HR。";
const NO_NEWCOMERS_TEXT = "目前沒有在職新人。";

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

function groupByUser(logs: readonly Submission[]): Map<string, Submission[]> {
  const byUser = new Map<string, Submission[]>();
  for (const log of logs) {
    const list = byUser.get(log.user_id);
    if (list) list.push(log);
    else byUser.set(log.user_id, [log]);
  }
  return byUser;
}

/**
 * /manager (CLAUDE.md §8, PLAN T17): one card per newcomer. A manager sees
 * the active newcomers of their own department (§10 row 3; a manager
 * without a department sees nobody); hr / admin see every department and
 * the page is marked 「HR 代填模式」. `now` is read exactly once and every
 * derivation (today, R3 status, A1 overdue) gets it injected.
 */
export default async function ManagerPage() {
  const actor = await requireRole(["manager", "hr", "admin"], { next: MANAGER_PATH });
  const now = new Date();
  const today = taipeiDateOf(now);

  const scope = newcomerScope(actor);
  const population =
    scope.kind === "none"
      ? []
      : await activeNewcomers(scope.kind === "department" ? { departmentId: scope.departmentId } : {});
  // §10 stays the single truth: every listed row must pass canAccessNewcomer.
  const newcomers = population.filter((newcomer) => canAccessNewcomer(actor, newcomer));
  const userIds = newcomers.map((newcomer) => newcomer.id);

  const [rawSettings, logs, openAlerts] = await Promise.all([
    getSettings(),
    listLogs({ userIds, dateTo: today }),
    listAlertsWithSubmission({ userIds, statuses: ["open"] }),
  ]);
  const settings = parseDashboardSettings(rawSettings);

  const logsByUser = groupByUser(logs);
  const versionIds: string[] = [];
  for (const newcomer of newcomers) {
    const source = latestLogBefore(logsByUser.get(newcomer.id) ?? [], today);
    if (source) versionIds.push(source.form_version_id);
  }
  const versions = await loadVersions(versionIds);

  const cards = newcomers.map((newcomer) =>
    buildNewcomerCard({
      newcomer,
      logs: logsByUser.get(newcomer.id) ?? [],
      versions,
      alerts: openAlerts.filter((alert) => alert.user_id === newcomer.id),
      today,
      now,
      settings,
    }),
  );

  const onBehalf = actor.role !== "manager";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">我的新人</h1>
        <p className="text-sm text-muted-foreground">{formatDate(today)}</p>
      </div>
      {onBehalf ? (
        <Alert data-testid="on-behalf-mode">
          <AlertDescription>
            <span className="font-medium">{ON_BEHALF_MODE_TITLE}</span>
            <span className="ml-1">{ON_BEHALF_MODE_TEXT}</span>
          </AlertDescription>
        </Alert>
      ) : null}
      {scope.kind === "none" ? (
        <Alert variant="destructive">
          <AlertDescription>{NO_DEPARTMENT_TEXT}</AlertDescription>
        </Alert>
      ) : cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">{NO_NEWCOMERS_TEXT}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((card) => (
            <NewcomerCard key={card.id} card={card} href={`${MANAGER_PATH}/newcomer/${card.id}`} />
          ))}
        </div>
      )}
    </div>
  );
}
