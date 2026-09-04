import type { Metadata } from "next";

import { NewcomerHeader } from "@/components/dashboard/NewcomerHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { requireRole } from "@/lib/auth/guard";
import { getActiveVersion, getVersionById } from "@/lib/db/queries/forms";
import { listMilestones } from "@/lib/db/queries/milestones";
import { getLogByDate, getPreviousLog } from "@/lib/db/queries/submissions";
import { getAnswer, readYesterdayPlan, type YesterdayPlan } from "@/lib/forms/resolve";
import { parseQuestions, type Answers, type Question } from "@/lib/forms/schema";
import {
  ERROR_ACTIVE_VERSION_INVALID,
  ERROR_PREVIOUS_VERSION_MISSING,
} from "@/lib/forms/submit";
import { formatDate, taipeiDateOf } from "@/lib/time";

import { submitDailyLog } from "./actions";
import { TodayForm, type YesterdayInfo } from "./TodayForm";

export const metadata: Metadata = { title: "今日日誌" };

const TODAY_PATH = "/me/today";
const NO_ACTIVE_FORM_MESSAGE = "目前沒有可用的日誌表單";

/** `submissions.answers` (jsonb) narrowed to the object shape `getAnswer` reads. */
function answersObject(json: unknown): Readonly<Record<string, unknown>> | null {
  return json !== null && typeof json === "object" && !Array.isArray(json)
    ? (json as Readonly<Record<string, unknown>>)
    : null;
}

/** Every key of `questions` from a stored jsonb (`getAnswer`: missing / '' → null). */
function toAnswers(json: unknown, questions: readonly Question[]): Answers {
  const raw = answersObject(json);
  const answers: Answers = {};
  for (const q of questions) answers[q.key] = getAnswer(raw, q.key);
  return answers;
}

/**
 * /me/today (CLAUDE.md §8, PLAN T15). Newcomer only (§10 row 1): the guard
 * sends manager / hr / ceo / admin to 403. `now` is read exactly once here
 * and every derivation gets the Taipei date computed from it; the Server
 * Action (`./actions`) reads its own `now` when the form is submitted.
 *
 * Data: active `newcomer_daily` version (null → 「目前沒有可用的日誌表單」),
 * today's log (edit mode), the previous log + its own version (yesterday's
 * plan, read by slot so an older version resolves too), the milestones
 * (stage / next milestone in the header). Tomorrow's three items shown after
 * a save are read from today's row on the re-render that follows the
 * action's `revalidatePath` (DECISIONS D-27).
 */
export default async function TodayPage() {
  const profile = await requireRole(["newcomer"], { next: TODAY_PATH });
  const now = new Date();
  const today = taipeiDateOf(now);

  const [activeVersion, existing, previousLog, milestones] = await Promise.all([
    getActiveVersion("newcomer_daily"),
    getLogByDate(profile.id, today),
    getPreviousLog(profile.id, today),
    listMilestones({ userId: profile.id }),
  ]);

  const header = (
    <NewcomerHeader
      displayName={profile.display_name}
      startDate={profile.start_date}
      milestones={milestones}
      today={today}
    />
  );
  const title = (
    <div className="flex items-baseline justify-between gap-2">
      <h1 className="text-xl font-semibold">今日日誌</h1>
      <p className="text-sm text-muted-foreground">{formatDate(today)}</p>
    </div>
  );

  if (!activeVersion) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        {title}
        <Alert>
          <AlertDescription>{NO_ACTIVE_FORM_MESSAGE}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const parsedActive = parseQuestions(activeVersion.questions);
  if (!parsedActive.ok) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        {title}
        <Alert variant="destructive">
          <AlertDescription>{ERROR_ACTIVE_VERSION_INVALID}</AlertDescription>
        </Alert>
      </div>
    );
  }
  const questions = parsedActive.questions;

  // Yesterday's plan: the previous log rendered with ITS version (§6).
  let yesterday: YesterdayInfo | null = null;
  let previousVersionMissing = false;
  if (previousLog) {
    const previousVersion = await getVersionById(previousLog.form_version_id);
    const parsedPrevious = previousVersion ? parseQuestions(previousVersion.questions) : null;
    const dateLabel = previousLog.log_date ? formatDate(previousLog.log_date, "M/d") : "";
    if (parsedPrevious?.ok) {
      yesterday = {
        dateLabel,
        plan: readYesterdayPlan(answersObject(previousLog.answers), parsedPrevious.questions),
      };
    } else {
      previousVersionMissing = true;
      yesterday = { dateLabel, plan: readYesterdayPlan(null, null) };
    }
  }

  // Today's row (edit mode) and the plan it holds (success card after a save).
  let initialAnswers: Answers | null = null;
  let savedPlan: YesterdayPlan | null = null;
  if (existing) {
    initialAnswers = toAnswers(existing.answers, questions);
    let existingQuestions: readonly Question[] = questions;
    if (existing.form_version_id !== activeVersion.id) {
      const existingVersion = await getVersionById(existing.form_version_id);
      const parsedExisting = existingVersion ? parseQuestions(existingVersion.questions) : null;
      existingQuestions = parsedExisting?.ok ? parsedExisting.questions : [];
    }
    savedPlan = readYesterdayPlan(answersObject(existing.answers), existingQuestions);
  }

  return (
    <div className="flex flex-col gap-4">
      {header}
      {title}
      {previousVersionMissing ? (
        <Alert variant="destructive">
          <AlertDescription>{ERROR_PREVIOUS_VERSION_MISSING}</AlertDescription>
        </Alert>
      ) : null}
      <TodayForm
        questions={questions}
        initialAnswers={initialAnswers}
        yesterday={yesterday}
        savedPlan={savedPlan}
        action={submitDailyLog}
      />
    </div>
  );
}
