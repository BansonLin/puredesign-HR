import { expect, test, type Locator, type Page } from "@playwright/test";

import type { Tables } from "@/lib/db/types";
import { RESPONSE_STATUS_NEED_HR } from "@/lib/rules/constants";
import { EXPECTED_ALERTS } from "@seed/fixtures/expected";
import { FIXTURE_DAILY_LOGS } from "@seed/fixtures/fixture";

import { ACCOUNTS, signIn, signOut } from "./fixtures/accounts";
import { createServiceRoleClient, hasSupabaseEnv } from "./global-setup";

/**
 * 需 HR 協助 (PLAN T18 驗收欄「信義總監回應洪湘庭『需 HR 協助』→ R2 responded
 * 並進 HR 介入清單」, gap B9(b); CLAUDE.md §7 「response.status 為『需 HR 協助』
 * 時在 HR 清單另列」 and §8 /hr 「HR 介入清單」).
 *
 * flow.spec.ts already walks 日誌 → 預警 → 回應 → 稽核, but with 「已處理」,
 * and it only asserts that the answered alert LEAVES 待處理預警. The other
 * half — the response ARRIVING in 需 HR 協助 — has no coverage, and 已處理
 * cannot produce it, so this is a second, separate response with the other
 * status. It lives in its own file so flow.spec's passing assertions are not
 * touched.
 *
 * ## Subject and why it must be restored
 *
 * The §11 seed's 洪湘庭 9/3 R2 is the only alert the spec can answer with
 * 需 HR 協助 while also proving 「R2 responded」: it is the fixture's one open
 * alert, and creating a fresh one would mean writing 洪湘庭's log for
 * Taipei-today, which is exactly the row flow.spec.ts owns (one log per
 * user per day, §5 partial unique index).
 *
 * That same row is load-bearing elsewhere, so `afterAll` puts it back:
 *   - flow.spec.ts asserts 「待回應預警 2」 on her /manager card (the seed 9/3
 *     R2 plus the one it creates) and that 待處理預警 still names her;
 *   - `pnpm db:seed` — which `global-setup.ts` re-runs on EVERY e2e run —
 *     ends in `verifyAlerts()`, which aborts when an alert's status /
 *     responded_at / response_submission_id differs from the seed plan. A
 *     response left in place would therefore fail the NEXT run before a
 *     single test starts.
 * Playwright runs a file's `afterAll` before the next file's tests, so the
 * restore holds whichever order the spec files happen to run in (workers=1,
 * fullyParallel=false).
 *
 * mobile.spec.ts also opens this newcomer's timeline and its 回應 drawer, but
 * only screenshots and measures it — it submits nothing and asserts no
 * counts, so it is indifferent to this spec's order.
 */

/** The §11 R2 on 洪湘庭, resolved from the fixture rather than re-typed (see fixtures/accounts.ts). */
const SEED_R2 = (() => {
  const expected = EXPECTED_ALERTS.find(
    (alert) => alert.username === ACCOUNTS.newcomer.username && alert.rule_key === "R2",
  );
  if (!expected) throw new Error(`§11 fixture 沒有 ${ACCOUNTS.newcomer.username} 的 R2 預警`);
  const log = FIXTURE_DAILY_LOGS.find((entry) => entry.seq === expected.log_seq);
  if (!log) throw new Error(`§11 fixture 沒有 seq ${expected.log_seq} 的日誌`);
  return { ruleKey: expected.rule_key, status: expected.status, logDate: log.log_date };
})();

/** Unique per run: how the response is recognised in the timeline and in HR's list. */
const RESPONSE_COMMENT = `請協助申請 Luma 付費額度 E2E-${Date.now()}`;

/** The alert columns `afterAll` restores. */
type AlertRestore = Pick<
  Tables<"alerts">,
  "status" | "responded_at" | "response_submission_id"
>;

test.describe("主管回應「需 HR 協助」進 HR 介入清單", () => {
  test.skip(!hasSupabaseEnv(), "Supabase 本機堆疊未設定（PLAN A01：e2e 只在 CI／有 Docker 時跑）");

  let logId = "";
  let alertId = "";
  let alertBefore: AlertRestore | null = null;
  let responsesBefore: readonly string[] = [];

  /** The manager_response rows targeting the 9/3 log, whatever wrote them. */
  async function responseIdsOnLog(): Promise<string[]> {
    const { data } = await createServiceRoleClient()
      .from("submissions")
      .select("id")
      .eq("template_key", "manager_response")
      .eq("target_submission_id", logId)
      .throwOnError();
    return data.map((row) => row.id);
  }

  test.beforeAll(async () => {
    if (!hasSupabaseEnv()) return;
    const db = createServiceRoleClient();

    const { data: log } = await db
      .from("submissions")
      .select("id")
      .eq("template_key", "newcomer_daily")
      .eq("user_id", ACCOUNTS.newcomer.id)
      .eq("log_date", SEED_R2.logDate)
      .is("deleted_at", null)
      .single()
      .throwOnError();
    logId = log.id;

    const { data: alert } = await db
      .from("alerts")
      .select("id, status, responded_at, response_submission_id")
      .eq("submission_id", logId)
      .eq("rule_key", SEED_R2.ruleKey)
      .single()
      .throwOnError();
    alertId = alert.id;
    alertBefore = {
      status: alert.status,
      responded_at: alert.responded_at,
      response_submission_id: alert.response_submission_id,
    };

    // Precondition, asserted rather than assumed: the seed leaves this alert
    // `open`. (Its derived A1 state — 待回應 or 逾時 — depends on how far the
    // run date is past 9/3, so only the stored status is pinned here.)
    expect(alert.status, `${SEED_R2.logDate} 的 R2 應為 ${SEED_R2.status}`).toBe(SEED_R2.status);

    responsesBefore = await responseIdsOnLog();
  });

  test.afterAll(async () => {
    if (!hasSupabaseEnv() || alertBefore === null) return;
    const db = createServiceRoleClient();
    // The alert first: `alerts.response_submission_id` references the response
    // row, so the FK has to be cleared before that row can be deleted.
    await db.from("alerts").update(alertBefore).eq("id", alertId).throwOnError();
    const created = (await responseIdsOnLog()).filter((id) => !responsesBefore.includes(id));
    if (created.length > 0) {
      await db.from("submissions").delete().in("id", created).throwOnError();
    }
  });

  /** Choose one option of a `single_select` question (same shape as flow.spec.ts). */
  async function choose(scope: Page | Locator, key: string, option: string): Promise<void> {
    const question = scope.locator(`[data-question="${key}"]`);
    await question.locator("label", { hasText: option }).click();
    await expect(question.locator(`input[type="hidden"][name="${key}"]`)).toHaveValue(option);
  }

  /** Type into a `short_text` question (located by key, never by label text). */
  async function fill(scope: Page | Locator, key: string, value: string): Promise<void> {
    await scope.locator(`[data-question="${key}"] input`).fill(value);
  }

  test("信義總監回應洪湘庭 R2「需 HR 協助」→ 預警已回應，HR 介入清單出現該筆", async ({ page }) => {
    // Two sign-ins plus production-build page loads, well past the default.
    test.setTimeout(180_000);

    // --- 1. manager 信義總監 ------------------------------------------------
    await signIn(page, ACCOUNTS.manager);
    await page.goto(`/manager/newcomer/${ACCOUNTS.newcomer.id}`);
    await expect(page.getByRole("heading", { name: "時間軸" })).toBeVisible();

    const row = page.locator(`[data-testid="timeline-day"][data-date="${SEED_R2.logDate}"]`);
    await expect(row).toBeVisible();
    const badge = row.locator(`[data-testid="alert-badge"][data-rule="${SEED_R2.ruleKey}"]`);
    await expect(badge).toBeVisible();

    await row.getByTestId("respond-button").click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await choose(drawer, "status", RESPONSE_STATUS_NEED_HR);
    await fill(drawer, "comment", RESPONSE_COMMENT);
    await drawer.getByRole("button", { name: "送出回應" }).click();
    await expect(row.getByTestId("response-sent")).toBeVisible();

    // The action revalidated the timeline: the R2 now reads 已回應. `data-state`
    // is `responded` or `responded_late` depending on how long after 9/3 the
    // run happens (§7 A1: lateness only affects statistics), so both pass.
    await page.reload();
    await expect(badge).toHaveAttribute("data-state", /^responded(_late)?$/);
    await expect(badge).toContainText("已回應");
    const response = row.getByTestId("timeline-response");
    await expect(response).toContainText(RESPONSE_STATUS_NEED_HR);
    await expect(response).toContainText(RESPONSE_COMMENT);

    // …and the stored status really changed, not just the derived badge.
    const { data: after } = await createServiceRoleClient()
      .from("alerts")
      .select("status")
      .eq("id", alertId)
      .single()
      .throwOnError();
    expect(after.status).toBe("responded");

    await signOut(page);

    // --- 2. hr ---------------------------------------------------------------
    await signIn(page, ACCOUNTS.hr);
    await expect(page.getByRole("heading", { name: "人資儀表板" })).toBeVisible();

    // HR 介入清單 → 需 HR 協助 segment (components/dashboard/InterventionList.tsx).
    const intervention = page.getByTestId("intervention");
    await expect(intervention).toBeVisible();
    const entry = intervention.locator(
      `[data-testid="need-hr-entry"][data-user-id="${ACCOUNTS.newcomer.id}"]`,
    );
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText(ACCOUNTS.newcomer.displayName);
    await expect(entry).toContainText(RESPONSE_STATUS_NEED_HR);
    await expect(entry).toContainText(RESPONSE_COMMENT);

    // 待處理預警 lists `open` alerts only, and 逾時未回 is the `overdue` subset
    // of those: an answered alert is in neither.
    await expect(
      page.locator(`[data-testid="pending-alert"][data-alert-id="${alertId}"]`),
    ).toHaveCount(0);
    await expect(
      intervention.locator(`[data-testid="overdue-entry"][data-alert-id="${alertId}"]`),
    ).toHaveCount(0);
  });
});
