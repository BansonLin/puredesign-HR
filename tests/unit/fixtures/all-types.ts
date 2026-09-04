/**
 * T13 renderer fixture: one question of each of the six §6 types plus a fake
 * `userOptions` list. Not a seed file — the §11 v1 versions use only
 * single_select / short_text / date, so the other three types are exercised
 * here only.
 */
import { parseQuestions, type Question } from "@/lib/forms/schema";

const RAW = [
  {
    key: "mood",
    label: "今天狀態",
    type: "single_select",
    options: ["很好", "普通", "不佳"],
    required: true,
    help: "選一個最接近的",
    slot: null,
    order: 1,
    disabled: false,
  },
  {
    key: "headline",
    label: "一句話",
    type: "short_text",
    required: true,
    placeholder: "例：今天完成了什麼",
    slot: null,
    order: 2,
    disabled: false,
  },
  {
    key: "story",
    label: "詳細說明",
    type: "long_text",
    required: false,
    placeholder: "想到什麼都可以寫",
    slot: null,
    order: 3,
    disabled: false,
  },
  {
    key: "when",
    label: "日期",
    type: "date",
    required: true,
    slot: null,
    order: 4,
    disabled: false,
  },
  {
    key: "hours",
    label: "工時",
    type: "number",
    required: false,
    help: "以小時計",
    slot: null,
    order: 5,
    disabled: false,
  },
  {
    key: "buddy",
    label: "今天帶你的主管",
    type: "user_select",
    options: ["manager"],
    required: false,
    slot: null,
    order: 6,
    disabled: false,
  },
] as const;

const parsed = parseQuestions(RAW);
if (!parsed.ok) throw new Error(`all-types fixture is invalid: ${parsed.errors.join("; ")}`);

export const ALL_TYPES_QUESTIONS: readonly Question[] = parsed.questions;

export const ALL_TYPES_USER_OPTIONS = [
  { id: "11111111-1111-4111-8111-111111111111", display_name: "工務主任" },
  { id: "22222222-2222-4222-8222-222222222222", display_name: "採購主管" },
] as const;
