import "server-only";

import { getAdminClient } from "@/lib/db/admin";
import type { Enums, Json, Tables } from "@/lib/db/types";
import type { ExistingAlertLike, ReconcileResult } from "@/lib/rules/types";

export type Alert = Tables<"alerts">;
export type AlertStatus = Enums<"alert_status">;

/** The daily log an alert hangs on (subset of submissions columns). */
export type AlertSubmission = Pick<
  Tables<"submissions">,
  "id" | "user_id" | "log_date" | "submitted_at" | "form_version_id"
>;

export type AlertWithSubmission = Alert & { submission: AlertSubmission };

/**
 * The ONE way to read alerts (PLAN A05 (1)): always an inner join on
 * submissions with `deleted_at is null`, so alerts of soft-deleted logs never
 * surface anywhere (dashboard, timeline, metrics). Callers must not aggregate
 * from alerts.user_id on their own.
 *
 * Time-based states (overdue / late) are NOT computed here; pass rows to
 * lib/rules/derived.ts with an injected clock.
 */
export async function listAlertsWithSubmission(
  opts: {
    /** newcomer ids (alerts.user_id === submissions.user_id) */
    userIds?: string[];
    submissionIds?: string[];
    statuses?: AlertStatus[];
    /** inclusive, YYYY-MM-DD, on the log's log_date */
    logDateFrom?: string;
    /** inclusive, YYYY-MM-DD, on the log's log_date */
    logDateTo?: string;
  } = {},
): Promise<AlertWithSubmission[]> {
  if (opts.userIds && opts.userIds.length === 0) return [];
  if (opts.submissionIds && opts.submissionIds.length === 0) return [];
  if (opts.statuses && opts.statuses.length === 0) return [];

  let query = getAdminClient()
    .from("alerts")
    .select(
      "*, submissions!alerts_submission_id_fkey!inner(id, user_id, log_date, submitted_at, form_version_id)",
    )
    .is("submissions.deleted_at", null);
  if (opts.userIds) query = query.in("user_id", opts.userIds);
  if (opts.submissionIds) query = query.in("submission_id", opts.submissionIds);
  if (opts.statuses) query = query.in("status", opts.statuses);
  if (opts.logDateFrom) query = query.gte("submissions.log_date", opts.logDateFrom);
  if (opts.logDateTo) query = query.lte("submissions.log_date", opts.logDateTo);

  const { data } = await query
    .order("created_at", { ascending: false })
    .throwOnError();

  return data.map(({ submissions, ...alert }) => ({
    ...alert,
    submission: submissions,
  }));
}

// ---------------------------------------------------------------------------
// Reconcile input / output (PLAN T14, A10)
// ---------------------------------------------------------------------------

/**
 * Every `alerts` row of one submission, all statuses — the `existing` input
 * of `reconcile` (lib/rules/run.ts). This is a write-path read on a
 * submission the caller has already loaded live (`getLogByDate`), not a
 * display read, so the A05 (1) join is not needed here.
 */
export async function listAlertsForSubmission(submissionId: string): Promise<Alert[]> {
  const { data } = await getAdminClient()
    .from("alerts")
    .select("*")
    .eq("submission_id", submissionId)
    .order("rule_key", { ascending: true })
    .throwOnError();
  return data;
}

export interface ApplyAlertChangesTarget {
  submissionId: string;
  /** The newcomer (alerts.user_id = submissions.user_id). */
  userId: string;
}

export interface ApplyAlertChangesResult {
  inserted: number;
  updated: number;
  closed: number;
  reopened: number;
}

/**
 * Persist a `ReconcileResult` (A10 state machine) for one submission — the
 * only writer of `alerts` besides the manager-response path (T18) and the
 * HR data page (Phase 2). Called by the /me/today Server Action and the seed.
 *
 *   insert       → status 'open', created_at = plan.created_at (= the log's
 *                  submitted_at), responded_* / closed_* null. Written with
 *                  ON CONFLICT (submission_id, rule_key) DO NOTHING: a row that
 *                  appeared between the reconcile read and this write is left
 *                  as the other writer stored it (never downgraded to open);
 *                  `inserted` counts the rows PostgREST actually returned.
 *   updateDetail → only `detail`.
 *   close        → status 'closed', closed_at, closed_by null, closed_reason 'resubmitted'.
 *   reopen       → status 'open', detail, created_at = plan.created_at,
 *                  responded_at / response_submission_id / closed_* null.
 *   untouched    → no write.
 *
 * Writes go one row at a time through PostgREST (no transaction, D-26); the
 * submission row is written before this is called, so a failure here leaves
 * the log saved and the next resubmit or HR 「重跑」 repairs the alerts.
 */
export async function applyAlertChanges(
  plan: ReconcileResult<Pick<Alert, "id"> & ExistingAlertLike>,
  target: ApplyAlertChangesTarget,
): Promise<ApplyAlertChangesResult> {
  const db = getAdminClient();
  const result: ApplyAlertChangesResult = { inserted: 0, updated: 0, closed: 0, reopened: 0 };

  if (plan.insert.length > 0) {
    const rows = plan.insert.map((item) => ({
      submission_id: target.submissionId,
      user_id: target.userId,
      rule_key: item.rule_key,
      detail: item.detail as unknown as Json,
      status: "open" as const,
      created_at: item.created_at,
      responded_at: null,
      response_submission_id: null,
      closed_at: null,
      closed_by: null,
      closed_reason: null,
    }));
    // With ignoreDuplicates (DO NOTHING) PostgREST returns only the rows that
    // were actually written, so `inserted` counts those, not the attempts.
    const { data } = await db
      .from("alerts")
      .upsert(rows, { onConflict: "submission_id,rule_key", ignoreDuplicates: true })
      .select("id")
      .throwOnError();
    result.inserted = data.length;
  }

  for (const item of plan.updateDetail) {
    await db
      .from("alerts")
      .update({ detail: item.detail as unknown as Json })
      .eq("id", item.alert.id)
      .throwOnError();
    result.updated += 1;
  }

  for (const item of plan.close) {
    await db
      .from("alerts")
      .update({
        status: "closed",
        closed_at: item.closed_at,
        closed_by: null,
        closed_reason: item.closed_reason,
      })
      .eq("id", item.alert.id)
      .throwOnError();
    result.closed += 1;
  }

  for (const item of plan.reopen) {
    await db
      .from("alerts")
      .update({
        status: "open",
        detail: item.detail as unknown as Json,
        created_at: item.created_at,
        responded_at: null,
        response_submission_id: null,
        closed_at: null,
        closed_by: null,
        closed_reason: null,
      })
      .eq("id", item.alert.id)
      .throwOnError();
    result.reopened += 1;
  }

  return result;
}
