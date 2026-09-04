"use server";

import { forbidden } from "next/navigation";
import { revalidatePath } from "next/cache";

import type { FormActionState } from "@/components/forms/FormRenderer";
import { canRespond, requireNewcomerAccess } from "@/lib/auth/guard";
import { getAdminClient } from "@/lib/db/admin";
import { listAlertsForSubmission, markAlertsResponded } from "@/lib/db/queries/alerts";
import { getActiveVersion } from "@/lib/db/queries/forms";
import type { Tables } from "@/lib/db/types";
import { FORM_ERROR_KEY, prepareResponse } from "@/lib/forms/submit";

const MANAGER_PATH = "/manager";

const NO_ACTIVE_FORM_MESSAGE = "目前沒有可用的回應表單";
const LOAD_FAILED_MESSAGE = "目前無法送出，請聯絡人資";
const SAVE_FAILED_MESSAGE = "送出失敗，請重新整理頁面後再試一次";
const SAVED_MESSAGE = "已送出回應";

/** Canonical UUID shape of submissions.id (any casing); a malformed id never reaches PostgREST. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Submission = Tables<"submissions">;

/** Context the page binds with `submitManagerResponse.bind(null, ctx)` (D-25). */
export interface ResponseContext {
  /** The newcomer of the page (`/manager/newcomer/[id]`). */
  newcomerId: string;
  /** The daily log the response targets; re-checked server-side against the newcomer. */
  targetSubmissionId: string;
}

/** The daily log a response targets, by id (any status; `prepareResponse` rejects deleted / foreign rows). */
async function getLogById(id: string): Promise<Submission | null> {
  const { data } = await getAdminClient()
    .from("submissions")
    .select("*")
    .eq("id", id)
    .maybeSingle()
    .throwOnError();
  return data;
}

/**
 * Natural key of a manager response: the responder's non-deleted row on the
 * same log. The key has no unique index yet (D-35), so a double submit from
 * two tabs can leave two rows; every row is read, the earliest is the one
 * updated and the duplicate is logged for HR data maintenance (/admin/data).
 */
async function getResponseByResponder(
  userId: string,
  targetSubmissionId: string,
): Promise<Submission | null> {
  const { data } = await getAdminClient()
    .from("submissions")
    .select("*")
    .eq("template_key", "manager_response")
    .eq("user_id", userId)
    .eq("target_submission_id", targetSubmissionId)
    .is("deleted_at", null)
    .order("submitted_at", { ascending: true })
    .throwOnError();
  if (data.length > 1) {
    console.warn(
      `submitManagerResponse: ${data.length} responses by ${userId} on log ${targetSubmissionId} (natural key not unique); updating the earliest ${data[0].id}`,
    );
  }
  return data[0] ?? null;
}

interface LoadedContext {
  activeVersion: NonNullable<Awaited<ReturnType<typeof getActiveVersion>>>;
  targetLog: Submission | null;
  existingResponse: Submission | null;
  alerts: Awaited<ReturnType<typeof listAlertsForSubmission>>;
}

/**
 * Manager-response submit handler (PLAN T18; §7 「主管回應」, §10 row 4, A04).
 *
 * Order: `requireNewcomerAccess` (viewer roles, §10 row 3; non-UUID → 403)
 * → `canRespond` (§10 row 4: manager same department, hr / admin on behalf,
 * ceo / left target → 403) → the target log is looked up by the client's
 * `targetSubmissionId` and `prepareResponse` (pure) checks it belongs to
 * THIS newcomer, validates the answers against the `manager_response`
 * active version and plans the alert change → write: the responder's
 * existing row on the same log is updated, otherwise a new row is inserted
 * (natural-key select first, never upsert, D-06; a re-send also refreshes
 * `submitted_at`, A04) → the `open` alerts `prepareResponse` planned become
 * `responded` (`markAlertsResponded` with the plan's ids, still guarded by
 * `status='open'`; `responded` / `closed` untouched) → `revalidatePath` of
 * the timeline and the /manager cards. `on_behalf` is not stored; display
 * derives it from the responder's role (D-35). Errors come back as
 * `FormActionState` for the renderer.
 */
export async function submitManagerResponse(
  ctx: ResponseContext,
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const { actor, newcomer } = await requireNewcomerAccess(ctx.newcomerId);
  if (!canRespond(actor, newcomer).allowed) forbidden();

  const now = new Date();

  let loaded: LoadedContext;
  try {
    const activeVersion = await getActiveVersion("manager_response");
    if (!activeVersion) return { ok: false, message: NO_ACTIVE_FORM_MESSAGE };

    const targetId = UUID_RE.test(ctx.targetSubmissionId) ? ctx.targetSubmissionId : null;
    const [targetLog, existingResponse, alerts] = targetId
      ? await Promise.all([
          getLogById(targetId),
          getResponseByResponder(actor.id, targetId),
          listAlertsForSubmission(targetId),
        ])
      : [null, null, []];
    loaded = { activeVersion, targetLog, existingResponse, alerts };
  } catch (error) {
    console.error("submitManagerResponse: loading failed", error);
    return { ok: false, message: LOAD_FAILED_MESSAGE };
  }

  const rawAnswers: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") rawAnswers[key] = value;
  }

  const prepared = prepareResponse({
    now,
    actor,
    newcomer,
    targetLog: loaded.targetLog,
    activeVersion: loaded.activeVersion,
    existingResponse: loaded.existingResponse,
    alerts: loaded.alerts,
    rawAnswers,
  });

  if (!prepared.ok) {
    if (prepared.code === "forbidden") forbidden();
    const { [FORM_ERROR_KEY]: formMessage, ...errors } = prepared.errors;
    return { ok: false, errors, message: formMessage };
  }

  try {
    const db = getAdminClient();
    let saved: Submission;
    if (prepared.existing_id) {
      // Re-send: answers + version + a fresh `submitted_at` (the A04 window
      // starts at the re-send, D-35); `updated_at` is left to the DB trigger.
      const { data } = await db
        .from("submissions")
        .update({
          form_version_id: prepared.form_version_id,
          answers: prepared.answers,
          submitted_at: prepared.submitted_at,
        })
        .eq("id", prepared.existing_id)
        .eq("template_key", "manager_response")
        .is("deleted_at", null)
        .select("*")
        .single()
        .throwOnError();
      saved = data;
    } else {
      const { data } = await db
        .from("submissions")
        .insert({
          template_key: "manager_response",
          form_version_id: prepared.form_version_id,
          user_id: prepared.user_id,
          target_user_id: prepared.target_user_id,
          target_submission_id: prepared.target_submission_id,
          answers: prepared.answers,
          source: "app",
          submitted_at: prepared.submitted_at,
          updated_at: prepared.updated_at,
        })
        .select("*")
        .single()
        .throwOnError();
      saved = data;
    }

    // The pure plan decides which rows change; the query keeps `status='open'` as a guard.
    await markAlertsResponded(
      prepared.target_submission_id,
      saved.id,
      prepared.responded_at,
      prepared.alertPlan.respond.map((alert) => alert.id),
    );
  } catch (error) {
    console.error("submitManagerResponse failed", error);
    return { ok: false, message: SAVE_FAILED_MESSAGE };
  }

  revalidatePath(`${MANAGER_PATH}/newcomer/${newcomer.id}`);
  revalidatePath(MANAGER_PATH);
  return { ok: true, message: SAVED_MESSAGE };
}
