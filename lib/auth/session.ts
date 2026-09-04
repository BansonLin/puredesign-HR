import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { AuthError, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { Database } from "@/lib/db/types";

/**
 * Cookie-session Supabase client (PLAN 5.5).
 *
 * Uses the anon key + @supabase/ssr and ONLY talks to the Auth endpoints:
 * signInWithPassword / getUser / updateUser({ password }) / signOut.
 * It never queries a table (RLS is deny-all for anon/authenticated, so a
 * table query here would silently return zero rows). Business data goes
 * through lib/db/admin.ts; role checks live in lib/auth/guard.ts.
 *
 * "Session lasts 30 days" (CLAUDE.md §3) = cookie maxAge below + refresh
 * token rotation performed by middleware.ts (T07).
 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Accounts are registered as `{username}@pure.internal` (CLAUDE.md §3). */
export const AUTH_EMAIL_DOMAIN = "pure.internal";

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name} (see .env.example)`);
  }
  return value;
}

export async function createSessionClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component: cookies cannot be written there.
            // middleware.ts refreshes the session cookie instead (PLAN 5.5).
          }
        },
      },
      cookieOptions: { maxAge: SESSION_MAX_AGE_SECONDS },
    },
  );
}

export type AuthResult =
  | { user: User; error: null }
  | { user: null; error: AuthError };

export async function signInWithPassword(
  username: string,
  password: string,
): Promise<AuthResult> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });
  if (error) return { user: null, error };
  return { user: data.user, error: null };
}

/** Identity is always taken from getUser() (server-verified), never getSession(). */
export async function getSessionUser(): Promise<User | null> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

export async function updatePassword(password: string): Promise<AuthResult> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) return { user: null, error };
  return { user: data.user, error: null };
}

export async function signOut(): Promise<void> {
  const supabase = await createSessionClient();
  await supabase.auth.signOut();
}
