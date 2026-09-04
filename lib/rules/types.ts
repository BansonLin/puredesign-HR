/**
 * Types shared by the alert rules (CLAUDE.md §7 R1 / R2, PLAN A10).
 *
 * The rules never read `answers` directly: the caller resolves the current
 * and previous daily log through `bySlot` (lib/forms/resolve.ts) and hands in
 * `SlotValues`, so a previous log written with an older form version resolves
 * the same way (§6 「靠 slot 不靠 key」).
 *
 * `detail` shapes are fixed by PLAN 4.3 alerts: R1 `{ items: [{ i, plan_text,
 * status, reason }] }`, R2 `{ text }`.
 */
import type { SlotValues } from "@/lib/forms/resolve";
import type { R1Params, R2Params } from "@/lib/rules/constants";

/** Rule keys that produce alert rows (R3 / A1 are derived states, lib/rules/derived.ts). */
export type AlertRuleKey = "R1" | "R2";

export type PlanItemIndex = 1 | 2 | 3;

export interface R1DetailItem {
  i: PlanItemIndex;
  /** `plan.item{i}.text` of the previous log. */
  plan_text: string | null;
  /** `result.item{i}.status` of the current log (never null: null does not trigger). */
  status: string;
  /** `result.item{i}.reason` of the current log. */
  reason: string | null;
}

export interface R1Detail {
  items: R1DetailItem[];
}

export interface R2Detail {
  /** `result.blocker.detail` of the current log. */
  text: string | null;
}

export type AlertDraft =
  | { rule_key: "R1"; detail: R1Detail }
  | { rule_key: "R2"; detail: R2Detail };

/** Input of one rule function: current / previous log by slot plus its parameters. */
export interface RuleInput<P> {
  current: SlotValues;
  /** The previous (non-deleted) log of the same newcomer, or null (first log). */
  previous: SlotValues | null;
  params: P;
}

export type R1Input = RuleInput<R1Params>;
export type R2Input = RuleInput<R2Params>;

/**
 * The columns of an `alerts` row that `reconcile` reads. `Tables<'alerts'>`
 * satisfies this; tests may pass minimal objects. Extra properties (id, …)
 * are carried through unchanged so the caller can address the rows.
 */
export interface ExistingAlertLike {
  rule_key: string;
  status: "open" | "responded" | "closed";
  detail: unknown;
}

export type AlertClosedReason = "resubmitted";

/** A brand-new row: `created_at` = the `now` handed to `reconcile` (= the log's `submitted_at`). */
export interface AlertInsert {
  rule_key: AlertRuleKey;
  detail: AlertDraft["detail"];
  /** UTC ISO string. */
  created_at: string;
}

/** Still holds and `open`: only `detail` changes, `created_at` is untouched (A1 clock keeps running). */
export interface AlertDetailUpdate<E extends ExistingAlertLike> {
  alert: E;
  detail: AlertDraft["detail"];
}

/** No longer holds and `open`: closed by the system (`closed_by` null). */
export interface AlertClose<E extends ExistingAlertLike> {
  alert: E;
  /** UTC ISO string. */
  closed_at: string;
  closed_reason: AlertClosedReason;
}

/** Was `closed`, holds again: back to `open` with a fresh `created_at`; closed_* / responded_* cleared. */
export interface AlertReopen<E extends ExistingAlertLike> {
  alert: E;
  detail: AlertDraft["detail"];
  /** UTC ISO string. */
  created_at: string;
}

export interface ReconcileResult<E extends ExistingAlertLike> {
  insert: AlertInsert[];
  updateDetail: AlertDetailUpdate<E>[];
  close: AlertClose<E>[];
  reopen: AlertReopen<E>[];
  untouched: E[];
}
