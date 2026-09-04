/**
 * Rule defaults and the two `response.status` literals (PLAN A06).
 *
 * Single source for: `settings.rules` seed defaults (supabase/seed/fixtures/base.ts
 * `RULES_SETTINGS` — `tests/unit/forms-publish.test.ts` pins both deep-equal),
 * the `/admin/rules` defaults, the metrics literals (§7 誤報率 / 需 HR 協助) and
 * `lib/forms/slots.ts` (`response.status.requiredOptions`).
 *
 * Pure constants, no imports: `lib/forms` and `lib/rules` both depend on this
 * file, so it must stay at the bottom of the import graph.
 *
 * Comparisons everywhere are trim-then-exact (A06): no full/half-width
 * normalization, so the full-width commas below are significant.
 */

/** §7 誤報率 numerator: the manager read the alert and no action was needed. */
export const RESPONSE_STATUS_NO_ACTION = "已讀，無需處理";
/** §7 HR intervention list: the manager asks HR for help. */
export const RESPONSE_STATUS_NEED_HR = "需 HR 協助";

/** `response.status` values the published manager_response form must offer (A06). */
export const RESPONSE_STATUS_REQUIRED_OPTIONS = [
  RESPONSE_STATUS_NO_ACTION,
  RESPONSE_STATUS_NEED_HR,
] as const;

/** §7 rule keys; R3 / A1 are derived states and only carry `enabled`. */
export const RULE_KEYS = ["R1", "R2", "R3", "A1"] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

/** R1 progress: `plan.item{i}.expect == expect_done` and `result.item{i}.status ∉ status_done`. */
export const R1_DEFAULT_PARAMS = {
  expect_done: "完成",
  status_done: ["完成", "昨日無此項"],
} as const;

/** R2 blocker: `result.blocker.status == unreported`. */
export const R2_DEFAULT_PARAMS = {
  unreported: "有，尚未回報",
} as const;

export interface R1Params {
  expect_done: string;
  status_done: readonly string[];
}

export interface R2Params {
  unreported: string;
}

/**
 * Shape of `settings.rules` (PLAN 4.8). `lib/rules/settings.ts` (T11) validates
 * the jsonb with zod and returns this shape; `lib/forms/validate.ts` only
 * reads `enabled` and `params` from it.
 */
export interface RulesSettings {
  R1: { enabled: boolean; params: R1Params };
  R2: { enabled: boolean; params: R2Params };
  R3: { enabled: boolean };
  A1: { enabled: boolean };
}

/** Default `settings.rules` value (PLAN 4.8); deep-equal to the seed's `RULES_SETTINGS`. */
export const RULES_DEFAULTS = {
  R1: { enabled: true, params: R1_DEFAULT_PARAMS },
  R2: { enabled: true, params: R2_DEFAULT_PARAMS },
  R3: { enabled: true },
  A1: { enabled: true },
} as const satisfies RulesSettings;
