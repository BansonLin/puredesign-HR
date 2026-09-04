import { rawAnswersOf } from "@/components/dashboard/NewcomerCard";
import { requireNewcomerAccess } from "@/lib/auth/guard";
import { getSessionUser } from "@/lib/auth/session";
import {
  csvFilename,
  csvHttpHeaders,
  newcomerCsv,
  type CsvVersion,
} from "@/lib/db/csv";
import { listAlertsWithSubmission } from "@/lib/db/queries/alerts";
import { getVersionById } from "@/lib/db/queries/forms";
import { listLogs, listResponsesForSubmissions } from "@/lib/db/queries/submissions";
import { bySlot } from "@/lib/forms/resolve";
import { parseQuestions, type Question } from "@/lib/forms/schema";

/**
 * GET /api/export/newcomer/[id] — one newcomer's daily logs as CSV
 * (CLAUDE.md §8 /hr/newcomer/[id]「匯出該員 CSV」, §10 row 9「匯出 CSV」;
 * PLAN T25).
 *
 * Access (§10 row 9 = row 3's population): manager (same department), hr,
 * ceo, admin. `requireNewcomerAccess` is exactly
 * `requireRole(['manager','hr','ceo','admin'])` + `canAccessNewcomer` and
 * answers 403 through `forbidden()` (a newcomer, or 工務主任 asking for
 * 嚴雅齡); 採購主管 asking for 嚴雅齡 gets 200.
 *
 * An anonymous request gets 401, not the guard's redirect to /login:
 * middleware.ts does not protect /api (it only refreshes the session there),
 * and a download endpoint must answer with a status, not an HTML login page.
 * So the session is checked first and `requireNewcomerAccess` runs only for a
 * signed-in caller (D-41 (2)).
 *
 * Rows: the newcomer's non-deleted daily logs with their answers, the alerts
 * of those logs (any status) and the manager responses targeting them, whose
 * `response.status` / `response.comment` are resolved by slot through each
 * response's own version (D-17). Assembly and escaping are pure
 * (`lib/db/csv.ts`).
 */
export const dynamic = "force-dynamic";

const UNAUTHORIZED_BODY = "請先登入";
const TEXT_HEADERS = { "Content-Type": "text/plain; charset=utf-8" };

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return new Response(UNAUTHORIZED_BODY, { status: 401, headers: TEXT_HEADERS });
  }

  const { id } = await context.params;
  const { newcomer } = await requireNewcomerAccess(id);

  const [logs, alerts] = await Promise.all([
    listLogs({ userId: newcomer.id }),
    listAlertsWithSubmission({ userIds: [newcomer.id] }),
  ]);
  const responseRows = await listResponsesForSubmissions(logs.map((log) => log.id));

  const versionIds = [
    ...new Set([
      ...logs.map((log) => log.form_version_id),
      ...responseRows.map((response) => response.form_version_id),
    ]),
  ];
  const versionRows = await Promise.all(versionIds.map((versionId) => getVersionById(versionId)));
  const questionsById = new Map<string, readonly Question[]>();
  const versions: CsvVersion[] = [];
  for (const row of versionRows) {
    if (!row) continue;
    const parsed = parseQuestions(row.questions);
    if (!parsed.ok) continue;
    questionsById.set(row.id, parsed.questions);
    if (logs.some((log) => log.form_version_id === row.id)) {
      versions.push({ id: row.id, version_no: row.version_no, questions: parsed.questions });
    }
  }

  const responses = responseRows.map((response) => {
    const questions = questionsById.get(response.form_version_id);
    const slots = questions ? bySlot(questions, rawAnswersOf(response.answers)) : {};
    return {
      target_submission_id: response.target_submission_id,
      submitted_at: response.submitted_at,
      status: slots["response.status"] ?? null,
      comment: slots["response.comment"] ?? null,
    };
  });

  const body = newcomerCsv({ logs, versions, alerts, responses });

  return new Response(body, { headers: csvHttpHeaders(csvFilename(newcomer.username)) });
}
