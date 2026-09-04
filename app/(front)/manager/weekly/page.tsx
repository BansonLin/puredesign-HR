import type { Metadata } from "next";

import { newcomerScope } from "@/components/dashboard/NewcomerCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { canAccessNewcomer, canRespond, requireRole } from "@/lib/auth/guard";
import { getActiveVersion } from "@/lib/db/queries/forms";
import { activeNewcomers } from "@/lib/db/queries/profiles";
import { listWeeklyFeedback } from "@/lib/db/queries/submissions";
import { parseQuestions } from "@/lib/forms/schema";
import { ERROR_WEEKLY_VERSION_INVALID, weeklyInitialAnswers } from "@/lib/forms/submit";
import { formatDate, taipeiDateOf, weekStartMonday } from "@/lib/time";

import { submitWeeklyFeedback } from "./actions";
import { WeeklyForm } from "./WeeklyForm";

export const metadata: Metadata = { title: "週回饋" };

const WEEKLY_PATH = "/manager/weekly";

const ON_BEHALF_MODE_TITLE = "HR 代填模式";
const ON_BEHALF_MODE_TEXT = "您可以為任何部門的新人填寫週回饋，送出會標註為 HR 代填。";
const NO_DEPARTMENT_TEXT = "您的帳號尚未設定部門，請聯絡 HR。";
const NO_NEWCOMERS_TEXT = "目前沒有在職新人，沒有可填的週回饋。";
const NO_ACTIVE_FORM_MESSAGE = "目前沒有可用的週回饋表單";

interface PageProps {
  searchParams: Promise<{ newcomer?: string | string[] }>;
}

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * /manager/weekly (CLAUDE.md §8, PLAN T22): the weekly-feedback form.
 * manager / hr / admin only (§10 row 4; ceo is read-only and gets 403).
 * The dropdown offers the same population as /manager — a manager's own
 * department (`activeNewcomers({ departmentId })`), hr / admin every
 * department — filtered through `canAccessNewcomer` so §10 stays the single
 * truth; `?newcomer={id}` pre-selects one of them (an id outside the list is
 * ignored; a lone newcomer is selected automatically). `now` is read once;
 * this week's Monday (`weekStartMonday(taipeiDateOf(now))`) pre-fills the
 * `weekly.start_date` question, and the actor's existing feedback for
 * (selected newcomer, this week) switches the form to edit mode.
 */
export default async function ManagerWeeklyPage({ searchParams }: PageProps) {
  const actor = await requireRole(["manager", "hr", "admin"], { next: WEEKLY_PATH });
  const now = new Date();
  const today = taipeiDateOf(now);
  const weekStart = weekStartMonday(today);

  const params = await searchParams;
  const requested = firstParam(params.newcomer);

  const scope = newcomerScope(actor);
  const population =
    scope.kind === "none"
      ? []
      : await activeNewcomers(scope.kind === "department" ? { departmentId: scope.departmentId } : {});
  // §10 row 3 for the list; row 4 (`canRespond`, incl. on_behalf) for the form itself.
  const newcomers = population.filter(
    (newcomer) => canAccessNewcomer(actor, newcomer) && canRespond(actor, newcomer).allowed,
  );

  const selected =
    newcomers.find((newcomer) => newcomer.id === requested) ??
    (newcomers.length === 1 ? newcomers[0] : null);

  const [activeVersion, feedback] = await Promise.all([
    getActiveVersion("weekly_feedback"),
    selected
      ? listWeeklyFeedback({ userId: actor.id, targetUserId: selected.id, weekStart })
      : Promise.resolve([]),
  ]);

  const onBehalf = actor.role !== "manager";
  const title = (
    <div className="flex items-baseline justify-between gap-2">
      <h1 className="text-xl font-semibold">週回饋</h1>
      <p className="text-sm text-muted-foreground">
        本週 {formatDate(weekStart, "M/d")} 起・今天 {formatDate(today, "M/d")}
      </p>
    </div>
  );
  const onBehalfNotice = onBehalf ? (
    <Alert data-testid="on-behalf-mode">
      <AlertDescription>
        <span className="font-medium">{ON_BEHALF_MODE_TITLE}</span>
        <span className="ml-1">{ON_BEHALF_MODE_TEXT}</span>
      </AlertDescription>
    </Alert>
  ) : null;

  if (scope.kind === "none") {
    return (
      <div className="flex flex-col gap-4">
        {title}
        <Alert variant="destructive">
          <AlertDescription>{NO_DEPARTMENT_TEXT}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (newcomers.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {title}
        {onBehalfNotice}
        <p className="text-sm text-muted-foreground">{NO_NEWCOMERS_TEXT}</p>
      </div>
    );
  }

  if (!activeVersion) {
    return (
      <div className="flex flex-col gap-4">
        {title}
        {onBehalfNotice}
        <Alert>
          <AlertDescription>{NO_ACTIVE_FORM_MESSAGE}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const parsed = parseQuestions(activeVersion.questions);
  if (!parsed.ok) {
    return (
      <div className="flex flex-col gap-4">
        {title}
        {onBehalfNotice}
        <Alert variant="destructive">
          <AlertDescription>{ERROR_WEEKLY_VERSION_INVALID}</AlertDescription>
        </Alert>
      </div>
    );
  }
  const questions = parsed.questions;

  const initial = selected
    ? weeklyInitialAnswers({
        questions,
        actorId: actor.id,
        newcomerId: selected.id,
        weekStart,
        feedback,
      })
    : weeklyInitialAnswers({ questions, actorId: actor.id, newcomerId: "", weekStart, feedback: [] });

  return (
    <div className="flex flex-col gap-4">
      {title}
      {onBehalfNotice}
      <WeeklyForm
        newcomers={newcomers.map((newcomer) => ({ id: newcomer.id, display_name: newcomer.display_name }))}
        selectedId={selected?.id ?? null}
        questions={questions}
        initialAnswers={initial.answers}
        editing={initial.editing}
        onBehalf={onBehalf}
        action={submitWeeklyFeedback.bind(null, { newcomerId: selected?.id ?? null })}
      />
    </div>
  );
}
