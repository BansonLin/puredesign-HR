import "server-only";

import { getAdminClient } from "@/lib/db/admin";
import type { Enums, Tables } from "@/lib/db/types";

export type Profile = Tables<"profiles">;
export type UserRole = Enums<"user_role">;
export type ProfileStatus = Enums<"profile_status">;

/** profiles.id === auth.users.id; returns null when the auth user has no profile yet. */
export async function getProfileByAuthId(
  authUserId: string,
): Promise<Profile | null> {
  const { data } = await getAdminClient()
    .from("profiles")
    .select("*")
    .eq("id", authUserId)
    .maybeSingle()
    .throwOnError();
  return data;
}

/**
 * The single population for every dashboard list and metric (PLAN A02):
 * role='newcomer' and status='active'. `left` and `sample` (e2e_fresh) are
 * excluded here and only here; guard.ts does not filter by status.
 */
export async function activeNewcomers(
  opts: { departmentId?: string } = {},
): Promise<Profile[]> {
  let query = getAdminClient()
    .from("profiles")
    .select("*")
    .eq("role", "newcomer")
    .eq("status", "active");
  if (opts.departmentId) {
    query = query.eq("department_id", opts.departmentId);
  }
  const { data } = await query
    .order("start_date", { ascending: true, nullsFirst: false })
    .order("display_name", { ascending: true })
    .throwOnError();
  return data;
}

export async function listProfiles(
  opts: {
    role?: UserRole;
    status?: ProfileStatus;
    departmentId?: string;
  } = {},
): Promise<Profile[]> {
  let query = getAdminClient().from("profiles").select("*");
  if (opts.role) query = query.eq("role", opts.role);
  if (opts.status) query = query.eq("status", opts.status);
  if (opts.departmentId) query = query.eq("department_id", opts.departmentId);
  const { data } = await query
    .order("role", { ascending: true })
    .order("display_name", { ascending: true })
    .throwOnError();
  return data;
}
