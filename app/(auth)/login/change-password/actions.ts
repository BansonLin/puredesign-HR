"use server";

import { redirect } from "next/navigation";

import { homeFor } from "@/lib/auth/home";
import { meetsPasswordRule } from "@/lib/auth/password";
import { getSessionUser, signOut, updatePassword } from "@/lib/auth/session";
import { getAdminClient } from "@/lib/db/admin";
import { getProfileByAuthId } from "@/lib/db/queries/profiles";

const CHANGE_PASSWORD_PATH = "/login/change-password";

export type PasswordError = "weak" | "mismatch" | "same" | "failed";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function fail(code: PasswordError): never {
  redirect(`${CHANGE_PASSWORD_PATH}?error=${code}`);
}

/**
 * /login/change-password form handler (PLAN T07).
 *
 * Order of checks: session → profile usable → rule (≥8, letter + digit) →
 * confirm matches → Supabase updateUser (its `same_password` /
 * `weak_password` codes are mapped to 繁中 messages by the page) → clear
 * profiles.must_change_password with the service client → homeFor(role).
 */
export async function changePassword(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const profile = await getProfileByAuthId(user.id);
  if (!profile) {
    await signOut();
    redirect("/login?reason=no_profile");
  }
  if (profile.status === "left") {
    await signOut();
    redirect("/login?reason=disabled");
  }

  const password = field(formData, "password");
  const confirm = field(formData, "confirm");
  if (!meetsPasswordRule(password)) fail("weak");
  if (password !== confirm) fail("mismatch");

  const { error } = await updatePassword(password);
  if (error) {
    if (error.code === "same_password") fail("same");
    if (error.code === "weak_password") fail("weak");
    fail("failed");
  }

  await getAdminClient()
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", profile.id)
    .throwOnError();

  redirect(homeFor(profile.role));
}
