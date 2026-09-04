/**
 * Running the alert rules and reconciling the result with the existing
 * `alerts` rows of one daily log (CLAUDE.md §7, PLAN A10).
 *
 * Both functions are pure and touch no database. The submit pipeline (T14
 * `prepareDailyLog`), the HR "重跑該筆規則" action and the seed all go
 * through here, and `applyAlertChanges` (lib/db/queries/alerts.ts) writes
 * the `ReconcileResult` in one place, so every path shares one state machine.
 *
 *   runRules   : SlotValues → AlertDraft[] (only rules with `enabled: true`)
 *   reconcile  : (existing rows, drafts, now) → insert / updateDetail / close /
 *                reopen / untouched, at most one row per (submission, rule_key)
 *
 * State machine (A10), per rule key:
 *   holds     & no row        → insert (created_at = now)
 *   holds     & open          → updateDetail only (created_at untouched, A1 clock keeps running)
 *                               — or untouched when the detail is unchanged
 *   holds     & responded     → untouched
 *   holds     & closed        → reopen: open, created_at = now, closed_* / responded_* cleared
 *   not holds & open          → close: closed_at = now, closed_by = null, closed_reason = 'resubmitted'
 *   not holds & responded     → untouched
 *   not holds & closed        → untouched
 */
import type { RulesSettings } from "@/lib/rules/constants";
import { r1 } from "@/lib/rules/r1";
import { r2 } from "@/lib/rules/r2";
import type {
  AlertDraft,
  ExistingAlertLike,
  ReconcileResult,
} from "@/lib/rules/types";
import type { SlotValues } from "@/lib/forms/resolve";
import { toInstant, type Instant } from "@/lib/time";

export interface RunRulesInput {
  /** The log being submitted, resolved by slot (`bySlot(activeVersion.questions, answers)`). */
  current: SlotValues;
  /** The previous non-deleted log of the same newcomer, resolved by ITS version; null for the first log. */
  previous: SlotValues | null;
  /** Validated `settings.rules` (`parseRulesSettings`). */
  settings: RulesSettings;
}

/** Run every enabled alert rule; R3 / A1 are derived states and produce no rows. */
export function runRules({ current, previous, settings }: RunRulesInput): AlertDraft[] {
  const drafts: AlertDraft[] = [];
  if (settings.R1.enabled) drafts.push(...r1({ current, previous, params: settings.R1.params }));
  if (settings.R2.enabled) drafts.push(...r2({ current, previous, params: settings.R2.params }));
  return drafts;
}

export interface ReconcileInput<E extends ExistingAlertLike> {
  /** Every `alerts` row of this submission (all statuses). */
  existing: readonly E[];
  /** Output of `runRules` for the same submission. */
  drafts: readonly AlertDraft[];
  /** The log's `submitted_at` (new rows and reopened rows get this as `created_at`). */
  now: Instant;
}

/** Structural equality of JSON-like values (object key order ignored). */
export function detailEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => detailEquals(item, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((k) => left[k] !== undefined);
  const otherKeys = Object.keys(right).filter((k) => right[k] !== undefined);
  if (keys.length !== otherKeys.length) return false;
  return keys.every((k) => k in right && detailEquals(left[k], right[k]));
}

export function reconcile<E extends ExistingAlertLike>({
  existing,
  drafts,
  now,
}: ReconcileInput<E>): ReconcileResult<E> {
  const at = toInstant(now).toISOString();
  const result: ReconcileResult<E> = {
    insert: [],
    updateDetail: [],
    close: [],
    reopen: [],
    untouched: [],
  };

  // One draft per rule key (the rules already guarantee this; a duplicate
  // would violate unique(submission_id, rule_key), so the last one wins).
  const byRule = new Map<string, AlertDraft>();
  for (const draft of drafts) byRule.set(draft.rule_key, draft);

  const seen = new Set<string>();
  for (const alert of existing) {
    // A duplicate rule key cannot exist in the database (unique index); if a
    // caller hands one in, later copies are left untouched rather than acted on twice.
    if (seen.has(alert.rule_key)) {
      result.untouched.push(alert);
      continue;
    }
    seen.add(alert.rule_key);

    const draft = byRule.get(alert.rule_key);
    if (draft) {
      switch (alert.status) {
        case "open":
          if (detailEquals(alert.detail, draft.detail)) result.untouched.push(alert);
          else result.updateDetail.push({ alert, detail: draft.detail });
          break;
        case "responded":
          result.untouched.push(alert);
          break;
        case "closed":
          result.reopen.push({ alert, detail: draft.detail, created_at: at });
          break;
      }
    } else if (alert.status === "open") {
      result.close.push({ alert, closed_at: at, closed_reason: "resubmitted" });
    } else {
      result.untouched.push(alert);
    }
  }

  for (const draft of byRule.values()) {
    if (seen.has(draft.rule_key)) continue;
    result.insert.push({ rule_key: draft.rule_key, detail: draft.detail, created_at: at });
  }

  return result;
}
