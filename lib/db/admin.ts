import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";

/**
 * Service-role Supabase client (PLAN 5.5).
 *
 * Which files may read SUPABASE_SERVICE_ROLE_KEY is defined by
 * ALLOWED_SECRET_FILES in tests/unit/secrets-boundary.test.ts (T03); that
 * list is the single source of truth and is not repeated here.
 * All business reads/writes go through this client: lib/db/queries, Server
 * Actions, Route Handlers and the seed script. Authorisation is never done
 * here; it lives in lib/auth/guard.ts.
 *
 * The client is created lazily so importing this module never throws at
 * build time when the env is not yet loaded.
 */
export type AdminClient = SupabaseClient<Database>;

let cached: AdminClient | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name} (see .env.example)`);
  }
  return value;
}

export function getAdminClient(): AdminClient {
  if (cached) return cached;
  cached = createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  return cached;
}
