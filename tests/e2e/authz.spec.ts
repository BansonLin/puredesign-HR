import { expect, test } from "@playwright/test";

import { ACCOUNTS, signIn } from "./fixtures/accounts";
import { hasSupabaseEnv } from "./global-setup";

/**
 * Authorisation smoke tests (PLAN T27; CLAUDE.md §3 「四種角色各一條路徑」
 * and §10 the permission matrix).
 *
 * `lib/auth/guard.ts` stays the single truth and `tests/unit/guard.test.ts`
 * covers every cell of the matrix; what is proven here is that the wiring
 * around it is real — middleware sends anonymous visitors to /login, every
 * page and the export Route Handler actually call the guard, and a refusal
 * arrives as HTTP 403 with app/forbidden.tsx rather than as a page that
 * merely hides its buttons.
 *
 * One happy path per role (newcomer /me/today, manager /manager, hr /hr,
 * ceo /ceo) and, next to it, the refusal that role must meet.
 */
const FORBIDDEN_HEADING = "沒有權限";

test.describe("未授權存取", () => {
  test.skip(!hasSupabaseEnv(), "Supabase 本機堆疊未設定（PLAN A01：e2e 只在 CI／有 Docker 時跑）");

  test("未登入開 /me/today → 導向 /login（帶 next）", async ({ page }) => {
    await page.goto("/me/today");
    await page.waitForURL((url) => url.pathname === "/login");
    expect(new URL(page.url()).searchParams.get("next")).toBe("/me/today");
    await expect(page.getByRole("button", { name: "登入" })).toBeVisible();
  });

  test("newcomer：/me/today 可看，/hr 403", async ({ page }) => {
    await signIn(page, ACCOUNTS.newcomer);
    await expect(page.getByRole("heading", { name: "今日日誌" })).toBeVisible();

    const response = await page.goto("/hr");
    expect(response?.status()).toBe(403);
    await expect(page.getByRole("heading", { name: FORBIDDEN_HEADING })).toBeVisible();
  });

  test("newcomer 匯出他人 CSV → 403", async ({ page }) => {
    await signIn(page, ACCOUNTS.newcomer);
    // Same browser context, so the request carries the newcomer's session.
    const response = await page.request.get(
      `/api/export/newcomer/${ACCOUNTS.otherNewcomer.id}`,
    );
    expect(response.status()).toBe(403);
  });

  test("manager：自己部門的新人可看，別部門 403", async ({ page }) => {
    await signIn(page, ACCOUNTS.manager);
    await expect(page.getByRole("heading", { name: "我的新人" })).toBeVisible();

    const own = await page.goto(`/manager/newcomer/${ACCOUNTS.newcomer.id}`);
    expect(own?.status()).toBe(200);
    // The detail page has no heading carrying the newcomer's name (that is
    // /hr/newcomer/[id]); anchor on what this page actually renders — her
    // card and the timeline heading, neither of which exists on forbidden.tsx.
    await expect(
      page.locator(`[data-testid="newcomer-card"][data-user-id="${ACCOUNTS.newcomer.id}"]`),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "時間軸" })).toBeVisible();

    const other = await page.goto(`/manager/newcomer/${ACCOUNTS.otherNewcomer.id}`);
    expect(other?.status()).toBe(403);
    await expect(page.getByRole("heading", { name: FORBIDDEN_HEADING })).toBeVisible();
  });

  test("hr：/hr 可看，/ceo 403（§10 ceo 唯讀畫面不是 HR 的家）", async ({ page }) => {
    await signIn(page, ACCOUNTS.hr);
    await expect(page.getByRole("heading", { name: "人資儀表板" })).toBeVisible();

    const response = await page.goto("/ceo");
    expect(response?.status()).toBe(403);
    await expect(page.getByRole("heading", { name: FORBIDDEN_HEADING })).toBeVisible();
  });

  test("ceo：/ceo 唯讀（main 內無按鈕、無表單、無新人連結），/hr 403", async ({ page }) => {
    await signIn(page, ACCOUNTS.ceo);
    await expect(page.getByRole("heading", { name: "營運儀表板" })).toBeVisible();

    // PLAN T26: the logout button lives in the app header, not in <main>.
    const main = page.locator("main");
    await expect(main.locator("button")).toHaveCount(0);
    await expect(main.locator("form")).toHaveCount(0);
    await expect(main.locator('a[href^="/hr/newcomer"]')).toHaveCount(0);

    const response = await page.goto("/hr");
    expect(response?.status()).toBe(403);
    await expect(page.getByRole("heading", { name: FORBIDDEN_HEADING })).toBeVisible();
  });
});
