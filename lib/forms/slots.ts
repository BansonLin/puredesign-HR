/**
 * Semantic slots — the fixed interface between form questions and the rules
 * (CLAUDE.md §6). This file is the single source of the 25 slot names.
 *
 * Every slot carries (PLAN A06):
 *   - `template`: the form template it belongs to (a slot may only be bound
 *     by questions of that template);
 *   - `cardinality`: `exactly_one` for system slots (always required, not
 *     affected by /admin/rules) — rule-required slots become `exactly_one`
 *     only while the rule is enabled (see `requiredSlotsFor`); everything
 *     else is `at_most_one`;
 *   - `requiredOptions`: values the bound single_select must offer.
 */
import {
  RESPONSE_STATUS_REQUIRED_OPTIONS,
  type RuleKey,
  type RulesSettings,
} from "@/lib/rules/constants";

export const SLOTS = [
  "plan.item1.text",
  "plan.item1.expect",
  "plan.item2.text",
  "plan.item2.expect",
  "plan.item3.text",
  "plan.item3.expect",
  "plan.top_priority",
  "plan.support.need",
  "plan.support.detail",
  "result.item1.status",
  "result.item1.reason",
  "result.item2.status",
  "result.item2.reason",
  "result.item3.status",
  "result.item3.reason",
  "result.extra_work",
  "result.blocker.status",
  "result.blocker.detail",
  "result.learned",
  "response.status",
  "response.comment",
  "weekly.start_date",
  "weekly.good",
  "weekly.improve",
  "weekly.next_focus",
] as const;

export type Slot = (typeof SLOTS)[number];

/** The three fixed template keys (§5 form_templates.key). */
export type FormTemplateKey = "newcomer_daily" | "manager_response" | "weekly_feedback";

export type SlotCardinality = "exactly_one" | "at_most_one";

export interface SlotSpec {
  template: FormTemplateKey;
  cardinality: SlotCardinality;
  requiredOptions: readonly string[];
}

/**
 * System slots (A06): always bound by exactly one question of their template,
 * regardless of which rules are enabled.
 */
export const SYSTEM_SLOTS = [
  "plan.item1.text",
  "plan.item1.expect",
  "response.status",
  "weekly.start_date",
] as const satisfies readonly Slot[];

/** Slots each rule reads (§7). R3 / A1 are derived from timestamps, not slots. */
export const RULE_REQUIRED_SLOTS = {
  R1: [
    "plan.item1.expect",
    "result.item1.status",
    "plan.item2.expect",
    "result.item2.status",
    "plan.item3.expect",
    "result.item3.status",
  ],
  R2: ["result.blocker.status"],
  R3: [],
  A1: [],
} as const satisfies Record<RuleKey, readonly Slot[]>;

function templateOf(slot: Slot): FormTemplateKey {
  if (slot.startsWith("response.")) return "manager_response";
  if (slot.startsWith("weekly.")) return "weekly_feedback";
  return "newcomer_daily";
}

function specOf(slot: Slot): SlotSpec {
  return {
    template: templateOf(slot),
    cardinality: (SYSTEM_SLOTS as readonly Slot[]).includes(slot)
      ? "exactly_one"
      : "at_most_one",
    requiredOptions: slot === "response.status" ? RESPONSE_STATUS_REQUIRED_OPTIONS : [],
  };
}

export const SLOT_SPECS: Readonly<Record<Slot, SlotSpec>> = SLOTS.reduce(
  (specs, slot) => {
    specs[slot] = specOf(slot);
    return specs;
  },
  {} as Record<Slot, SlotSpec>,
);

export function isSlot(value: unknown): value is Slot {
  return typeof value === "string" && (SLOTS as readonly string[]).includes(value);
}

/** Slots of `template` that must be bound by exactly one question: system slots plus the slots of every enabled rule. */
export function requiredSlotsFor(
  template: FormTemplateKey,
  rules: Pick<RulesSettings, "R1" | "R2"> | null | undefined,
): Slot[] {
  const required = new Set<Slot>();
  for (const slot of SYSTEM_SLOTS) {
    if (SLOT_SPECS[slot].template === template) required.add(slot);
  }
  for (const rule of ["R1", "R2"] as const) {
    if (!rules?.[rule]?.enabled) continue;
    for (const slot of RULE_REQUIRED_SLOTS[rule]) {
      if (SLOT_SPECS[slot].template === template) required.add(slot);
    }
  }
  return SLOTS.filter((slot) => required.has(slot));
}
