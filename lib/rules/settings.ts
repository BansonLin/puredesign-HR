/**
 * `settings.rules` validation (PLAN 4.8, T11).
 *
 * `parseRulesSettings(jsonb)` checks the shape with zod and returns a typed
 * `RulesSettings` for `runRules` / `validatePublish`. An invalid value throws
 * `RulesSettingsError` listing every reason (Traditional Chinese, with the
 * offending path) — never silently falls back to defaults (PLAN 4.8: neither
 * this nor `getSettings()` fills defaults; `/admin/rules` must fix the row).
 *
 * Unknown rule keys and unknown params are rejected (`strictObject`) so a typo
 * in `/admin/rules` cannot silently disable a rule.
 */
import { z } from "zod";

import { RULE_KEYS, type RulesSettings } from "@/lib/rules/constants";

const enabledSchema = z.boolean({ error: "enabled 必須是布林值" });

const nonEmptyString = (field: string) =>
  z
    .string({ error: `${field} 必須是字串` })
    .refine((value) => value.trim() !== "", { error: `${field} 不得為空` });

const R1Schema = z.strictObject(
  {
    enabled: enabledSchema,
    params: z.strictObject(
      {
        expect_done: nonEmptyString("expect_done"),
        status_done: z
          .array(nonEmptyString("status_done 的每個元素"), {
            error: "status_done 必須是字串陣列",
          })
          .min(1, { error: "status_done 至少要有一個值" }),
      },
      { error: "params 必須是物件" },
    ),
  },
  { error: "R1 必須是物件" },
);

const R2Schema = z.strictObject(
  {
    enabled: enabledSchema,
    params: z.strictObject(
      { unreported: nonEmptyString("unreported") },
      { error: "params 必須是物件" },
    ),
  },
  { error: "R2 必須是物件" },
);

const DerivedRuleSchema = (key: string) =>
  z.strictObject({ enabled: enabledSchema }, { error: `${key} 必須是物件` });

export const RulesSettingsSchema = z.strictObject(
  {
    R1: R1Schema,
    R2: R2Schema,
    R3: DerivedRuleSchema("R3"),
    A1: DerivedRuleSchema("A1"),
  },
  { error: "rules 必須是物件" },
);

// Keep the zod shape and the hand-written `RulesSettings` type in lock-step:
// a mismatch fails typecheck here instead of at a call site.
type Parsed = z.infer<typeof RulesSettingsSchema>;
const _assignable: RulesSettings = null as unknown as Parsed;
void _assignable;

export class RulesSettingsError extends Error {
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    super(`settings.rules 格式不正確：${reasons.join("；")}`);
    this.name = "RulesSettingsError";
    this.reasons = reasons;
  }
}

function describePath(path: PropertyKey[]): string {
  if (path.length === 0) return "rules";
  return `rules.${path.map(String).join(".")}`;
}

function unrecognizedMessage(issue: z.core.$ZodIssue): string | null {
  if (issue.code !== "unrecognized_keys") return null;
  const known = issue.path.length === 0 ? RULE_KEYS.join("、") : null;
  const keys = issue.keys.map((k) => `「${k}」`).join("、");
  return known === null ? `未知的欄位 ${keys}` : `未知的規則 ${keys}（只允許 ${known}）`;
}

/**
 * Collect every reason from a failed parse as `rules.<path>：<原因>`.
 * Exported for the /admin/rules form (T24), which shows reasons without throwing.
 */
export function rulesSettingsErrors(input: unknown): string[] {
  const result = RulesSettingsSchema.safeParse(input);
  if (result.success) return [];
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const issue of result.error.issues) {
    const message = `${describePath(issue.path)}：${unrecognizedMessage(issue) ?? issue.message}`;
    if (seen.has(message)) continue;
    seen.add(message);
    errors.push(message);
  }
  return errors;
}

/** Validate the `settings.rules` jsonb; throws `RulesSettingsError` with every reason. */
export function parseRulesSettings(input: unknown): RulesSettings {
  const result = RulesSettingsSchema.safeParse(input);
  if (result.success) return result.data;
  throw new RulesSettingsError(rulesSettingsErrors(input));
}
