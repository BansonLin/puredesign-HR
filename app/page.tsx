import { redirect } from "next/navigation";

/**
 * Root path: role-based landing (PLAN A13).
 * Logged-in users are sent to /me/today, /manager, /hr or /ceo by role;
 * anonymous visitors go to /login.
 *
 * TODO(T07): once lib/auth/session.ts exists, read the session here and
 * redirect to homeFor(role) instead of always redirecting to /login.
 */
export default function RootPage() {
  redirect("/login");
}
