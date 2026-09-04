/**
 * `01_base` seed data (PLAN 4.9.1): departments, the four `settings` rows
 * (PLAN 4.8), the three form templates with their v1 questions (CLAUDE.md
 * §11, verbatim) and the three admin/HR/CEO accounts (PLAN 4.9.4).
 *
 * Pure data, `as const`; nothing here touches the database. Loaded by
 * `seed.ts --base` (also on production) and by the Vitest fixtures
 * (`tests/unit/fixtures.test.ts`, later `forms-*.test.ts`, `rules.test.ts`).
 *
 * Fixed UUID rule (PLAN 4.9.2): `0000000T-0000-4000-8000-0000000000NN`,
 * T = table code, NN = running number.
 *   1 departments · 2 profiles (= auth.users.id) · 3 form_templates · 4 form_versions
 *
 * Question shape follows CLAUDE.md §6; the zod schema in `lib/forms/schema.ts`
 * (T10) is the runtime authority — this local type only keeps the literals
 * honest at typecheck time.
 */

export type SeedQuestionType =
  | "single_select"
  | "short_text"
  | "long_text"
  | "date"
  | "number"
  | "user_select";

export type SeedShowIfOp = "eq" | "neq" | "in" | "not_empty";

export interface SeedShowIf {
  question_key: string;
  op: SeedShowIfOp;
  value?: string | readonly string[];
}

export interface SeedQuestion {
  key: string;
  label: string;
  type: SeedQuestionType;
  options?: readonly string[];
  required: boolean;
  help?: string;
  placeholder?: string;
  show_if?: SeedShowIf;
  slot: string | null;
  order: number;
  disabled: boolean;
}

export type SeedRole = "newcomer" | "manager" | "hr" | "ceo" | "admin";
export type SeedProfileStatus = "active" | "left" | "sample";

/** A profile row keyed by natural keys; `seed.ts` resolves department/manager to UUIDs. */
export interface SeedProfile {
  /** Fixed UUID; also the Supabase Auth user id (PLAN 4.9.2). */
  id: string;
  username: string;
  display_name: string;
  role: SeedRole;
  /** `departments.name`, resolved at seed time. */
  department: string | null;
  /** `profiles.username` of the manager, resolved at seed time. */
  manager_username: string | null;
  start_date: string | null;
  status: SeedProfileStatus;
  must_change_password: boolean;
}

/** Login e-mail domain for `{username}@pure.internal` (CLAUDE.md §3; mirrors lib/auth/session.ts). */
export const AUTH_EMAIL_DOMAIN = "pure.internal";

// ---------------------------------------------------------------------------
// departments (§11)
// ---------------------------------------------------------------------------

export const DEPARTMENTS = [
  { id: "00000001-0000-4000-8000-000000000001", name: "工務", sort_order: 1 },
  { id: "00000001-0000-4000-8000-000000000002", name: "採購", sort_order: 2 },
  { id: "00000001-0000-4000-8000-000000000003", name: "設計", sort_order: 3 },
  { id: "00000001-0000-4000-8000-000000000004", name: "信義設計", sort_order: 4 },
] as const;

export type DepartmentName = (typeof DEPARTMENTS)[number]["name"];

// ---------------------------------------------------------------------------
// settings (PLAN 4.8). The R1/R2 literals are the §7 defaults; T10 keeps the
// same values in lib/rules/constants.ts (A06) and its tests pin both together.
// ---------------------------------------------------------------------------

export const RULES_SETTINGS = {
  R1: {
    enabled: true,
    params: { expect_done: "完成", status_done: ["完成", "昨日無此項"] },
  },
  R2: {
    enabled: true,
    params: { unreported: "有，尚未回報" },
  },
  R3: { enabled: true },
  A1: { enabled: true },
} as const;

export const SETTINGS = {
  daily_cutoff_time: "18:00",
  response_threshold_hours: 24,
  rules: RULES_SETTINGS,
  workweek: "mon_fri",
} as const;

export type SettingKey = keyof typeof SETTINGS;

// ---------------------------------------------------------------------------
// form templates + v1 questions (§11)
// ---------------------------------------------------------------------------

const RESULT_STATUS_OPTIONS = ["完成", "持續中", "取消", "昨日無此項"] as const;
const EXPECT_OPTIONS = ["完成", "跨日"] as const;
const NOT_DONE = ["持續中", "取消"] as const;

/** §11 newcomer_daily v1: 19 questions (#1 "name" is the submitter, not a question). */
export const NEWCOMER_DAILY_QUESTIONS = [
  {
    key: "r1_status",
    label: "昨日項目一狀態",
    type: "single_select",
    options: RESULT_STATUS_OPTIONS,
    required: true,
    slot: "result.item1.status",
    order: 1,
    disabled: false,
  },
  {
    key: "r1_reason",
    label: "項目一未完成原因",
    type: "short_text",
    required: false,
    show_if: { question_key: "r1_status", op: "in", value: NOT_DONE },
    slot: "result.item1.reason",
    order: 2,
    disabled: false,
  },
  {
    key: "r2_status",
    label: "昨日項目二狀態",
    type: "single_select",
    options: RESULT_STATUS_OPTIONS,
    required: true,
    slot: "result.item2.status",
    order: 3,
    disabled: false,
  },
  {
    key: "r2_reason",
    label: "項目二未完成原因",
    type: "short_text",
    required: false,
    show_if: { question_key: "r2_status", op: "in", value: NOT_DONE },
    slot: "result.item2.reason",
    order: 4,
    disabled: false,
  },
  {
    key: "r3_status",
    label: "昨日項目三狀態",
    type: "single_select",
    options: RESULT_STATUS_OPTIONS,
    required: true,
    slot: "result.item3.status",
    order: 5,
    disabled: false,
  },
  {
    key: "r3_reason",
    label: "項目三未完成原因",
    type: "short_text",
    required: false,
    show_if: { question_key: "r3_status", op: "in", value: NOT_DONE },
    slot: "result.item3.reason",
    order: 6,
    disabled: false,
  },
  {
    key: "extra_work",
    label: "臨時新增工作",
    type: "short_text",
    required: false,
    slot: "result.extra_work",
    order: 7,
    disabled: false,
  },
  {
    key: "blocker",
    label: "今日卡點",
    type: "single_select",
    options: ["沒有", "有，已找人處理中", "有，已解決", "有，尚未回報"],
    required: true,
    slot: "result.blocker.status",
    order: 8,
    disabled: false,
  },
  {
    key: "blocker_detail",
    label: "卡點說明",
    type: "short_text",
    required: false,
    show_if: { question_key: "blocker", op: "neq", value: "沒有" },
    slot: "result.blocker.detail",
    order: 9,
    disabled: false,
  },
  {
    key: "learned",
    label: "今日學到一件事",
    type: "short_text",
    required: false,
    slot: "result.learned",
    order: 10,
    disabled: false,
  },
  {
    key: "p1_text",
    label: "明日項目一",
    type: "short_text",
    required: true,
    slot: "plan.item1.text",
    order: 11,
    disabled: false,
  },
  {
    key: "p1_expect",
    label: "明日項目一預計",
    type: "single_select",
    options: EXPECT_OPTIONS,
    required: true,
    slot: "plan.item1.expect",
    order: 12,
    disabled: false,
  },
  {
    key: "p2_text",
    label: "明日項目二",
    type: "short_text",
    required: false,
    slot: "plan.item2.text",
    order: 13,
    disabled: false,
  },
  {
    key: "p2_expect",
    label: "明日項目二預計",
    type: "single_select",
    options: EXPECT_OPTIONS,
    required: false,
    show_if: { question_key: "p2_text", op: "not_empty" },
    slot: "plan.item2.expect",
    order: 14,
    disabled: false,
  },
  {
    key: "p3_text",
    label: "明日項目三",
    type: "short_text",
    required: false,
    slot: "plan.item3.text",
    order: 15,
    disabled: false,
  },
  {
    key: "p3_expect",
    label: "明日項目三預計",
    type: "single_select",
    options: EXPECT_OPTIONS,
    required: false,
    show_if: { question_key: "p3_text", op: "not_empty" },
    slot: "plan.item3.expect",
    order: 16,
    disabled: false,
  },
  {
    key: "top",
    label: "明日最重要的一件事",
    type: "single_select",
    options: ["項目一", "項目二", "項目三"],
    required: true,
    slot: "plan.top_priority",
    order: 17,
    disabled: false,
  },
  {
    key: "support",
    label: "明日需要支援",
    type: "single_select",
    options: ["不需要", "需要"],
    required: true,
    slot: "plan.support.need",
    order: 18,
    disabled: false,
  },
  {
    key: "support_detail",
    label: "支援對象與內容",
    type: "short_text",
    required: false,
    show_if: { question_key: "support", op: "eq", value: "需要" },
    slot: "plan.support.detail",
    order: 19,
    disabled: false,
  },
] as const satisfies readonly SeedQuestion[];

/** §11 manager_response v1 (target newcomer / target log come from the UI, not questions). */
export const MANAGER_RESPONSE_QUESTIONS = [
  {
    key: "status",
    label: "處理狀態",
    type: "single_select",
    options: ["已讀，無需處理", "已處理", "需 HR 協助"],
    required: true,
    slot: "response.status",
    order: 1,
    disabled: false,
  },
  {
    key: "comment",
    label: "一句話回饋",
    type: "short_text",
    required: false,
    slot: "response.comment",
    order: 2,
    disabled: false,
  },
] as const satisfies readonly SeedQuestion[];

/** §11 weekly_feedback v1. */
export const WEEKLY_FEEDBACK_QUESTIONS = [
  {
    key: "week_start",
    label: "週起始日",
    type: "date",
    required: true,
    slot: "weekly.start_date",
    order: 1,
    disabled: false,
  },
  {
    key: "good",
    label: "做得好的一件事",
    type: "short_text",
    required: true,
    slot: "weekly.good",
    order: 2,
    disabled: false,
  },
  {
    key: "improve",
    label: "要改的一件事",
    type: "short_text",
    required: true,
    slot: "weekly.improve",
    order: 3,
    disabled: false,
  },
  {
    key: "next_focus",
    label: "下週重點",
    type: "short_text",
    required: true,
    slot: "weekly.next_focus",
    order: 4,
    disabled: false,
  },
] as const satisfies readonly SeedQuestion[];

export type NewcomerDailyKey = (typeof NEWCOMER_DAILY_QUESTIONS)[number]["key"];
export type ManagerResponseKey = (typeof MANAGER_RESPONSE_QUESTIONS)[number]["key"];
export type WeeklyFeedbackKey = (typeof WEEKLY_FEEDBACK_QUESTIONS)[number]["key"];

/** v1 rows are "published" as of the go-live date; `published_by` stays null (PLAN 4.9.2). */
export const V1_PUBLISHED_AT = "2026-09-01T00:00:00+08:00";
export const V1_CHANGE_NOTE = "初版";

export const FORM_TEMPLATES = [
  {
    id: "00000003-0000-4000-8000-000000000001",
    key: "newcomer_daily",
    name: "新人每日日誌",
    description: null,
    target_role: "newcomer",
    v1: {
      id: "00000004-0000-4000-8000-000000000001",
      version_no: 1,
      questions: NEWCOMER_DAILY_QUESTIONS,
    },
  },
  {
    id: "00000003-0000-4000-8000-000000000002",
    key: "manager_response",
    name: "主管回應",
    description: null,
    target_role: "manager",
    v1: {
      id: "00000004-0000-4000-8000-000000000002",
      version_no: 1,
      questions: MANAGER_RESPONSE_QUESTIONS,
    },
  },
  {
    id: "00000003-0000-4000-8000-000000000003",
    key: "weekly_feedback",
    name: "週回饋",
    description: null,
    target_role: "manager",
    v1: {
      id: "00000004-0000-4000-8000-000000000003",
      version_no: 1,
      questions: WEEKLY_FEEDBACK_QUESTIONS,
    },
  },
] as const;

export type FormTemplateKey = (typeof FORM_TEMPLATES)[number]["key"];

// ---------------------------------------------------------------------------
// base accounts (PLAN 4.9.4, A01/A03): no first-login password change.
// ---------------------------------------------------------------------------

export const BASE_PROFILES = [
  {
    id: "00000002-0000-4000-8000-000000000001",
    username: "banson",
    display_name: "Banson",
    role: "admin",
    department: null,
    manager_username: null,
    start_date: null,
    status: "active",
    must_change_password: false,
  },
  {
    id: "00000002-0000-4000-8000-000000000002",
    username: "hr",
    display_name: "HR",
    role: "hr",
    department: null,
    manager_username: null,
    start_date: null,
    status: "active",
    must_change_password: false,
  },
  {
    id: "00000002-0000-4000-8000-000000000003",
    username: "ceo",
    display_name: "CEO",
    role: "ceo",
    department: null,
    manager_username: null,
    start_date: null,
    status: "active",
    must_change_password: false,
  },
] as const satisfies readonly SeedProfile[];
