/**
 * Runtime schema for `form_versions.questions` (CLAUDE.md §6 `Question`).
 *
 * zod v4 is the authority: `parseQuestions(jsonb)` turns an untrusted jsonb
 * value into `Question[]` or a list of Traditional-Chinese reasons. Types are
 * inferred from the schemas so the seed data, the renderer (T13) and the
 * admin editor (T14) all share one shape.
 *
 * `ShowIf` is a discriminated union on `op` (PLAN T10): `eq` / `neq` carry a
 * string `value`, `in` a string array, `not_empty` no value at all.
 */
import { z } from "zod";

import { SLOTS } from "@/lib/forms/slots";

export const QUESTION_TYPES = [
  "single_select",
  "short_text",
  "long_text",
  "date",
  "number",
  "user_select",
] as const;

export const SHOW_IF_OPS = ["eq", "neq", "in", "not_empty"] as const;

/** `user_select.options` must be exactly one of these (A12). */
export const USER_SELECT_ROLES = ["newcomer", "manager"] as const;

/** §6: 英數底線; fixed once published. */
export const QUESTION_KEY_PATTERN = /^[A-Za-z0-9_]+$/;

export const QuestionTypeSchema = z.enum(QUESTION_TYPES, {
  error: `type 必須是 ${QUESTION_TYPES.join("、")} 其中之一`,
});

export const SlotSchema = z.enum(SLOTS, { error: "slot 不是 §6 定義的語意槽" });

const questionKeySchema = z
  .string({ error: "key 必須是字串" })
  .min(1, { error: "key 不得為空" })
  .regex(QUESTION_KEY_PATTERN, { error: "key 只能使用英文、數字與底線" });

const showIfTarget = z.string({ error: "show_if.question_key 必須是字串" }).min(1, {
  error: "show_if.question_key 不得為空",
});

export const ShowIfSchema = z.discriminatedUnion(
  "op",
  [
    z.object({
      question_key: showIfTarget,
      op: z.literal("eq"),
      value: z.string({ error: "show_if.op 為 eq 時 value 必須是字串" }),
    }),
    z.object({
      question_key: showIfTarget,
      op: z.literal("neq"),
      value: z.string({ error: "show_if.op 為 neq 時 value 必須是字串" }),
    }),
    z.object({
      question_key: showIfTarget,
      op: z.literal("in"),
      value: z
        .array(z.string({ error: "show_if.value 的每個元素必須是字串" }), {
          error: "show_if.op 為 in 時 value 必須是字串陣列",
        })
        .readonly(),
    }),
    z.object({
      question_key: showIfTarget,
      op: z.literal("not_empty"),
      value: z
        .undefined({ error: "show_if.op 為 not_empty 時不得有 value" })
        .optional(),
    }),
  ],
  { error: `show_if.op 必須是 ${SHOW_IF_OPS.join("、")} 其中之一` },
);

export const QuestionSchema = z.object({
  key: questionKeySchema,
  label: z.string({ error: "label 必須是字串" }).min(1, { error: "label 不得為空" }),
  type: QuestionTypeSchema,
  options: z
    .array(z.string({ error: "options 的每個元素必須是字串" }), {
      error: "options 必須是字串陣列",
    })
    .readonly()
    .optional(),
  required: z.boolean({ error: "required 必須是布林值" }),
  help: z.string({ error: "help 必須是字串" }).optional(),
  placeholder: z.string({ error: "placeholder 必須是字串" }).optional(),
  show_if: ShowIfSchema.optional(),
  slot: SlotSchema.nullable().optional(),
  order: z
    .number({ error: "order 必須是數字" })
    .int({ error: "order 必須是整數" }),
  disabled: z.boolean({ error: "disabled 必須是布林值" }),
});

export const QuestionsSchema = z.array(QuestionSchema, {
  error: "questions 必須是題目陣列",
});

export type QuestionType = z.infer<typeof QuestionTypeSchema>;
export type ShowIfOp = (typeof SHOW_IF_OPS)[number];
export type ShowIf = z.infer<typeof ShowIfSchema>;
export type Question = z.infer<typeof QuestionSchema>;

/** `submissions.answers` (§6): every key of the version, `null` = empty (A11). */
export type Answers = Record<string, string | null>;

export type ParseQuestionsResult =
  | { ok: true; questions: Question[]; errors: [] }
  | { ok: false; questions: null; errors: string[] };

function describeLocation(input: unknown, path: PropertyKey[]): string {
  if (path.length === 0) return "questions";
  const [index, ...rest] = path;
  if (typeof index !== "number") return `questions.${path.map(String).join(".")}`;
  const item = Array.isArray(input) ? (input[index] as unknown) : undefined;
  const key =
    item && typeof item === "object" && typeof (item as { key?: unknown }).key === "string"
      ? (item as { key: string }).key
      : null;
  const where = key === null ? `第 ${index + 1} 題` : `第 ${index + 1} 題（${key}）`;
  return rest.length === 0 ? where : `${where} ${rest.map(String).join(".")}`;
}

/**
 * Parse the jsonb of one form version. Never throws; on failure every reason
 * is listed as `第 N 題（key） 欄位：原因`.
 */
export function parseQuestions(input: unknown): ParseQuestionsResult {
  const result = QuestionsSchema.safeParse(input);
  if (result.success) return { ok: true, questions: result.data, errors: [] };
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const issue of result.error.issues) {
    const message = `${describeLocation(input, issue.path)}：${issue.message}`;
    if (seen.has(message)) continue;
    seen.add(message);
    errors.push(message);
  }
  return { ok: false, questions: null, errors };
}

/** Questions of a version in display order (stable for equal `order`). */
export function sortByOrder<T extends { order: number }>(questions: readonly T[]): T[] {
  return questions
    .map((q, index) => ({ q, index }))
    .sort((a, b) => a.q.order - b.q.order || a.index - b.index)
    .map(({ q }) => q);
}
