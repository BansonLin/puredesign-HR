/**
 * R2 blocker (CLAUDE.md §7): `result.blocker.status == unreported` → one R2
 * alert carrying `result.blocker.detail`. Only the current log is read.
 * Comparison is trim-then-exact (A06); null never triggers (A11).
 */
import type { AlertDraft, R2Input } from "@/lib/rules/types";

export function r2({ current, params }: R2Input): AlertDraft[] {
  const status = current["result.blocker.status"];
  if (typeof status !== "string" || status.trim() !== params.unreported.trim()) return [];
  return [{ rule_key: "R2", detail: { text: current["result.blocker.detail"] ?? null } }];
}
