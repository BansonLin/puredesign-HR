import { expect, test } from "@playwright/test";

import { ACCOUNTS, seedPassword } from "./fixtures/accounts";
import { createServiceRoleClient, hasSupabaseEnv } from "./global-setup";

/**
 * 停用帳號 (CLAUDE.md §3 / §10; PLAN T07 「`status='left'` 登入 → signOut 並導
 * `/login?reason=disabled` 顯示「帳號已停用」」, gap B9(a)).
 *
 * `app/(auth)/login/actions.ts` checks `status === 'left'` BEFORE
 * `must_change_password`, so a disabled account never reaches the
 * change-password page — which is why `e2e_fresh` (the only seed account with
 * `must_change_password=true`) is a valid subject here.
 *
 * Subject: `e2e_fresh`, `status='sample'` (A01/A02) — it is outside every
 * dashboard population (`activeNewcomers()` keeps only `active`), so flipping
 * it cannot move a single number another spec asserts. The four §11 newcomers
 * are deliberately NOT used: flow.spec.ts and mobile.spec.ts both depend on
 * 洪湘庭 being signed-in-able and on the /manager card counts.
 *
 * Teardown runs in `afterEach` so the account goes back to `sample` even when
 * an assertion above fails — a left-behind `left` would break first-login.spec
 * (it signs in as the same account) and the /hr populations for the rest of
 * the run, and spec file order is not guaranteed.
 */
const DISABLED_MESSAGE = "帳號已停用";
const SAMPLE_STATUS = "sample";
const LEFT_STATUS = "left";
const LOGIN_PATH = "/login";

test.describe("停用帳號登入", () => {
  test.skip(!hasSupabaseEnv(), "Supabase 本機堆疊未設定（PLAN A01：e2e 只在 CI／有 Docker 時跑）");

  test.afterEach(async () => {
    if (!hasSupabaseEnv()) return;
    await createServiceRoleClient()
      .from("profiles")
      .update({ status: SAMPLE_STATUS })
      .eq("id", ACCOUNTS.fresh.id)
      .throwOnError();
  });

  test("status='left' 的帳號登入後被登出，導向 /login?reason=disabled 並顯示「帳號已停用」", async ({
    page,
  }) => {
    await createServiceRoleClient()
      .from("profiles")
      .update({ status: LEFT_STATUS })
      .eq("id", ACCOUNTS.fresh.id)
      .throwOnError();

    // `signIn()` cannot be reused: it waits for a pathname, and this sign-in
    // both starts and ends on /login, so `waitForURL` would match the form
    // page before the submit even navigates. The query string is the signal.
    await page.goto(LOGIN_PATH);
    await page.getByLabel("帳號").fill(ACCOUNTS.fresh.username);
    await page.getByLabel("密碼").fill(seedPassword());
    await page.getByRole("button", { name: "登入" }).click();

    await page.waitForURL(
      (url) => url.pathname === LOGIN_PATH && url.searchParams.get("reason") === "disabled",
    );
    // `components/ui/alert.tsx` renders `role="alert"`; /login shows at most one.
    await expect(page.getByRole("alert")).toContainText(DISABLED_MESSAGE);
    await expect(page.getByRole("button", { name: "登入" })).toBeVisible();

    // The action really signed the session out (PLAN T07 「signOut 並導…」).
    // Both outcomes land on /login, so `next` is what tells them apart: only
    // the anonymous path through middleware sets `?next=…`. A surviving cookie
    // would instead be caught one layer later by `requireRole`, which redirects
    // to `/login?reason=disabled` with no `next` (lib/auth/guard.ts).
    await page.goto(ACCOUNTS.fresh.home);
    await page.waitForURL((url) => url.pathname === LOGIN_PATH);
    expect(new URL(page.url()).searchParams.get("next")).toBe(ACCOUNTS.fresh.home);
  });
});
