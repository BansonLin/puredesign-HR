"use server";

import { forbidden } from "next/navigation";
import { revalidatePath } from "next/cache";

import type { FormActionState } from "@/components/forms/FormRenderer";
import { canAccessNewcomer, requireRole } from "@/lib/auth/guard";
import { getAdminClient } from "@/lib/db/admin";
import { getActiveVersion } from "@/lib/db/queries/forms";
import { getProfileByAuthId } from "@/lib/db/queries/profiles";
import { listWeeklyFeedback } from "@/lib/db/queries/submissions";
import type { Tables } from "@/lib/db/types";
import { FORM_ERROR_KEY, prepareWeeklyFeedback } from "@/lib/forms/submit";

const MANAGER_PATH = "/manager";
const WEEKLY_PATH = "/manager/weekly";

const NO_ACTIVE_FORM_MESSAGE = "目前沒有可用的週回饋表單";
const NO_NEWCOMER_MESSAGE = "請先選擇對象新人";
const LOAD_FAILED_MESSAGE = "目前無法送出，請聯絡人資";
const SAVE_FAILED_MESSAGE = "送出失敗，請重新整理頁面後再試一次";
const SAVED_MESSAGE = "已送出週回饋";

/** Canonical UUID shape of profiles.id (any casing); a malformed id never reaches PostgREST. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Submission = Tables<"submissions">;

/** Context the page binds with `submitWeeklyFeedback.bind(null, ctx)` (D-25). */
export interface WeeklyContext {
  /** The newcomer selected in the page's dropdown; null when nothing is selected. */
  newcomerId: string | null;
}

/**
 * Weekly-feedback submit handler (PLAN T22; §8 /manager/weekly, §10 row 4).
 *
 * Order: `requireRole(['manager','hr','admin'])` → the selected newcomer is
 * looked up by id and must pass `canAccessNewcomer` (§10 row 3; a manager
 * of another department, a non-newcomer or a malformed id → 403) →
 * `prepareWeeklyFeedback` (pure) applies `canRespond` (§10 row 4, hr /
 * admin on behalf), validates the answers against the `weekly_feedback`
 * active version, normalizes `week_start` to the Monday of the
 * `weekly.start_date` answer and finds the actor's existing row for that
 * week → write: the existing row is updated, otherwise a new row is inserted
 * (natural-key select first, never upsert, D-06; a concurrent duplicate is
 * rejected by the partial unique index and reported as a save failure) →
 * `revalidatePath` of /manager/weekly and the /manager cards (Friday
 * reminder). Errors come back as `FormActionState` for the renderer.
 */
export async function submitWeeklyFeedback(
  ctx: WeeklyContext,
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const actor = await requireRole(["manager", "hr", "admin"], { next: WEEKLY_PATH });

  if (ctx.newcomerId === null || ctx.newcomerId === "") {
    return { ok: false, message: NO_NEWCOMER_MESSAGE };
  }
  if (!UUID_RE.test(ctx.newcomerId)) forbidden();
  const newcomer = await getProfileByAuthId(ctx.newcomerId);
  if (!newcomer || !canAccessNewcomer(actor, newcomer)) forbidden();

  const now = new Date();

  let activeVersion: NonNullable<Awaited<ReturnType<typeof getActiveVersion>>>;
  let existingFeedback: Submission[];
  try {
    const version = await getActiveVersion("weekly_feedback");
    if (!version) return { ok: false, message: NO_ACTIVE_FORM_MESSAGE };
    activeVersion = version;
    existingFeedback = await listWeeklyFeedback({ userId: actor.id, targetUserId: newcomer.id });
  } catch (error) {
    console.error("submitWeeklyFeedback: loading failed", error);
    return { ok: false, message: LOAD_FAILED_MESSAGE };
  }

  const rawAnswers: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") rawAnswers[key] = value;
  }

  const prepared = prepareWeeklyFeedback({
    now,
    actor,
    newcomer,
    activeVersion,
    existingFeedback,
    rawAnswers,
  });

  if (!prepared.ok) {
    if (prepared.code === "forbidden") forbidden();
    const { [FORM_ERROR_KEY]: formMessage, ...errors } = prepared.errors;
    return { ok: false, errors, message: formMessage };
  }

  try {
    const db = getAdminClient();
    if (prepared.existing_id) {
      // Same (author, newcomer, week): answers + version + a fresh
      // `submitted_at`; `updated_at` is left to the DB trigger (D-29).
      await db
        .from("submissions")
        .update({
          form_version_id: prepared.form_version_id,
          answers: prepared.answers,
          submitted_at: prepared.submitted_at,
        })
        .eq("id", prepared.existing_id)
        .eq("template_key", "weekly_feedback")
        .is("deleted_at", null)
        .select("id")
        .single()
        .throwOnError();
    } else {
      await db
        .from("submissions")
        .insert({
          template_key: "weekly_feedback",
          form_version_id: prepared.form_version_id,
          user_id: prepared.user_id,
          target_user_id: prepared.target_user_id,
          week_start: prepared.week_start,
          answers: prepared.answers,
          source: "app",
          submitted_at: prepared.submitted_at,
          updated_at: prepared.updated_at,
        })
        .select("id")
        .single()
        .throwOnError();
    }
  } catch (error) {
    console.error("submitWeeklyFeedback failed", error);
    return { ok: false, message: SAVE_FAILED_MESSAGE };
  }

  revalidatePath(WEEKLY_PATH);
  revalidatePath(MANAGER_PATH);
  return { ok: true, message: SAVED_MESSAGE };
}
