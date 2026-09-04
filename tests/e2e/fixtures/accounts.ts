import { expect, type Page } from "@playwright/test";

import { homeFor, type UserRole } from "@/lib/auth/home";
import { BASE_PROFILES, type SeedProfile } from "@seed/fixtures/base";
import {
  E2E_FRESH_PROFILE,
  FIXTURE_MANAGERS,
  FIXTURE_NEWCOMERS,
} from "@seed/fixtures/fixture";

/**
 * The seed accounts the smoke tests sign in as (PLAN A03 / T27) and the two
 * helpers every spec uses to get in and out.
 *
 * Identities are never re-typed here: they come from the §11 seed fixture
 * (`supabase/seed/fixtures`), so a display name or a fixed UUID can only
 * change in one place. Passwords are not in the fixture at all — every seed
 * account shares `SEED_PASSWORD` (A03), which is a CI secret and a local
 * `.env.local` value and must never reach git.
 *
 * The four roles of §3 「四種角色各一條路徑」: newcomer 洪湘庭, manager
 * 信義總監 (her department), hr, ceo. `darren` is the newcomer of ANOTHER
 * department, used by authz.spec.ts for the two cross-department 403s;
 * `fresh` is the `e2e_fresh` sample account of first-login.spec.ts (A01).
 */
export interface E2eAccount {
  username: string;
  displayName: string;
  /** `profiles.id` = `auth.users.id` (fixed seed UUID). */
  id: string;
  role: UserRole;
  /** Landing page after a successful sign-in (`homeFor`). */
  home: string;
}

const SEED_PASSWORD_ENV = "SEED_PASSWORD";

function accountOf(profile: SeedProfile): E2eAccount {
  const role: UserRole = profile.role;
  return {
    username: profile.username,
    displayName: profile.display_name,
    id: profile.id,
    role,
    home: homeFor(role),
  };
}

function byUsername(
  profiles: readonly SeedProfile[],
  username: string,
): E2eAccount {
  const profile = profiles.find((candidate) => candidate.username === username);
  if (!profile) throw new Error(`seed fixture 沒有帳號 ${username}`);
  return accountOf(profile);
}

export const ACCOUNTS = {
  newcomer: byUsername(FIXTURE_NEWCOMERS, "hung_hsiangting"),
  manager: byUsername(FIXTURE_MANAGERS, "mgr_xinyi"),
  hr: byUsername(BASE_PROFILES, "hr"),
  ceo: byUsername(BASE_PROFILES, "ceo"),
  /** Newcomer of another department (工務) — the 403 target of authz.spec.ts. */
  otherNewcomer: byUsername(FIXTURE_NEWCOMERS, "darren"),
  /** `must_change_password=true`, `status='sample'` (A01/A02). */
  fresh: accountOf(E2E_FRESH_PROFILE),
} as const;

/**
 * The password every seed account was created with. Missing it is a hard
 * error, not a skip: a run that reaches a spec has already passed
 * `global-setup.ts`, which itself needs `SEED_PASSWORD` for `pnpm db:seed`.
 */
export function seedPassword(): string {
  const password = process.env[SEED_PASSWORD_ENV];
  if (!password) {
    throw new Error(`Missing environment variable ${SEED_PASSWORD_ENV} (see .env.example)`);
  }
  return password;
}

/**
 * Sign in through the real /login form (帳號 + 密碼 only, §3) and wait for
 * the landing page. `expectPath` overrides `account.home` for the cases
 * where login does not land there (first login → /login/change-password, or
 * a `?next=` deep link).
 */
export async function signIn(
  page: Page,
  account: E2eAccount,
  options: { password?: string; expectPath?: string } = {},
): Promise<void> {
  const expectPath = options.expectPath ?? account.home;
  await page.goto("/login");
  await page.getByLabel("帳號").fill(account.username);
  await page.getByLabel("密碼").fill(options.password ?? seedPassword());
  await page.getByRole("button", { name: "登入" }).click();
  await page.waitForURL((url) => url.pathname === expectPath);
}

/** Sign out through the header button and wait for /login (PLAN T07). */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "登出" }).click();
  await page.waitForURL((url) => url.pathname === "/login");
  await expect(page.getByRole("button", { name: "登入" })).toBeVisible();
}
