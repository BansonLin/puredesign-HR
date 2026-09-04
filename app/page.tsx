import { redirect } from "next/navigation";

import { homeFor } from "@/lib/auth/home";
import { getSessionUser } from "@/lib/auth/session";
import { getProfileByAuthId } from "@/lib/db/queries/profiles";

/**
 * Root path: role-based landing for signed-in users (PLAN A13 / T07).
 * Anonymous visitors are already sent to /login (302) by middleware.ts; the
 * `!user` branch below is only a fallback. A session without a usable
 * profile is handed to /login with a reason (the login action signs the
 * stale session out on the next attempt, DECISIONS D-21).
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
