import "server-only";

import { getAdminClient } from "@/lib/db/admin";
import type { Enums, Json, Tables } from "@/lib/db/types";

export type Submission = Tables<"submissions">;

/**
 * Daily-log queries (template_key = 'newcomer_daily').
 *
 * Dates are `YYYY-MM-DD` Taipei calendar dates computed by the caller with
 * lib/time; this layer only passes them to Postgres and never compares
 * clocks itself (PLAN T19 / CLAUDE.md §3 "derive on read").
 * Soft-deleted rows (deleted_at not null) are excluded unless stated.
 */

export async function getLogByDate(
  userId: string,
  logDate: string,
): Promise<Submission | null> {
  const { data } = await getAdminClient()
    .from("submissions")
    .select("*")
    .eq("template_key", "newcomer_daily")
    .eq("user_id", userId)
    .eq("log_date", logDate)
    .is("deleted_at", null)
    .maybeSingle()
    .throwOnError();
  return data;
}

/**
 * "Yesterday's plan" source (CLAUDE.md §6, PLAN A05 (6)): the newcomer's most
 * recent non-deleted log with log_date strictly before `beforeDate`.
 */
export async function getPreviousLog(
  userId: string,
  beforeDate: string,
): Promise<Submission | null> {
  const { data } = await getAdminClient()
    .from("submissions")
    .select("*")
    .eq("template_key", "newcomer_daily")
    .eq("user_id", userId)
    .lt("log_date", beforeDate)
    .is("deleted_at", null)
    .order("log_date", { ascending: false })
    .limit(1)
    .maybeSingle()
    .throwOnError();
  return data;
}

export async function listLogs(
  opts: {
    userId?: string;
    userIds?: string[];
    /** inclusive, YYYY-MM-DD */
    dateFrom?: string;
    /** inclusive, YYYY-MM-DD */
    dateTo?: string;
    /** default false: only rows with deleted_at is null */
    includeDeleted?: boolean;
  } = {},
): Promise<Submission[]> {
  if (opts.userIds && opts.userIds.length === 0) return [];
  let query = getAdminClient()
    .from("submissions")
    .select("*")
    .eq("template_key", "newcomer_daily");
  if (opts.userId) query = query.eq("user_id", opts.userId);
  if (opts.userIds) query = query.in("user_id", opts.userIds);
  if (opts.dateFrom) query = query.gte("log_date", opts.dateFrom);
  if (opts.dateTo) query = query.lte("log_date", opts.dateTo);
  if (!opts.includeDeleted) query = query.is("deleted_at", null);
  const { data } = await query
    .order("log_date", { ascending: false })
    .order("user_id", { ascending: true })
    .throwOnError();
  return data;
}

/** Manager responses (template_key = 'manager_response') targeting the given daily logs. */
export async function listResponsesForSubmissions(
  submissionIds: string[],
): Promise<Submission[]> {
  if (submissionIds.length === 0) return [];
  const { data } = await getAdminClient()
    .from("submissions")
    .select("*")
    .eq("template_key", "manager_response")
    .in("target_submission_id", submissionIds)
    .is("deleted_at", null)
    .order("submitted_at", { ascending: true })
    .throwOnError();
  return data;
}

/** Weekly feedback (template_key = 'weekly_feedback'); week_start is a Monday (YYYY-MM-DD). */
export async function listWeeklyFeedback(
  opts: {
    /** author (manager) */
    userId?: string;
    /** newcomer */
    targetUserId?: string;
    targetUserIds?: string[];
    weekStart?: string;
    /** inclusive, YYYY-MM-DD */
    weekStartFrom?: string;
    /** inclusive, YYYY-MM-DD */
    weekStartTo?: string;
  } = {},
): Promise<Submission[]> {
  if (opts.targetUserIds && opts.targetUserIds.length === 0) return [];
  let query = getAdminClient()
    .from("submissions")
    .select("*")
    .eq("template_key", "weekly_feedback")
    .is("deleted_at", null);
  if (opts.userId) query = query.eq("user_id", opts.userId);
  if (opts.targetUserId) query = query.eq("target_user_id", opts.targetUserId);
  if (opts.targetUserIds) query = query.in("target_user_id", opts.targetUserIds);
  if (opts.weekStart) query = query.eq("week_start", opts.weekStart);
  if (opts.weekStartFrom) query = query.gte("week_start", opts.weekStartFrom);
  if (opts.weekStartTo) query = query.lte("week_start", opts.weekStartTo);
  const { data } = await query
    .order("week_start", { ascending: false })
    .order("submitted_at", { ascending: false })
    .throwOnError();
  return data;
}

// ---------------------------------------------------------------------------
// Daily-log writes (PLAN T14 / 4.9.2)
// ---------------------------------------------------------------------------

export interface DailyLogInsert {
  user_id: string;
  form_version_id: string;
  /** YYYY-MM-DD (Taipei), from `prepareDailyLog`. */
  log_date: string;
  answers: Json;
  /** UTC ISO. */
  submitted_at: string;
  /** UTC ISO; defaults to `submitted_at`. */
  updated_at?: string;
  source?: Enums<"submission_source">;
}

export interface DailyLogUpdate {
  form_version_id: string;
  answers: Json;
  /** UTC ISO. */
  updated_at: string;
}

export const DAILY_LOG_EXISTS = "今天的日誌已存在";
export const DAILY_LOG_NOT_FOUND = "找不到要更新的日誌";

/**
 * Insert a new daily log. The natural key `(template_key, user_id, log_date)`
 * is looked up first (non-deleted rows) and an existing row throws
 * `DAILY_LOG_EXISTS` — never supabase-js `upsert`: the partial unique index
 * (`where deleted_at is null`) cannot be used as an ON CONFLICT target through
 * PostgREST (PLAN 4.9.2, D-06). A concurrent insert that slips between the
 * select and the insert is still rejected by the index (23505) and surfaces
 * as a thrown error for the caller to report.
 */
export async function insertDailyLog(input: DailyLogInsert): Promise<Submission> {
  const existing = await getLogByDate(input.user_id, input.log_date);
  if (existing) throw new Error(DAILY_LOG_EXISTS);

  const { data } = await getAdminClient()
    .from("submissions")
    .insert({
      template_key: "newcomer_daily",
      form_version_id: input.form_version_id,
      user_id: input.user_id,
      log_date: input.log_date,
      answers: input.answers,
      source: input.source ?? "app",
      submitted_at: input.submitted_at,
      updated_at: input.updated_at ?? input.submitted_at,
    })
    .select("*")
    .single()
    .throwOnError();
  return data;
}

/**
 * Update the answers of an existing (non-deleted) daily log found by
 * `getLogByDate`. `submitted_at`, `user_id` and `log_date` never change;
 * `form_version_id` is rewritten to the active version (§6: a resubmit always
 * uses the active version). Throws `DAILY_LOG_NOT_FOUND` when the id no
 * longer matches a live daily log (soft-deleted meanwhile).
 */
export async function updateDailyLog(
  id: string,
  patch: DailyLogUpdate,
): Promise<Submission> {
  const { data } = await getAdminClient()
    .from("submissions")
    .update({
      form_version_id: patch.form_version_id,
      answers: patch.answers,
      updated_at: patch.updated_at,
    })
    .eq("id", id)
    .eq("template_key", "newcomer_daily")
    .is("deleted_at", null)
    .select("*")
    .maybeSingle()
    .throwOnError();
  if (!data) throw new Error(DAILY_LOG_NOT_FOUND);
  return data;
}
