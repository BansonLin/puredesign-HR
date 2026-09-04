import type { Enums } from "@/lib/db/types";

/**
 * Pure routing helpers for the auth flow (PLAN T07). No `server-only`, no
 * lib/db import, so both Server Components/Actions and unit tests can use it.
 * (middleware.ts cannot know the role — it has no profile lookup — so it
 * never calls homeFor; the role-based landing is done by app/page.tsx and
 * the login page/action.)
 */
export type UserRole = Enums<"user_role">;

/** Landing page per role (CLAUDE.md §8, PLAN T07 / A13). */
export function homeFor(role: UserRole): string {
  switch (role) {
    case "newcomer":
      return "/me/today";
    case "manager":
      return "/manager";
    case "hr":
    case "admin":
      return "/hr";
    case "ceo":
      return "/ceo";
  }
}

/**
 * `?next=` is only honoured when it is a same-origin absolute path
 * (`/foo`, `/foo?x=1`); anything else (`//evil`, `https://…`, `javascript:`)
 * is dropped so the login page can never be used as an open redirect.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return null;
  }
  if (next.startsWith("/login")) return null;
  return next;
}
