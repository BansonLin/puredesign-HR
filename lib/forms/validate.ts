/**
 * Form validation (CLAUDE.md §6, PLAN A06 / A07 / A11 / A12).
 *
 * `validatePublish` runs before a draft becomes the published version and
 * collects every reason (never stops at the first). `validateAnswers` runs
 * on every submission: only visible questions are validated, values are
 * trimmed, hidden / disabled questions are stored as `null`.
 */
import { resolveVisibility } from "@/lib/forms/resolve";
import {
  sortByOrder,
  USER_SELECT_ROLES,
  type Answers,
  type Question,
} from "@/lib/forms/schema";
import {
  RULE_REQUIRED_SLOTS,
  SLOT_SPECS,
  SLOTS,
  requiredSlotsFor,
  type FormTemplateKey,
  type Slot,
} from "@/lib/forms/slots";
import type { RulesSettings } from "@/lib/rules/constants";

export interface PublishContext {
  /** Template the draft belongs to; decides which system / rule slots must be bound. */
  templateKey: FormTemplateKey;
  /** Questions of the currently published version (null for the first publish). */
  previousPublished?: readonly Question[] | null;
}

export interface PublishValidation {
  ok: boolean;
  errors: string[];
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

function label(question: Question): string {
  return `題目「${question.label}」（${question.key}）`;
}

function isValidCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * §6 publish checks (all reasons collected):
 *  - key unique in the version; a key that was published before keeps its type;
 *  - active (not disabled) questions: single_select ≥ 2 options,
 *    user_select options exactly one of newcomer / manager, show_if points to
 *    an existing, active question with a smaller order, slot belongs to the template;
 *  - slot binding among active questions: system slots and slots of enabled
 *    rules exactly one question, other slots at most one;
 *  - requiredOptions ⊆ options of the bound question (response.status);
 *  - enabled rule parameter values ∈ options of the bound question.
 */
export function validatePublish(
  questions: readonly Question[],
  rules: Pick<RulesSettings, "R1" | "R2"> | null | undefined,
  context: PublishContext,
): PublishValidation {
  const errors: string[] = [];
  const ordered = sortByOrder(questions);

  if (ordered.length === 0) errors.push("表單至少要有一題");

  // key unique (disabled questions included, A07)
  const keyCount = new Map<string, number>();
  for (const q of ordered) keyCount.set(q.key, (keyCount.get(q.key) ?? 0) + 1);
  for (const [key, count] of keyCount) {
    if (count > 1) errors.push(`key「${key}」重複出現 ${count} 次，同一版本內 key 必須唯一`);
  }

  // published keys keep their type (§6; disabled questions included, A07)
  const previousTypes = new Map<string, Question["type"]>();
  for (const prev of context.previousPublished ?? []) previousTypes.set(prev.key, prev.type);
  for (const q of ordered) {
    const previousType = previousTypes.get(q.key);
    if (previousType !== undefined && previousType !== q.type) {
      errors.push(
        `${label(q)} 已發布過，型別不得由 ${previousType} 改為 ${q.type}`,
      );
    }
  }

  const active = ordered.filter((q) => !q.disabled);
  const byKey = new Map(ordered.map((q) => [q.key, q] as const));

  for (const q of active) {
    if (q.type === "single_select") {
      if (!q.options || q.options.length < 2) {
        errors.push(`${label(q)} 為單選題，至少需要 2 個選項`);
      }
    }
    if (q.type === "user_select") {
      const valid =
        q.options?.length === 1 &&
        (USER_SELECT_ROLES as readonly string[]).includes(q.options[0]);
      if (!valid) {
        errors.push(
          `${label(q)} 為人員選擇題，options 必須恰為 ['newcomer'] 或 ['manager']`,
        );
      }
    }
    if (q.show_if) {
      const target = byKey.get(q.show_if.question_key);
      if (!target) {
        errors.push(`${label(q)} 的顯示條件指向不存在的題目「${q.show_if.question_key}」`);
      } else if (target.disabled) {
        errors.push(`${label(q)} 的顯示條件指向已停用的題目「${target.key}」`);
      } else if (!(target.order < q.order)) {
        errors.push(`${label(q)} 的顯示條件只能指向排在前面的題目，「${target.key}」不在其前`);
      }
    }
    if (q.slot && SLOT_SPECS[q.slot].template !== context.templateKey) {
      errors.push(`${label(q)} 綁定的語意槽 ${q.slot} 不屬於範本 ${context.templateKey}`);
    }
  }

  // slot cardinality among active questions
  const bound = new Map<Slot, Question[]>();
  for (const q of active) {
    if (!q.slot) continue;
    const list = bound.get(q.slot) ?? [];
    list.push(q);
    bound.set(q.slot, list);
  }
  const required = new Set(requiredSlotsFor(context.templateKey, rules));
  for (const slot of SLOTS) {
    if (SLOT_SPECS[slot].template !== context.templateKey) continue;
    const holders = bound.get(slot) ?? [];
    if (holders.length > 1) {
      errors.push(
        `語意槽 ${slot} 被 ${holders.length} 題綁定（${holders.map((q) => q.key).join("、")}），同一版本內至多一題`,
      );
    } else if (holders.length === 0 && required.has(slot)) {
      errors.push(`語意槽 ${slot} 必須恰有一題綁定，目前沒有題目綁定`);
    }
  }

  // requiredOptions ⊆ options
  for (const slot of SLOTS) {
    const requiredOptions = SLOT_SPECS[slot].requiredOptions;
    if (requiredOptions.length === 0) continue;
    const holders = bound.get(slot) ?? [];
    if (holders.length !== 1) continue;
    const q = holders[0];
    const missing = requiredOptions.filter((v) => !(q.options ?? []).includes(v));
    if (missing.length > 0) {
      errors.push(
        `${label(q)}（語意槽 ${slot}）的選項缺少系統指標需要的值：${missing.map((v) => `「${v}」`).join("、")}`,
      );
    }
  }

  // enabled rule parameter values ∈ options of the bound question
  const optionsOfSlot = (slot: Slot): { q: Question; options: readonly string[] } | null => {
    const holders = bound.get(slot) ?? [];
    if (holders.length !== 1) return null;
    return { q: holders[0], options: holders[0].options ?? [] };
  };
  const assertInOptions = (rule: string, param: string, value: string, slot: Slot) => {
    const found = optionsOfSlot(slot);
    if (!found) return; // cardinality error already reported
    if (!found.options.includes(value)) {
      errors.push(
        `規則 ${rule} 的參數 ${param}「${value}」不在 ${label(found.q)}（語意槽 ${slot}）的選項中`,
      );
    }
  };
  if (context.templateKey === "newcomer_daily") {
    if (rules?.R1?.enabled) {
      for (const slot of RULE_REQUIRED_SLOTS.R1) {
        if (slot.endsWith(".expect")) {
          assertInOptions("R1", "expect_done", rules.R1.params.expect_done, slot);
        } else {
          for (const value of rules.R1.params.status_done) {
            assertInOptions("R1", "status_done", value, slot);
          }
        }
      }
    }
    if (rules?.R2?.enabled) {
      assertInOptions("R2", "unreported", rules.R2.params.unreported, "result.blocker.status");
    }
  }

  return { ok: errors.length === 0, errors };
}

export interface AnswersValidation {
  ok: boolean;
  /** Per-question reason, keyed by question key (visible questions only). */
  errors: Record<string, string>;
  /** Every key of the version; trimmed, `''` → `null`, hidden / disabled → `null`. */
  normalized: Answers;
}

function normalizeRaw(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/**
 * Validate one submission against its version (A11). Only visible questions
 * are checked: required, single_select ∈ options, date `YYYY-MM-DD`, number.
 */
export function validateAnswers(
  questions: readonly Question[],
  raw: Readonly<Record<string, unknown>> | null | undefined,
): AnswersValidation {
  const trimmed: Record<string, string | null> = {};
  for (const q of questions) trimmed[q.key] = normalizeRaw(raw?.[q.key]);

  const { visible, effective } = resolveVisibility(questions, trimmed);
  const errors: Record<string, string> = {};

  for (const q of visible) {
    const value = effective[q.key] ?? null;
    if (value === null) {
      if (q.required) errors[q.key] = "此題必填";
      continue;
    }
    switch (q.type) {
      case "single_select":
        if (!(q.options ?? []).includes(value)) errors[q.key] = "請從選項中選擇";
        break;
      case "date":
        if (!isValidCalendarDate(value)) errors[q.key] = "日期格式須為 YYYY-MM-DD";
        break;
      case "number":
        if (!NUMBER_PATTERN.test(value)) errors[q.key] = "請輸入數字";
        break;
      default:
        break;
    }
  }

  const normalized: Answers = {};
  for (const q of sortByOrder(questions)) normalized[q.key] = effective[q.key] ?? null;

  return { ok: Object.keys(errors).length === 0, errors, normalized };
}
