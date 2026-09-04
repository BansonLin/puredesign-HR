import "server-only";

import { getAdminClient } from "@/lib/db/admin";
import type { Tables } from "@/lib/db/types";

export type Department = Tables<"departments">;

/**
 * All departments, ordered as they are displayed (`sort_order`, then `name`).
 * The only reader in Phase 1 is /hr 「近 7 日各部門統計」 and 新人總覽 (T24),
 * which need the department NAME that `profiles.department_id` alone cannot
 * give. Ordering is repeated in `departmentStats7d` (pure), so the rows may
 * arrive in any order; sorting here only keeps the raw list predictable.
 */
export async function listDepartments(): Promise<Department[]> {
  const { data } = await getAdminClient()
    .from("departments")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .throwOnError();
  return data;
}
