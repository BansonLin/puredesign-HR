/**
 * R1 progress (CLAUDE.md §7).
 *
 * For i ∈ {1, 2, 3}: the previous log planned item i as `expect_done` and the
 * current log reports a status that is non-empty and not in `status_done` →
 * the item is collected. Any collected item → exactly one R1 alert.
 *
 * No previous log → nothing (§11: 9/2 logs produce zero alerts). Null status
 * (item not answered / hidden) never triggers (A11). Comparisons are trim-then-
 * exact (A06).
 */
import type { AlertDraft, PlanItemIndex, R1DetailItem, R1Input } from "@/lib/rules/types";

const ITEMS: readonly PlanItemIndex[] = [1, 2, 3];

function same(a: string | null | undefined, b: string): boolean {
  return typeof a === "string" && a.trim() === b.trim();
}

export function r1({ current, previous, params }: R1Input): AlertDraft[] {
  if (!previous) return [];
  const items: R1DetailItem[] = [];
  for (const i of ITEMS) {
    if (!same(previous[`plan.item${i}.expect`], params.expect_done)) continue;
    const status = current[`result.item${i}.status`];
    if (typeof status !== "string" || status.trim() === "") continue;
    if (params.status_done.some((done) => same(status, done))) continue;
    items.push({
      i,
      plan_text: previous[`plan.item${i}.text`] ?? null,
      status,
      reason: current[`result.item${i}.reason`] ?? null,
    });
  }
  return items.length === 0 ? [] : [{ rule_key: "R1", detail: { items } }];
}
