import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * CLAUDE.md §3 / PLAN 4.5: RLS is enabled on every table with zero policies
 * and anon/authenticated grants revoked, so the anon key and a logged-in
 * user's token must never read business data — only the service role can.
 *
 * Runs against the supabase CLI local stack in CI (PLAN A01). Skipped when the
 * Supabase environment is not set (no Docker locally, no staging keys in CI).
 *
 * Playwright cannot import lib/db/admin.ts (`server-only` has no
 * `react-server` condition here), so the clients are built inline. Reading
 * SUPABASE_SERVICE_ROLE_KEY here is a TEMPORARY exception to PLAN T03 / 5.5
 * (tests/unit/secrets-boundary.test.ts, DECISIONS D-04): once T27 adds
 * tests/e2e/global-setup.ts, import its `createServiceRoleClient()` helper
 * instead and drop this file from the allow-list.
 */
const TABLES = [
  "departments",
  "profiles",
  "form_templates",
  "form_versions",
  "submissions",
  "alerts",
  "milestones",
  "settings",
  "audit_log",
] as const;

const PERMISSION_DENIED = "42501";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const noSession = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

async function expectDenied(client: SupabaseClient, table: string) {
  const { data, error } = await client.from(table).select("*").limit(5);
  if (error) {
    expect(error.code, `${table}: ${error.message}`).toBe(PERMISSION_DENIED);
  } else {
    expect(data, `${table}: rows leaked`).toEqual([]);
  }
}

test.describe("RLS deny-all (anon / authenticated / service role)", () => {
  test.skip(
    !url || !anonKey || !serviceRoleKey,
    "NEXT_PUBLIC_SUPABASE_URL / anon key / service role key not set",
  );

  test("anon key reads 0 rows or 42501 on all nine tables", async () => {
    const anon = createClient(url!, anonKey!, { auth: noSession });
    for (const table of TABLES) {
      await expectDenied(anon, table);
    }
  });

  test("authenticated token reads 0 rows or 42501 on all nine tables", async () => {
    const admin = createClient(url!, serviceRoleKey!, { auth: noSession });
    const email = `rls_probe_${Date.now()}@pure.internal`;
    const password = `Probe-${Math.random().toString(36).slice(2)}-${Date.now()}`;

    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(created.error, created.error?.message).toBeNull();
    const userId = created.data.user!.id;

    try {
      const user = createClient(url!, anonKey!, { auth: noSession });
      const signedIn = await user.auth.signInWithPassword({ email, password });
      expect(signedIn.error, signedIn.error?.message).toBeNull();
      expect(signedIn.data.session?.access_token).toBeTruthy();

      // Query with the user's JWT explicitly, independent of client state.
      const authed = createClient(url!, anonKey!, {
        auth: noSession,
        global: {
          headers: {
            Authorization: `Bearer ${signedIn.data.session!.access_token}`,
          },
        },
      });
      for (const table of TABLES) {
        await expectDenied(authed, table);
      }
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("service role can read all nine tables", async () => {
    const admin = createClient(url!, serviceRoleKey!, { auth: noSession });
    for (const table of TABLES) {
      const { data, error } = await admin.from(table).select("*").limit(1);
      expect(error, `${table}: ${error?.message}`).toBeNull();
      expect(Array.isArray(data), `${table}: no data array`).toBe(true);
    }
  });
});
