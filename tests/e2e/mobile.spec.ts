import { join } from "node:path";

import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { ACCOUNTS, signIn } from "./fixtures/accounts";
import { hasSupabaseEnv } from "./global-setup";

/**
 * 375px layout audit of the nine front-end pages (PLAN T28; CLAUDE.md §8
 * 「mobile-first，375px 為主，也要能在 LINE 內建瀏覽器使用」).
 *
 * Two assertions per page, both about the phone and neither about content:
 *
 *   1. `document.documentElement.scrollWidth <= 375` — nothing pushes the
 *      page sideways at the viewport playwright.config.ts pins for every
 *      spec. A wide table, an unbroken 帳號 string or a `min-w` card is the
 *      usual culprit, and horizontal scrolling is exactly what the LINE
 *      in-app browser makes unusable.
 *   2. every VISIBLE `[data-primary]` element is at least 44px tall — the
 *      tap-target floor `app/globals.css` sets (`[data-primary]{min-height:
 *      44px}`). Measuring the rendered box rather than the CSS rule is the
 *      point: a flex parent, a `h-9` from the Button variant or a shrunk row
 *      can defeat the rule, and only `boundingBox()` notices. `:visible`
 *      keeps the closed `<SheetContent>` (Radix unmounts it) out of the run
 *      and makes the drawer's own submit button count once it is open.
 *      `[data-primary]` is not always a `<button>`: /hr/newcomer/[id] puts
 *      it on the `<a download>` of 匯出 CSV, so the locator is the attribute.
 *
 * Each page also leaves one full-page screenshot in `test-results/mobile/`
 * (gitignored) for the PR of T30; the manager timeline leaves a second one
 * with the 回應 drawer open, which is the only state the audit could not
 * otherwise reach.
 *
 * v1 form rendering is verified here only through the real pages and their
 * active version (§6: `/me/today` always renders the active newcomer_daily),
 * and only for the three types v1 actually uses — single_select and
 * short_text on /me/today, date on /manager/weekly. There is deliberately no
 * preview switch on a front-end page (§0); the full six-type render check is
 * `tests/unit/forms-renderer.test.tsx` (T13).
 *
 * Only /login needs no session, so it is the one test that runs without the
 * Supabase stack; the other eight sign in and skip with the rest of the
 * suite when there is no local stack (PLAN A01).
 */

/** playwright.config.ts viewport width (CLAUDE.md §8). */
const MAX_SCROLL_WIDTH = 375;
/** app/globals.css `[data-primary] { min-height: 44px }`. */
const MIN_TAP_TARGET = 44;

const SCREENSHOT_SUBDIR = "mobile";

/** Screenshots are numbered in the §8 reading order so the PR shows them as one walk-through. */
async function auditPage(
  page: Page,
  testInfo: TestInfo,
  options: { name: string; minPrimary?: number },
): Promise<void> {
  const { name, minPrimary = 0 } = options;

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(
    scrollWidth,
    `${name}：375px 下有橫向捲動（scrollWidth ${scrollWidth}）`,
  ).toBeLessThanOrEqual(MAX_SCROLL_WIDTH);

  const primary = page.locator("[data-primary]:visible");
  const count = await primary.count();
  expect(count, `${name}：可見的主要按鈕數`).toBeGreaterThanOrEqual(minPrimary);
  for (let index = 0; index < count; index += 1) {
    const box = await primary.nth(index).boundingBox();
    const label = (await primary.nth(index).textContent())?.trim() ?? "";
    expect(box, `${name}：第 ${index + 1} 個主要按鈕「${label}」量不到尺寸`).not.toBeNull();
    expect(
      box?.height ?? 0,
      `${name}：主要按鈕「${label}」高度不足 ${MIN_TAP_TARGET}px`,
    ).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
  }

  await page.screenshot({
    path: join(testInfo.project.outputDir, SCREENSHOT_SUBDIR, `${name}.png`),
    fullPage: true,
  });
}

test.describe("375px 版面稽核", () => {
  test("未登入：/login", async ({ page }, testInfo) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "登入" })).toBeVisible();
    await auditPage(page, testInfo, { name: "01-login", minPrimary: 1 });
  });

  test.describe("已登入頁面", () => {
    test.skip(
      !hasSupabaseEnv(),
      "Supabase 本機堆疊未設定（PLAN A01：e2e 只在 CI／有 Docker 時跑）",
    );

    test("newcomer：/me/today、/me/history", async ({ page }, testInfo) => {
      await signIn(page, ACCOUNTS.newcomer);
      await expect(page.getByRole("heading", { name: "今日日誌" })).toBeVisible();

      // v1 型別驗證（正式頁面、active 版本）：single_select 渲染成 radio 群組…
      const status = page.locator('[data-question="r1_status"]');
      await expect(status.getByRole("radiogroup")).toBeVisible();
      await expect(status.getByRole("radio")).toHaveCount(4);
      // …short_text 渲染成單行文字輸入。
      await expect(page.locator('[data-question="p1_text"] input[type="text"]')).toBeVisible();

      await auditPage(page, testInfo, { name: "02-me-today", minPrimary: 1 });

      await page.goto("/me/history");
      await expect(page.getByRole("heading", { name: "歷史" })).toBeVisible();
      await auditPage(page, testInfo, { name: "03-me-history" });
    });

    test("manager：/manager、/manager/newcomer/[id]（含抽屜）、/manager/weekly", async ({
      page,
    }, testInfo) => {
      // Three production-build page loads plus a sign-in and a drawer.
      test.setTimeout(120_000);

      await signIn(page, ACCOUNTS.manager);
      await expect(page.getByRole("heading", { name: "我的新人" })).toBeVisible();
      await auditPage(page, testInfo, { name: "04-manager" });

      await page.goto(`/manager/newcomer/${ACCOUNTS.newcomer.id}`);
      // This page has no heading carrying the newcomer's name — that is
      // /hr/newcomer/[id]; 時間軸 is its own heading (T27).
      await expect(page.getByRole("heading", { name: "時間軸" })).toBeVisible();
      await auditPage(page, testInfo, { name: "05-manager-newcomer", minPrimary: 1 });

      // 抽屜開啟：the sheet is the one layout state the closed page hides,
      // and it carries its own 44px submit button.
      const respond: Locator = page.getByTestId("respond-button").first();
      // Scroll first: the (front) header is `sticky top-0 z-10 h-12`, so
      // Playwright's own scroll-into-view can leave the button underneath it
      // and the click would be intercepted by the header.
      await respond.scrollIntoViewIfNeeded();
      await respond.click();
      const drawer = page.getByRole("dialog");
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("button", { name: "送出回應" })).toBeVisible();
      await auditPage(page, testInfo, { name: "05a-manager-newcomer-drawer", minPrimary: 1 });

      await page.goto("/manager/weekly");
      await expect(page.getByRole("heading", { name: "週回饋" })).toBeVisible();
      // v1 型別驗證：date 渲染成原生 `<input type="date">`。
      await expect(page.locator('[data-question="week_start"] input[type="date"]')).toBeVisible();
      await auditPage(page, testInfo, { name: "06-manager-weekly", minPrimary: 1 });
    });

    test("hr：/hr、/hr/newcomer/[id]", async ({ page }, testInfo) => {
      await signIn(page, ACCOUNTS.hr);
      await expect(page.getByRole("heading", { name: "人資儀表板" })).toBeVisible();
      await auditPage(page, testInfo, { name: "07-hr", minPrimary: 1 });

      await page.goto(`/hr/newcomer/${ACCOUNTS.newcomer.id}`);
      await expect(
        page.getByRole("heading", { name: ACCOUNTS.newcomer.displayName }),
      ).toBeVisible();
      // 匯出 CSV is an `<a download>` wearing `data-primary`, not a <button>.
      await expect(page.getByTestId("export-csv")).toBeVisible();
      await auditPage(page, testInfo, { name: "08-hr-newcomer", minPrimary: 1 });
    });

    test("ceo：/ceo", async ({ page }, testInfo) => {
      await signIn(page, ACCOUNTS.ceo);
      await expect(page.getByRole("heading", { name: "營運儀表板" })).toBeVisible();
      // §8 /ceo 無操作按鈕：the audit must not silently pass on an empty set,
      // so the read-only dashboard is asserted to have none at all.
      await expect(page.locator("main [data-primary]")).toHaveCount(0);
      await auditPage(page, testInfo, { name: "09-ceo" });
    });
  });
});
