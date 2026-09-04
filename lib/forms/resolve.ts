/**
 * Reading answers through a form version (CLAUDE.md §6, PLAN A11).
 *
 * - `getAnswer`: missing key, non-string or empty string → `null`. Shared by
 *   `lib/rules` (R1 「非空」 = `getAnswer` is not null).
 * - `evaluateShowIf`: the A11 truth table — every op is `false` on `null`;
 *   `eq` / `neq` are exact string comparisons, `in` is `includes`.
 * - `visibleQuestions`: disabled questions and questions whose `show_if`
 *   fails are hidden; a hidden question counts as `null` for the questions
 *   after it (chained conditions), matching what `validateAnswers` stores.
 * - `bySlot` / `readYesterdayPlan`: cross-version reads go through slots,
 *   never keys.
 */
import { sortByOrder, type Answers, type Question, type ShowIf } from "@/lib/forms/schema";
import type { Slot } from "@/lib/forms/slots";

/** Raw answers as they come from jsonb / form state; values may be anything. */
export type RawAnswers = Readonly<Record<string, unknown>> | null | undefined;

export function getAnswer(answers: RawAnswers, key: string): string | null {
  if (!answers) return null;
  const value = answers[key];
  if (typeof value !== "string") return null;
  return value === "" ? null : value;
}

export function evaluateShowIf(showIf: ShowIf | undefined, answers: RawAnswers): boolean {
  if (!showIf) return true;
  const value = getAnswer(answers, showIf.question_key);
  if (value === null) return false;
  switch (showIf.op) {
    case "eq":
      return value === showIf.value;
    case "neq":
      return value !== showIf.value;
    case "in":
      return showIf.value.includes(value);
    case "not_empty":
      return true;
  }
}

export interface VisibilityResult {
  /** Visible questions in display order. */
  visible: Question[];
  /** Every question of the version with hidden / disabled ones forced to `null`. */
  effective: Answers;
}

/**
 * Walk the version in `order`; a question hidden by `show_if` or `disabled`
 * contributes `null` to the answers seen by later conditions.
 */
export function resolveVisibility(
  questions: readonly Question[],
  answers: RawAnswers,
): VisibilityResult {
  const effective: Record<string, string | null> = {};
  const visible: Question[] = [];
  for (const question of sortByOrder(questions)) {
    const shown = !question.disabled && evaluateShowIf(question.show_if, effective);
    if (shown) {
      visible.push(question);
      effective[question.key] = getAnswer(answers, question.key);
    } else {
      effective[question.key] = null;
    }
  }
  return { visible, effective };
}

export function visibleQuestions(questions: readonly Question[], answers: RawAnswers): Question[] {
  return resolveVisibility(questions, answers).visible;
}

export type SlotValues = Partial<Record<Slot, string | null>>;

/** Answers of one submission keyed by slot; disabled questions are ignored (A07). */
export function bySlot(questions: readonly Question[], answers: RawAnswers): SlotValues {
  const { effective } = resolveVisibility(questions, answers);
  const values: SlotValues = {};
  for (const question of sortByOrder(questions)) {
    if (question.disabled || !question.slot) continue;
    values[question.slot] = effective[question.key] ?? null;
  }
  return values;
}

export interface PlanItem {
  text: string | null;
  expect: string | null;
}

export interface YesterdayPlan {
  /** Items 1–3 (index 0–2). */
  items: [PlanItem, PlanItem, PlanItem];
  top: string | null;
  support: { need: string | null; detail: string | null };
}

/** A fresh empty plan: three distinct item objects, safe for callers to mutate. */
function emptyYesterdayPlan(): YesterdayPlan {
  return {
    items: [
      { text: null, expect: null },
      { text: null, expect: null },
      { text: null, expect: null },
    ],
    top: null,
    support: { need: null, detail: null },
  };
}

/**
 * Deep-frozen reference value of the empty plan (for comparisons);
 * `readYesterdayPlan` never returns this object.
 */
export const EMPTY_YESTERDAY_PLAN: Readonly<YesterdayPlan> = (() => {
  const plan = emptyYesterdayPlan();
  for (const item of plan.items) Object.freeze(item);
  Object.freeze(plan.items);
  Object.freeze(plan.support);
  return Object.freeze(plan);
})();

/**
 * "昨日計畫" of the previous log (§6): read by slot so a log written with an
 * older version resolves the same way. `null` previous log / version → a
 * fresh empty plan (a new object on every call).
 */
export function readYesterdayPlan(
  previousAnswers: RawAnswers,
  previousQuestions: readonly Question[] | null | undefined,
): YesterdayPlan {
  if (!previousAnswers || !previousQuestions) return emptyYesterdayPlan();
  const slots = bySlot(previousQuestions, previousAnswers);
  const item = (i: 1 | 2 | 3): PlanItem => ({
    text: slots[`plan.item${i}.text`] ?? null,
    expect: slots[`plan.item${i}.expect`] ?? null,
  });
  return {
    items: [item(1), item(2), item(3)],
    top: slots["plan.top_priority"] ?? null,
    support: {
      need: slots["plan.support.need"] ?? null,
      detail: slots["plan.support.detail"] ?? null,
    },
  };
}
