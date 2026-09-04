"use server";

import { redirect } from "next/navigation";

import { homeFor, safeNextPath } from "@/lib/auth/home";
import { signInWithPassword, signOut } from "@/lib/auth/session";
import { getProfileByAuthId } from "@/lib/db/queries/profiles";

const LOGIN_PATH = "/login";
const CHANGE_PASSWORD_PATH = "/login/change-password";

function loginUrl(params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return query ? `${LOGIN_PATH}?${query}` : LOGIN_PATH;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * /login form handler (PLAN T07).
 *
 * - username is trimmed + lower-cased and registered as
 *   `{username}@pure.internal` (session.ts builds the address).
 * - every sign-in failure shows the same message (帳號或密碼錯誤): the page
 *   never reveals whether the account exists.
 * - status='left'   → signOut, /login?reason=disabled (PLAN A02)
 * - no profile row  → signOut, /login?reason=no_profile
 * - must_change_password → /login/change-password
 * - otherwise       → safe `next` (from middleware) or homeFor(role)
 */
export async function login(formData: FormData): Promise<void> {
  const username = field(formData, "username").trim().toLowerCase();
  const password = field(formData, "password");
  const next = safeNextPath(field(formData, "next"));
  const failParams: Record<string, string> = { error: "invalid" };
  if (next) failParams.next = next;

  if (!username || !password) {
    redirect(loginUrl(failParams));
  }

  const { user, error } = await signInWithPassword(username, password);
  if (error || !user) {
    redirect(loginUrl(failParams));
  }

  const profile = await getProfileByAuthId(user.id);
  if (!profile) {
    await signOut();
    redirect(loginUrl({ reason: "no_profile" }));
  }
  if (profile.status === "left") {
    await signOut();
    redirect(loginUrl({ reason: "disabled" }));
  }
  if (profile.must_change_password) {
    redirect(CHANGE_PASSWORD_PATH);
  }
  redirect(next ?? homeFor(profile.role));
}
