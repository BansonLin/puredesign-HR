import "server-only";

import { getAdminClient } from "@/lib/db/admin";
import type { Json } from "@/lib/db/types";

/** The four required settings rows (CLAUDE.md §5, PLAN 4.8); inserted by `seed --base`. */
export const SETTING_KEYS = [
  "daily_cutoff_time",
  "response_threshold_hours",
  "rules",
  "workweek",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/** Raw jsonb per key. Shape validation is deliberately not done here. */
export type RawSettings = Record<SettingKey, Json>;

export const SETTINGS_NOT_INITIALIZED = "settings 未初始化，請執行 seed --base";

/**
 * Reads exactly the four required rows and returns their jsonb untouched.
 * Any missing row throws (no silent defaults, PLAN 4.8). The `rules` shape is
 * validated by lib/rules/settings.ts (T11); `daily_cutoff_time` /
 * `response_threshold_hours` / `workweek` by their consumers.
 */
export async function getSettings(): Promise<RawSettings> {
  const { data } = await getAdminClient()
    .from("settings")
    .select("key, value")
    .in("key", [...SETTING_KEYS])
    .throwOnError();

  const byKey = new Map(data.map((row) => [row.key, row.value] as const));
  const missing = SETTING_KEYS.filter((key) => !byKey.has(key));
  if (missing.length > 0) {
    throw new Error(`${SETTINGS_NOT_INITIALIZED}（缺少：${missing.join("、")}）`);
  }

  return {
    daily_cutoff_time: byKey.get("daily_cutoff_time") as Json,
    response_threshold_hours: byKey.get("response_threshold_hours") as Json,
    rules: byKey.get("rules") as Json,
    workweek: byKey.get("workweek") as Json,
  };
}
