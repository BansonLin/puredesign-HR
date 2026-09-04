import "server-only";

import { getAdminClient } from "@/lib/db/admin";
import type { Enums, Tables } from "@/lib/db/types";

export type Milestone = Tables<"milestones">;
export type MilestoneKind = Enums<"milestone_kind">;

/**
 * D30 / D60 / D90 rows. `dueFrom` / `dueTo` are Taipei dates (YYYY-MM-DD)
 * computed by the caller with lib/time; "overdue" / "next milestone" are
 * derived by lib/time (PLAN A09), not here.
 */
export async function listMilestones(
  opts: {
    userId?: string;
    userIds?: string[];
    kind?: MilestoneKind;
    /** inclusive, YYYY-MM-DD */
    dueFrom?: string;
    /** inclusive, YYYY-MM-DD */
    dueTo?: string;
    /** only rows with done_at is null */
    pendingOnly?: boolean;
  } = {},
): Promise<Milestone[]> {
  if (opts.userIds && opts.userIds.length === 0) return [];
  let query = getAdminClient().from("milestones").select("*");
  if (opts.userId) query = query.eq("user_id", opts.userId);
  if (opts.userIds) query = query.in("user_id", opts.userIds);
  if (opts.kind) query = query.eq("kind", opts.kind);
  if (opts.dueFrom) query = query.gte("due_date", opts.dueFrom);
  if (opts.dueTo) query = query.lte("due_date", opts.dueTo);
  if (opts.pendingOnly) query = query.is("done_at", null);
  const { data } = await query
    .order("due_date", { ascending: true })
    .order("user_id", { ascending: true })
    .throwOnError();
  return data;
}
