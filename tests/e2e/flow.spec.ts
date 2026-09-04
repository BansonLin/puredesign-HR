import { expect, test, type Locator, type Page } from "@playwright/test";

import { formatDate, taipeiDateOf } from "@/lib/time";

import { ACCOUNTS, signIn, signOut } from "./fixtures/accounts";
import { hasSupabaseEnv } from "./global-setup";

/**
 * Main flow smoke test (PLAN Target 7 / T27; CLAUDE.md §8):
 * 新人填日誌 → 產生 R2 預警 → 主管回應 → HR 稽核，一次跑完四個角色裡的三個
 * （ceo 的唯讀路徑在 authz.spec.ts）。
 *
 * The R2 (卡點) path is chosen because it does not depend on what day the
 * run happens on: R1 would need yesterday's plan to say 「預計完成」, while
 * `result.blocker.status = '有，尚未回報'` produces an alert from today's
 * answers alone (§7 R2). The three settlement items are answered
 * 「昨日無此項」, which §7 R1 lists under `status_done`, so exactly ONE new
 * alert is created no matter which log the newcomer's 昨日計畫 came from.
 *
 * Counting assumption (PLAN T27): the seed's 9/3 R2 on 洪湘庭 is never
 * responded to, so after this test's submission her card shows exactly two
 * open alerts. That holds for every run dated after the §11 fixture
 * (`FIXTURE_ANCHOR_DATE` 2026-09-03); the overdue count is deliberately not
 * asserted, since it depends on the distance to that date.
 *
 * global-setup.ts has already deleted today's logs and re-seeded, so the
 * newcomer always starts on an empty 今日日誌.
 */
const TODAY = taipeiDateOf(new Date());
const TODAY_LABEL = formatDate(TODAY, "M/d");

/** Unique per run: it becomes the R2 detail text, which is how HR's lists are checked. */
const RUN_ID = `E2E-${Date.now()}`;
const BLOCKER_DETAIL = `Luma 免費版次數用完 ${RUN_ID}`;
const PLAN_ITEM_1 = `宗硯20期渲染圖收尾 ${RUN_ID}`;
const RESPONSE_COMMENT = `已協調追加額度 ${RUN_ID}`;

/** PLAN T18 「20 秒內可完成」: the manager's whole 回應 interaction. */
const RESPONSE_BUDGET_MS = 20_000;

test.describe("主流程：日誌 → 預警 → 主管回應 → HR 稽核", () => {
  test.skip(!hasSupabaseEnv(), "Supabase 本機堆疊未設定（PLAN A01：e2e 只在 CI／有 Docker 時跑）");

  /** Choose one option of a `single_select` question and confirm what the form will submit. */
  async function choose(scope: Page | Locator, key: string, option: string): Promise<void> {
    const question = scope.locator(`[data-question="${key}"]`);
    await question.locator("label", { hasText: option }).click();
    await expect(question.locator(`input[type="hidden"][name="${key}"]`)).toHaveValue(option);
  }

  /** Type into a `short_text` question (located by key, never by label text). */
  async function fill(scope: Page | Locator, key: string, value: string): Promise<void> {
    await scope.locator(`[data-question="${key}"] input`).fill(value);
  }

  test("洪湘庭提交卡點日誌，信義總監回應，HR 看到結果", async ({ page }) => {
    // Three sign-ins plus a production-build page load each: well above the
    // per-test default, and deliberately one test so the chain is one story.
    test.setTimeout(180_000);

    // --- 1. newcomer 洪湘庭 -------------------------------------------------
    await signIn(page, ACCOUNTS.newcomer);
    await expect(page.getByRole("heading", { name: "今日日誌" })).toBeVisible();

    await choose(page, "r1_status", "昨日無此項");
    await choose(page, "r2_status", "昨日無此項");
    await choose(page, "r3_status", "昨日無此項");

    await choose(page, "blocker", "有，尚未回報");
    // blocker_detail is `show_if blocker neq 沒有` — it only exists now (§6).
    await fill(page, "blocker_detail", BLOCKER_DETAIL);

    await fill(page, "p1_text", PLAN_ITEM_1);
    await choose(page, "p1_expect", "完成");
    await choose(page, "top", "項目一");
    await choose(page, "support", "不需要");

    await page.getByRole("button", { name: /^(儲存|更新)今日日誌$/ }).click();
    const saved = page.getByTestId("saved-card");
    await expect(saved).toBeVisible();
    await expect(saved).toContainText("已儲存今日日誌");
    await expect(saved).toContainText(PLAN_ITEM_1);

    await signOut(page);

    // --- 2. manager 信義總監 ------------------------------------------------
    await signIn(page, ACCOUNTS.manager);
    const card = page.locator(
      `[data-testid="newcomer-card"][data-user-id="${ACCOUNTS.newcomer.id}"]`,
    );
    await expect(card).toBeVisible();
    // Seed 9/3 R2 (never responded) + the one just created.
    await expect(card.getByTestId("open-alerts")).toHaveText("待回應預警 2");

    await card.getByRole("link", { name: ACCOUNTS.newcomer.displayName }).click();
    await page.waitForURL((url) => url.pathname === `/manager/newcomer/${ACCOUNTS.newcomer.id}`);

    const todayRow = page.locator(`[data-testid="timeline-day"][data-date="${TODAY}"]`);
    await expect(todayRow).toBeVisible();
    await expect(todayRow).toContainText(BLOCKER_DETAIL);
    const todayAlert = todayRow.locator('[data-testid="alert-badge"][data-rule="R2"]');
    await expect(todayAlert).toHaveText("卡點預警｜待回應");
    await expect(todayAlert).toHaveAttribute("data-state", "open");

    const startedAt = Date.now();
    await todayRow.getByTestId("respond-button").click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await choose(drawer, "status", "已處理");
    await fill(drawer, "comment", RESPONSE_COMMENT);
    await drawer.getByRole("button", { name: "送出回應" }).click();
    await expect(todayRow.getByTestId("response-sent")).toBeVisible();
    expect(Date.now() - startedAt).toBeLessThanOrEqual(RESPONSE_BUDGET_MS);

    // The action revalidated the page: the alert is 已回應 and the response is listed.
    await page.reload();
    await expect(todayRow.locator('[data-testid="alert-badge"][data-rule="R2"]')).toHaveAttribute(
      "data-state",
      "responded",
    );
    await expect(todayRow.getByTestId("timeline-response")).toContainText(RESPONSE_COMMENT);

    await signOut(page);

    // --- 3. hr --------------------------------------------------------------
    await signIn(page, ACCOUNTS.hr);
    await expect(page.getByRole("heading", { name: "人資儀表板" })).toBeVisible();

    // 待處理預警 only lists `open` alerts: the responded one is gone (its
    // detail line is the unique blocker text), the seed 9/3 R2 stays.
    const pending = page.getByTestId("pending-alerts");
    await expect(pending).not.toContainText(BLOCKER_DETAIL);
    await expect(pending).toContainText(ACCOUNTS.newcomer.displayName);

    // 一行摘要 counts every non-closed alert on today's logs (A13).
    await expect(page.getByTestId("summary-text")).toHaveValue(
      new RegExp(`${TODAY_LABEL} 新人日誌.*${ACCOUNTS.newcomer.displayName}（卡點）`),
    );

    await page.goto(`/hr/newcomer/${ACCOUNTS.newcomer.id}`);
    await expect(page.getByRole("heading", { name: ACCOUNTS.newcomer.displayName })).toBeVisible();
    const hrTodayRow = page.locator(`[data-testid="timeline-day"][data-date="${TODAY}"]`);
    await expect(hrTodayRow.getByTestId("timeline-response")).toContainText(RESPONSE_COMMENT);
    await expect(hrTodayRow.locator('[data-testid="alert-badge"][data-rule="R2"]')).toHaveAttribute(
      "data-state",
      "responded",
    );
  });
});
