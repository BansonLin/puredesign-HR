import { execFileSync } from "node:child_process";
import { dirname } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FullConfig } from "@playwright/test";

import type { Database } from "@/lib/db/types";
import { taipeiDateOf } from "@/lib/time";
import { FIXTURE_NEWCOMERS } from "@seed/fixtures/fixture";

/**
 * Playwright global setup (PLAN T27).
 *
 * Every e2e run must start from the §11 seed exactly as `pnpm db:seed`
 * produces it, plus an empty "today": `flow.spec.ts` writes 洪湘庭's log for
 * the Taipei date the run happens on, so a second run on the same database
 * would otherwise find yesterday's leftovers (an already-answered alert, an
 * 「更新今日日誌」 button, a card count of 3). So this setup:
 *
 *   1. deletes the four seed newcomers' daily logs dated Taipei-today, the
 *      alerts hanging on them and the manager responses targeting them
 *      (that order: alerts reference the log, responses are referenced by
 *      `alerts.response_submission_id`, the log is referenced by both);
 *   2. runs `pnpm db:seed`, which is idempotent (fixed UUIDs + upsert) and
 *      therefore restores nothing but what step 1 removed — the §11 rows
 *      (9/2, 9/3, the two responses, the weekly feedback) are untouched —
 *      and resets `e2e_fresh`'s password and `must_change_password`
 *      (A01), which `first-login.spec.ts` consumes.
 *
 * It also owns the ONE service-role client the e2e suite may build:
 * Playwright runs without the `react-server` condition, so it cannot import
 * lib/db/admin.ts (`server-only`); `createServiceRoleClient()` is the single
 * exception allowed by tests/unit/secrets-boundary.test.ts (DECISIONS D-04),
 * and rls.spec.ts / first-login.spec.ts import it from here rather than
 * reading the key themselves.
 */
export type ServiceRoleClient = SupabaseClient<Database>;

const URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const ANON_KEY_ENV = "NEXT_PUBLIC_SUPABASE_ANON_KEY";
const SERVICE_ROLE_ENV = "SUPABASE_SERVICE_ROLE_KEY";

const NO_SESSION = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

/**
 * Is the Supabase stack configured for this run? The e2e suite needs a real
 * PostgREST + GoTrue (the supabase CLI local stack, PLAN A01); without
 * Docker there is none, and every spec skips instead of failing. In CI the
 * missing variable is an error, not a skip (see `globalSetup` below), so a
 * broken workflow can never report a green e2e job full of skipped tests.
 */
export function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env[URL_ENV] && process.env[ANON_KEY_ENV] && process.env[SERVICE_ROLE_ENV],
  );
}

/** The service-role client (§3: all data access is server-side, service role). */
export function createServiceRoleClient(): ServiceRoleClient {
  const url = process.env[URL_ENV];
  const key = process.env[SERVICE_ROLE_ENV];
  if (!url || !key) {
    throw new Error(`Missing environment variable ${URL_ENV} / ${SERVICE_ROLE_ENV}`);
  }
  return createClient<Database>(url, key, { auth: NO_SESSION });
}

/** Deletes today's (Taipei) daily logs of the four §11 newcomers and everything hanging on them. */
async function resetToday(db: ServiceRoleClient, today: string): Promise<number> {
  const userIds = FIXTURE_NEWCOMERS.map((newcomer) => newcomer.id);

  const { data: logs } = await db
    .from("submissions")
    .select("id")
    .eq("template_key", "newcomer_daily")
    .eq("log_date", today)
    .in("user_id", userIds)
    .throwOnError();

  const logIds = (logs ?? []).map((log) => log.id);
  if (logIds.length === 0) return 0;

  await db.from("alerts").delete().in("submission_id", logIds).throwOnError();
  await db.from("submissions").delete().in("target_submission_id", logIds).throwOnError();
  await db.from("submissions").delete().in("id", logIds).throwOnError();
  return logIds.length;
}

/**
 * The repo root, i.e. the directory holding playwright.config.ts.
 *
 * NOT `config.rootDir`: Playwright sets that to `<configDir>/<testDir>`
 * (here `<repo>/tests/e2e`), so passing it as the cwd of `pnpm db:seed` only
 * works by accident — pnpm walks up to the nearest package.json. The seed
 * script resolves its own paths relative to the cwd, so hand it the real root.
 */
function repoRoot(config: FullConfig): string {
  return config.configFile ? dirname(config.configFile) : process.cwd();
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  if (!hasSupabaseEnv()) {
    if (process.env.CI) {
      throw new Error(
        `e2e: ${URL_ENV} / ${ANON_KEY_ENV} / ${SERVICE_ROLE_ENV} 未設定；` +
          "CI 必須對 supabase CLI 本機堆疊執行（PLAN A01）",
      );
    }
    console.warn(
      "[e2e] Supabase 環境變數未設定（本機無 Docker 堆疊）：略過重設與 seed，測試會自行 skip。",
    );
    return;
  }

  const today = taipeiDateOf(new Date());
  const removed = await resetToday(createServiceRoleClient(), today);
  console.log(`[e2e] 已清除 ${today} 的 ${removed} 筆日誌（含預警與回應）`);

  execFileSync("pnpm", ["db:seed"], { cwd: repoRoot(config), stdio: "inherit" });
}
