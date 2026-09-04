import { redirect } from "next/navigation";

import { homeFor } from "@/lib/auth/home";
import { getSessionUser } from "@/lib/auth/session";
import { getProfileByAuthId } from "@/lib/db/queries/profiles";

/**
 * Root path: role-based landing (PLAN A13 / T07).
 * Anonymous visitors go to /login; signed-in users to homeFor(role).
 * A session without a usable profile is handed to /login with a reason
 * (the login action signs the stale session out on the next attempt).
 */
export default async function RootPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const profile = await getProfileByAuthId(user.id);
  if (!profile) redirect("/login?reason=no_profile");
  if (profile.status === "left") redirect("/login?reason=disabled");
  if (profile.must_change_password) redirect("/login/change-password");
  redirect(homeFor(profile.role));
}
