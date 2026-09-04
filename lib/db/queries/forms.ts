import "server-only";

import { getAdminClient } from "@/lib/db/admin";
import type { Tables } from "@/lib/db/types";

export type FormTemplate = Tables<"form_templates">;
export type FormVersion = Tables<"form_versions">;

/** The three fixed template keys (CLAUDE.md §5). */
export type FormTemplateKey =
  | "newcomer_daily"
  | "manager_response"
  | "weekly_feedback";

/**
 * The version currently pointed to by form_templates.active_version_id
 * (CLAUDE.md §6: rendering always uses the active version). Returns null
 * when the template does not exist or nothing has been published yet;
 * `questions` is raw jsonb — parse it with lib/forms/schema.ts.
 */
export async function getActiveVersion(
  key: FormTemplateKey,
): Promise<FormVersion | null> {
  const { data: template } = await getAdminClient()
    .from("form_templates")
    .select("active_version_id")
    .eq("key", key)
    .maybeSingle()
    .throwOnError();
  if (!template?.active_version_id) return null;
  return getVersionById(template.active_version_id);
}

/** Historical submissions always render with their own version (CLAUDE.md §6). */
export async function getVersionById(
  versionId: string,
): Promise<FormVersion | null> {
  const { data } = await getAdminClient()
    .from("form_versions")
    .select("*")
    .eq("id", versionId)
    .maybeSingle()
    .throwOnError();
  return data;
}
