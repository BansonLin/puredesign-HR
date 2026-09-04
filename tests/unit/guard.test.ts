import { describe, expect, it } from "vitest";

import {
  ACTIONS,
  can,
  canAccessNewcomer,
  canRespond,
  type Action,
  type Actor,
  type NewcomerRef,
  type UserRole,
} from "@/lib/auth/policy";
import {
  BASE_PROFILES,
  DEPARTMENTS,
  E2E_FRESH_PROFILE,
  FIXTURE_MANAGERS,
  FIXTURE_NEWCOMERS,
  type SeedProfile,
} from "@seed/fixtures";

/**
 * CLAUDE.md §10 permission matrix, table-driven (PLAN T08).
 *
 * Only lib/auth/policy.ts is imported: lib/auth/guard.ts carries
 * `server-only`, which throws under Vitest `environment: node` (PLAN 5.4).
 *
 * Table size is asserted to be exactly 60:
 *   10 actions × 5 roles                                    = 50
 * + manager「同部門」split true/false for rows 3, 4, 9      = +3
 * + newcomer「本人」split true/false for rows 1, 2           = +2
 * + actor left, target left, hr on_behalf                    = +3
 * + actor sample (e2e_fresh), target sample                  = +2
 */

// ---------------------------------------------------------------------------
// actors from the seed fixtures
// ---------------------------------------------------------------------------

function departmentId(name: string | null): string | null {
  if (name === null) return null;
  const dept = DEPARTMENTS.find((d) => d.name === name);
  if (!dept) throw new Error(`unknown department ${name}`);
  return dept.id;
}

function toActor(seed: SeedProfile): Actor {
  return {
    id: seed.id,
    role: seed.role,
    department_id: departmentId(seed.department),
    status: seed.status,
  };
}

function seedByUsername(username: string): SeedProfile {
  const all: readonly SeedProfile[] = [
    ...BASE_PROFILES,
    ...FIXTURE_MANAGERS,
    ...FIXTURE_NEWCOMERS,
    E2E_FRESH_PROFILE,
  ];
  const found = all.find((p) => p.username === username);
  if (!found) throw new Error(`unknown seed username ${username}`);
  return found;
}

const admin = toActor(seedByUsername("banson"));
const hr = toActor(seedByUsername("hr"));
const ceo = toActor(seedByUsername("ceo"));
const mgrConstruction = toActor(seedByUsername("mgr_construction")); // 工務主任
const darren = toActor(seedByUsername("darren")); // 工務
const yen = toActor(seedByUsername("yen_yaling")); // 嚴雅齡, 採購
const e2eFresh = toActor(seedByUsername("e2e_fresh")); // status='sample', 工務

const mgrConstructionLeft: Actor = { ...mgrConstruction, status: "left" };
const darrenLeft: NewcomerRef = { ...darren, status: "left" };

// ---------------------------------------------------------------------------
// the table
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  actor: Actor;
  action: Action;
  target?: NewcomerRef;
  expect: boolean;
  /** When set, `canRespond(actor, target).on_behalf` must equal this. */
  onBehalf?: boolean;
}

const ROWS: readonly Row[] = [
  // §10 row 1 填／改自己的日誌 ------------------------------------------------
  { id: "1 newcomer self", actor: darren, action: "log:write_own", target: darren, expect: true },
  { id: "1 newcomer other", actor: darren, action: "log:write_own", target: yen, expect: false },
  { id: "1 manager", actor: mgrConstruction, action: "log:write_own", target: darren, expect: false },
  { id: "1 hr", actor: hr, action: "log:write_own", target: darren, expect: false },
  { id: "1 ceo", actor: ceo, action: "log:write_own", target: darren, expect: false },
  { id: "1 admin", actor: admin, action: "log:write_own", target: darren, expect: false },

  // §10 row 2 看自己的日誌、回應、週回饋 --------------------------------------
  { id: "2 newcomer self", actor: darren, action: "log:read_own", target: darren, expect: true },
  { id: "2 newcomer other", actor: darren, action: "log:read_own", target: yen, expect: false },
  { id: "2 manager", actor: mgrConstruction, action: "log:read_own", target: darren, expect: false },
  { id: "2 hr", actor: hr, action: "log:read_own", target: darren, expect: false },
  { id: "2 ceo", actor: ceo, action: "log:read_own", target: darren, expect: false },
  { id: "2 admin", actor: admin, action: "log:read_own", target: darren, expect: false },

  // §10 row 3 看新人日誌 --------------------------------------------------------
  { id: "3 newcomer", actor: darren, action: "newcomer:read", target: darren, expect: false },
  { id: "3 manager same dept", actor: mgrConstruction, action: "newcomer:read", target: darren, expect: true },
  { id: "3 manager other dept", actor: mgrConstruction, action: "newcomer:read", target: yen, expect: false },
  { id: "3 hr", actor: hr, action: "newcomer:read", target: darren, expect: true },
  { id: "3 ceo", actor: ceo, action: "newcomer:read", target: darren, expect: true },
  { id: "3 admin", actor: admin, action: "newcomer:read", target: yen, expect: true },

  // §10 row 4 回應預警、填週回饋 ------------------------------------------------
  { id: "4 newcomer", actor: darren, action: "alert:respond_or_weekly", target: darren, expect: false },
  { id: "4 manager same dept", actor: mgrConstruction, action: "alert:respond_or_weekly", target: darren, expect: true, onBehalf: false },
  { id: "4 manager other dept", actor: mgrConstruction, action: "alert:respond_or_weekly", target: yen, expect: false },
  { id: "4 hr", actor: hr, action: "alert:respond_or_weekly", target: darren, expect: true },
  { id: "4 ceo", actor: ceo, action: "alert:respond_or_weekly", target: darren, expect: false },
  { id: "4 admin", actor: admin, action: "alert:respond_or_weekly", target: darren, expect: true, onBehalf: true },

  // §10 row 5 名單、部門維護 ----------------------------------------------------
  { id: "5 newcomer", actor: darren, action: "roster:manage", expect: false },
  { id: "5 manager", actor: mgrConstruction, action: "roster:manage", expect: false },
  { id: "5 hr", actor: hr, action: "roster:manage", expect: true },
  { id: "5 ceo", actor: ceo, action: "roster:manage", expect: false },
  { id: "5 admin", actor: admin, action: "roster:manage", expect: true },

  // §10 row 6 表單草稿、發布 ----------------------------------------------------
  { id: "6 newcomer", actor: darren, action: "form:manage", expect: false },
  { id: "6 manager", actor: mgrConstruction, action: "form:manage", expect: false },
  { id: "6 hr", actor: hr, action: "form:manage", expect: true },
  { id: "6 ceo", actor: ceo, action: "form:manage", expect: false },
  { id: "6 admin", actor: admin, action: "form:manage", expect: true },

  // §10 row 7 規則參數、系統設定（僅 admin）---------------------------------------
  { id: "7 newcomer", actor: darren, action: "rules_settings:manage", expect: false },
  { id: "7 manager", actor: mgrConstruction, action: "rules_settings:manage", expect: false },
  { id: "7 hr", actor: hr, action: "rules_settings:manage", expect: false },
  { id: "7 ceo", actor: ceo, action: "rules_settings:manage", expect: false },
  { id: "7 admin", actor: admin, action: "rules_settings:manage", expect: true },

  // §10 row 8 資料改、刪、匯入、還原 --------------------------------------------
  { id: "8 newcomer", actor: darren, action: "data:manage", expect: false },
  { id: "8 manager", actor: mgrConstruction, action: "data:manage", expect: false },
  { id: "8 hr", actor: hr, action: "data:manage", expect: true },
  { id: "8 ceo", actor: ceo, action: "data:manage", expect: false },
  { id: "8 admin", actor: admin, action: "data:manage", expect: true },

  // §10 row 9 匯出 CSV ----------------------------------------------------------
  { id: "9 newcomer", actor: darren, action: "csv:export", target: darren, expect: false },
  { id: "9 manager same dept", actor: mgrConstruction, action: "csv:export", target: darren, expect: true },
  { id: "9 manager other dept", actor: mgrConstruction, action: "csv:export", target: yen, expect: false },
  { id: "9 hr", actor: hr, action: "csv:export", target: darren, expect: true },
  { id: "9 ceo", actor: ceo, action: "csv:export", target: darren, expect: true },
  { id: "9 admin", actor: admin, action: "csv:export", target: darren, expect: true },

  // §10 row 10 稽核紀錄（僅 hr／admin）--------------------------------------------
  { id: "10 newcomer", actor: darren, action: "audit:read", expect: false },
  { id: "10 manager", actor: mgrConstruction, action: "audit:read", expect: false },
  { id: "10 hr", actor: hr, action: "audit:read", expect: true },
  { id: "10 ceo", actor: ceo, action: "audit:read", expect: false },
  { id: "10 admin", actor: admin, action: "audit:read", expect: true },

  // status handling (PLAN T08 / A02) -----------------------------------------
  { id: "actor left → all false", actor: mgrConstructionLeft, action: "newcomer:read", target: darren, expect: false },
  { id: "target left → respond false", actor: mgrConstruction, action: "alert:respond_or_weekly", target: darrenLeft, expect: false, onBehalf: false },
  { id: "hr respond → on_behalf", actor: hr, action: "alert:respond_or_weekly", target: darren, expect: true, onBehalf: true },
  { id: "actor sample (e2e_fresh) writes own log", actor: e2eFresh, action: "log:write_own", target: e2eFresh, expect: true },
  { id: "target sample read like active", actor: mgrConstruction, action: "newcomer:read", target: e2eFresh, expect: true },
];

// ---------------------------------------------------------------------------
// assertions
// ---------------------------------------------------------------------------

const ROLES: readonly UserRole[] = ["newcomer", "manager", "hr", "ceo", "admin"];

describe("§10 permission matrix (lib/auth/policy.ts)", () => {
  it("table has exactly 60 rows with unique ids", () => {
    expect(ROWS).toHaveLength(60);
    expect(new Set(ROWS.map((r) => r.id)).size).toBe(60);
  });

  it("table covers every (role, action) cell of the 10×5 matrix", () => {
    for (const role of ROLES) {
      for (const action of ACTIONS) {
        const hit = ROWS.some(
          (r) => r.actor.role === role && r.action === action,
        );
        expect(hit, `${role} × ${action}`).toBe(true);
      }
    }
  });

  it.each(ROWS)("$id", (row) => {
    const ctx = row.target ? { newcomer: row.target } : undefined;
    expect(can(row.actor, row.action, ctx)).toBe(row.expect);

    if (row.target && row.action === "newcomer:read") {
      expect(canAccessNewcomer(row.actor, row.target)).toBe(row.expect);
    }
    if (row.target && row.action === "alert:respond_or_weekly") {
      const decision = canRespond(row.actor, row.target);
      expect(decision.allowed).toBe(row.expect);
      if (row.onBehalf !== undefined) {
        expect(decision.on_behalf).toBe(row.onBehalf);
      }
    }
  });
});

describe("policy edge cases", () => {
  it("per-person actions without a target are false for self/department roles", () => {
    expect(can(darren, "log:write_own")).toBe(false);
    expect(can(darren, "log:read_own")).toBe(false);
    expect(can(mgrConstruction, "newcomer:read")).toBe(false);
    expect(can(mgrConstruction, "csv:export")).toBe(false);
    expect(can(mgrConstruction, "alert:respond_or_weekly")).toBe(false);
  });

  it("list-level read / export without a target is allowed for hr, ceo, admin", () => {
    for (const actor of [hr, ceo, admin]) {
      expect(can(actor, "newcomer:read")).toBe(true);
      expect(can(actor, "csv:export")).toBe(true);
    }
  });

  it("同部門 is department_id equality, not manager_id", () => {
    const mgrOtherDeptSameManager: Actor = {
      ...mgrConstruction,
      department_id: departmentId("採購"),
    };
    expect(canAccessNewcomer(mgrOtherDeptSameManager, darren)).toBe(false);
    const mgrNoDept: Actor = { ...mgrConstruction, department_id: null };
    expect(canAccessNewcomer(mgrNoDept, { ...darren, department_id: null })).toBe(false);
  });

  it("targets that are not newcomers are never accessible", () => {
    expect(canAccessNewcomer(hr, mgrConstruction)).toBe(false);
    expect(canRespond(admin, mgrConstruction).allowed).toBe(false);
  });

  it("left actor is denied for every action", () => {
    const leftAdmin: Actor = { ...admin, status: "left" };
    for (const action of ACTIONS) {
      expect(can(leftAdmin, action, { newcomer: darren })).toBe(false);
    }
    expect(canAccessNewcomer(leftAdmin, darren)).toBe(false);
    expect(canRespond(leftAdmin, darren)).toEqual({ allowed: false, on_behalf: false });
  });

  it("left target stays readable / exportable but not respondable", () => {
    expect(canAccessNewcomer(hr, darrenLeft)).toBe(true);
    expect(can(mgrConstruction, "csv:export", { newcomer: darrenLeft })).toBe(true);
    expect(canRespond(hr, darrenLeft)).toEqual({ allowed: false, on_behalf: false });
  });
});
