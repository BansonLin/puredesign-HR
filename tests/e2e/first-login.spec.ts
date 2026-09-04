import { expect, test } from "@playwright/test";

import { ACCOUNTS, seedPassword, signIn } from "./fixtures/accounts";
import { createServiceRoleClient, hasSupabaseEnv } from "./global-setup";

/**
 * First login (CLAUDE.md §3 「第一次登入強制改密碼」; PLAN T07 / T27).
 *
 * `e2e_fresh` is the only seed account with `must_change_password=true`
 * (A01) and `status='sample'` (A02), so it can be flipped back and forth
 * without touching a real newcomer or any dashboard number.
 *
 * Teardown puts both back with the service role — the seed would do it too
 * on the next run (`ensureAuthUser` always resets `e2e_fresh`), but a spec
 * that leaves the account changed cannot be re-run on its own.
 */
const NEW_PASSWORD = `Fresh-e2e-${Date.now()}`;

test.describe("首次登入強制改密碼", () => {
  test.skip(!hasSupabaseEnv(), "Supabase 本機堆疊未設定（PLAN A01：e2e 只在 CI／有 Docker 時跑）");

  test.afterAll(async () => {
    if (!hasSupabaseEnv()) return;
    const db = createServiceRoleClient();
    const { error } = await db.auth.admin.updateUserById(ACCOUNTS.fresh.id, {
      password: seedPassword(),
    });
    expect(error, error?.message).toBeNull();
    await db
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", ACCOUNTS.fresh.id)
      .throwOnError();
  });

  test("e2e_fresh 登入被導到改密碼頁，改完落在 /me/today", async ({ page }) => {
    await signIn(page, ACCOUNTS.fresh, { expectPath: "/login/change-password" });
    await expect(page.getByRole("heading", { name: "設定新密碼" })).toBeVisible();
    await expect(page.getByText(ACCOUNTS.fresh.displayName)).toBeVisible();

    await page.getByLabel("新密碼", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("確認新密碼").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "儲存並繼續" }).click();

    await page.waitForURL((url) => url.pathname === ACCOUNTS.fresh.home);
    await expect(page.getByRole("heading", { name: "今日日誌" })).toBeVisible();

    // The flag is cleared: a fresh session with the new password goes
    // straight to /me/today instead of back to the change-password page.
    await page.getByRole("button", { name: "登出" }).click();
    await page.waitForURL((url) => url.pathname === "/login");
    await signIn(page, ACCOUNTS.fresh, { password: NEW_PASSWORD });
    await expect(page.getByRole("heading", { name: "今日日誌" })).toBeVisible();
  });
});
