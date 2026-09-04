import "server-only";

import { forbidden, redirect } from "next/navigation";

import { getSessionUser, signOut } from "@/lib/auth/session";
import { getProfileByAuthId, type Profile } from "@/lib/db/queries/profiles";

import {
  can,
  canAccessNewcomer,
  canRespond,
  type Action,
  type ActionContext,
  type Actor,
  type NewcomerRef,
  type RespondDecision,
  type UserRole,
} from "./policy";

/**
 * Session-aware wrapper around the §10 matrix (PLAN T08 / 5.5 / A02).
 *
 * Every page, Server Action and Route Handler outside app/(auth) must call
 * `requireRole()` or `requireNewcomerAccess()` (enforced statically by
 * tests/unit/guard-coverage.test.ts). The pure matrix lives in
 * lib/auth/policy.ts and is re-exported here so callers import one module.
 *
 * Flow of `requireRole`:
 *   no session            → redirect /login (with ?next= when the caller passes it)
 *   session but no profile→ signOut (best-effort), redirect /login?reason=no_profile
 *   status='left'         → signOut (best-effort), redirect /login?reason=disabled (A02)
 *   must_change_password  → redirect /login/change-password (T07 route)
 *   role not in `roles`   → forbidden() → 403 + app/forbidden.tsx (D-13)
 *   status='sample'       → allowed like active (A02; only excluded from
 *                           activeNewcomers()).
 */
export { can, canAccessNewcomer, canRespond };
export type {
  Action,
  ActionContext,
  Actor,
  NewcomerRef,
  RespondDecision,
  UserRole,
};

export const LOGIN_PATH = "/login";
export const CHANGE_PASSWORD_PATH = "/login/change-password";

export interface RequireRoleOptions {
  /**
   * Path to return to after login; appended as `?next=`. Server Components
   * cannot read their own URL, so the caller passes it when it wants the
   * round-trip (middleware.ts already does this for unauthenticated hits).
   */
  next?: string;
  /**
   * Only for the change-password page itself: skip the
   * `must_change_password` redirect so it does not loop onto itself.
   */
  allowPasswordChangePending?: boolean;
}

function loginUrl(params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return query ? `${LOGIN_PATH}?${query}` : LOGIN_PATH;
}

/** Canonical UUID shape of profiles.id (any casing). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Signing out is best-effort: from a Server Component the cookie store is
 * read-only (lib/auth/session.ts swallows that) and Supabase may be
 * unreachable; the redirect that follows must happen either way — the stale
 * session is replaced by the next successful login (DECISIONS D-21).
 */
async function bestEffortSignOut(): Promise<void> {
  try {
    await signOut();
  } catch {
    // ignored on purpose: the caller redirects right after this
  }
}

/**
 * Resolve the signed-in profile and assert its role is one of `roles`.
 * Returns the full profile row for the page to use.
 */
export async function requireRole(
  roles: readonly UserRole[],
  opts: RequireRoleOptions = {},
): Promise<Profile> {
  const user = await getSessionUser();
  if (!user) {
    redirect(opts.next ? loginUrl({ next: opts.next }) : LOGIN_PATH);
  }

  const profile = await getProfileByAuthId(user.id);
  if (!profile) {
    await bestEffortSignOut();
    redirect(loginUrl({ reason: "no_profile" }));
  }

  if (profile.status === "left") {
    await bestEffortSignOut();
    redirect(loginUrl({ reason: "disabled" }));
  }

  if (profile.must_change_password && !opts.allowPasswordChangePending) {
    redirect(CHANGE_PASSWORD_PATH);
  }

  if (!roles.includes(profile.role)) {
    forbidden();
  }

  return profile;
}

/** Roles that may open a newcomer detail page at all (§10 row 3). */
const NEWCOMER_VIEWER_ROLES: readonly UserRole[] = [
  "manager",
  "hr",
  "ceo",
  "admin",
];

/**
 * `requireRole` for the newcomer-detail routes (/manager/newcomer/[id],
 * /hr/newcomer/[id], CSV export): the actor must be a viewer role and
 * `canAccessNewcomer(actor, newcomer)` must hold, otherwise 403. An id that
 * is not shaped like a UUID is treated as an unknown newcomer (403) before
 * any query, so PostgREST never sees it (22P02 would surface as a 500).
 * Returns both profiles so the page does not re-query them.
 */
export async function requireNewcomerAccess(
  newcomerId: string,
  opts: RequireRoleOptions = {},
): Promise<{ actor: Profile; newcomer: Profile }> {
  const actor = await requireRole(NEWCOMER_VIEWER_ROLES, opts);
  if (!UUID_RE.test(newcomerId)) forbidden();
  const newcomer = await getProfileByAuthId(newcomerId);
  if (!newcomer || !canAccessNewcomer(actor, newcomer)) {
    forbidden();
  }
  return { actor, newcomer };
}
