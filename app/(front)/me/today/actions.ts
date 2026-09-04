"use server";

import { forbidden } from "next/navigation";
import { revalidatePath } from "next/cache";

import type { FormActionState } from "@/components/forms/FormRenderer";
import { can, requireRole } from "@/lib/auth/guard";
import { listAlertsForSubmission, applyAlertChanges } from "@/lib/db/queries/alerts";
import { getActiveVersion, getVersionById } from "@/lib/db/queries/forms";
import { getSettings } from "@/lib/db/queries/settings";
import {
  getLogByDate,
  getPreviousLog,
  insertDailyLog,
  updateDailyLog,
} from "@/lib/db/queries/submissions";
import { FORM_ERROR_KEY, prepareDailyLog } from "@/lib/forms/submit";
import { parseRulesSettings } from "@/lib/rules/settings";
import { taipeiDateOf } from "@/lib/time";

const TODAY_PATH = "/me/today";

const NO_ACTIVE_FORM_MESSAGE = "目前沒有可用的日誌表單";
const SAVE_FAILED_MESSAGE = "儲存失敗，請重新整理頁面後再試一次";
const SAVED_MESSAGE = "已儲存今日日誌";

/**
 * /me/today submit handler (PLAN T14 / T15; §8).
 *
 * Only the newcomer themself may write their log (§10 row 1). Everything the
 * pure `prepareDailyLog` needs is loaded here with the SAME `now`, so the
 * Taipei log_date used to look up today's row is the one the pipeline
 * computes. Write order: submission (natural-key select in `getLogByDate`
 * → insert / update by id) then alerts (`applyAlertChanges`). Errors are
 * returned as `FormActionState` for the renderer: question errors under
 * their question, `_form` errors as the top message.
 */
export async function submitDailyLog(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const actor = await requireRole(["newcomer"]);
  if (!can(actor, "log:write_own", { newcomer: actor })) forbidden();

  const now = new Date();
  const logDate = taipeiDateOf(now);

  const activeVersion = await getActiveVersion("newcomer_daily");
  if (!activeVersion) return { ok: false, message: NO_ACTIVE_FORM_MESSAGE };

  const [existingRow, previousLog, rawSettings] = await Promise.all([
    getLogByDate(actor.id, logDate),
    getPreviousLog(actor.id, logDate),
    getSettings(),
  ]);
  const [existingAlerts, previousVersion] = await Promise.all([
    existingRow ? listAlertsForSubmission(existingRow.id) : Promise.resolve([]),
    previousLog ? getVersionById(previousLog.form_version_id) : Promise.resolve(null),
  ]);

  const rawAnswers: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") rawAnswers[key] = value;
  }

  const prepared = prepareDailyLog({
    now,
    actor,
    activeVersion,
    existingToday: existingRow ? { ...existingRow, alerts: existingAlerts } : null,
    previousLog,
    previousVersion,
    rawAnswers,
    settings: parseRulesSettings(rawSettings.rules),
  });

  if (!prepared.ok) {
    const { [FORM_ERROR_KEY]: formMessage, ...errors } = prepared.errors;
    return { ok: false, errors, message: formMessage };
  }

  try {
    const saved = prepared.existing_id
      ? await updateDailyLog(prepared.existing_id, {
          form_version_id: prepared.form_version_id,
          answers: prepared.answers,
          updated_at: prepared.updated_at,
        })
      : await insertDailyLog({
          user_id: prepared.user_id,
          form_version_id: prepared.form_version_id,
          log_date: prepared.log_date,
          answers: prepared.answers,
          submitted_at: prepared.submitted_at,
          updated_at: prepared.updated_at,
        });

    await applyAlertChanges(prepared.alertPlan, {
      submissionId: saved.id,
      userId: saved.user_id,
    });
  } catch (error) {
    console.error("submitDailyLog failed", error);
    return { ok: false, message: SAVE_FAILED_MESSAGE };
  }

  revalidatePath(TODAY_PATH);
  return { ok: true, message: SAVED_MESSAGE };
}
