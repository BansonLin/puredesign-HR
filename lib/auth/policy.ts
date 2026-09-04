import type { Enums, Tables } from "@/lib/db/types";

/**
 * CLAUDE.md §10 permission matrix as pure functions (PLAN T08 / 5.5).
 *
 * This module has no `server-only`, no lib/db and no next/headers import so
 * the matrix can be unit-tested under Vitest `environment: node`. Callers
 * never import it directly: lib/auth/guard.ts re-exports the three
 * functions below, so guard.ts stays the single source of truth for §10.
 *
 * Conventions (PLAN T08 / A02):
 * - "同部門" = `department_id` equal and non-null; `manager_id` is ignored.
 * - actor `status='left'` → every answer is false.
 * - target newcomer `status='left'` → respond / weekly feedback is false;
 *   reading and CSV export stay allowed (history remains visible).
 * - `status='sample'` behaves exactly like `active` here; it is excluded
 *   only from the `activeNewcomers()` population (A02).
 * - `newcomer:read` is the manager / HR / CEO view of a newcomer; a newcomer
 *   reading their own logs is `log:read_own`, so `newcomer:read` is false
 *   for the newcomer role even on themselves (§10 row 3 is blank there).
 */

/** The ten rows of §10, top to bottom. */
export type Action =
  | "log:write_own" // 填／改自己的日誌
  | "log:read_own" // 看自己的日誌、回應、週回饋
  | "newcomer:read" // 看新人日誌
  | "alert:respond_or_weekly" // 回應預警、填週回饋
  | "roster:manage" // 名單、部門維護
  | "form:manage" // 表單草稿、發布
  | "rules_settings:manage" // 規則參數、系統設定
  | "data:manage" // 資料改、刪、匯入、還原
  | "csv:export" // 匯出 CSV
  | "audit:read"; // 稽核紀錄

export const ACTIONS: readonly Action[] = [
  "log:write_own",
  "log:read_own",
  "newcomer:read",
  "alert:respond_or_weekly",
  "roster:manage",
  "form:manage",
  "rules_settings:manage",
  "data:manage",
  "csv:export",
  "audit:read",
];

export type UserRole = Enums<"user_role">;

/** Minimal profile shape the matrix needs; a full `Tables<'profiles'>` row satisfies it. */
export type Actor = Pick<
  Tables<"profiles">,
  "id" | "role" | "department_id" | "status"
>;

/** The newcomer a per-person action targets (same minimal shape). */
export type NewcomerRef = Actor;

export interface ActionContext {
  /** Target newcomer for the per-person rows (own logs, read, respond, CSV). */
  newcomer?: NewcomerRef;
}

export interface RespondDecision {
  allowed: boolean;
  /** true when hr / admin act in place of the department manager (§10「可代填（標註 on_behalf）」). */
  on_behalf: boolean;
}

const ADMIN_ROLES: readonly UserRole[] = ["hr", "admin"];
const GLOBAL_READ_ROLES: readonly UserRole[] = ["hr", "ceo", "admin"];

function isActive(profile: Pick<Actor, "status">): boolean {
  // `sample` is treated like `active` (A02); only `left` is blocked.
  return profile.status !== "left";
}

function sameDepartment(actor: Actor, newcomer: NewcomerRef): boolean {
  return (
    actor.department_id !== null &&
    actor.department_id === newcomer.department_id
  );
}

function isSelf(actor: Actor, newcomer: NewcomerRef): boolean {
  return actor.role === "newcomer" && actor.id === newcomer.id;
}

/**
 * §10 row 3「看新人日誌」: manager → same department; hr / ceo / admin → all.
 * The target must be a newcomer profile. Target `left` is still readable.
 */
export function canAccessNewcomer(actor: Actor, newcomer: NewcomerRef): boolean {
  if (!isActive(actor)) return false;
  if (newcomer.role !== "newcomer") return false;
  if (actor.role === "manager") return sameDepartment(actor, newcomer);
  return GLOBAL_READ_ROLES.includes(actor.role);
}

/**
 * §10 row 4「回應預警、填週回饋」: manager → same department (on_behalf false);
 * hr / admin → allowed with on_behalf true; ceo / newcomer → false.
 * Target `left` → false (nothing left to respond to).
 */
export function canRespond(actor: Actor, newcomer: NewcomerRef): RespondDecision {
  const deny: RespondDecision = { allowed: false, on_behalf: false };
  if (!isActive(actor)) return deny;
  if (newcomer.role !== "newcomer" || !isActive(newcomer)) return deny;
  if (actor.role === "manager") {
    return { allowed: sameDepartment(actor, newcomer), on_behalf: false };
  }
  if (ADMIN_ROLES.includes(actor.role)) {
    return { allowed: true, on_behalf: true };
  }
  return deny;
}

/**
 * Generic entry point for the whole matrix. Per-person rows need
 * `ctx.newcomer`; without it they answer false for roles whose permission
 * depends on the target (newcomer self, manager same-department).
 */
export function can(
  actor: Actor,
  action: Action,
  ctx: ActionContext = {},
): boolean {
  if (!isActive(actor)) return false;
  const target = ctx.newcomer;
  switch (action) {
    case "log:write_own":
    case "log:read_own":
      return target !== undefined && isSelf(actor, target);
    case "newcomer:read":
    case "csv:export":
      // With a target: exactly §10 row 3 (manager same-department, hr/ceo/admin
      // all). Without one (list pages, whole-department export): the global
      // roles are allowed; a manager must always name the newcomer.
      if (target !== undefined) return canAccessNewcomer(actor, target);
      return GLOBAL_READ_ROLES.includes(actor.role);
    case "alert:respond_or_weekly":
      return target !== undefined && canRespond(actor, target).allowed;
    case "roster:manage":
    case "form:manage":
    case "data:manage":
    case "audit:read":
      return ADMIN_ROLES.includes(actor.role);
    case "rules_settings:manage":
      return actor.role === "admin";
  }
}
