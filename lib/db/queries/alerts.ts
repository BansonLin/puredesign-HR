import "server-only";

import { getAdminClient } from "@/lib/db/admin";
import type { Enums, Tables } from "@/lib/db/types";

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
