/**
 * Seed plan for the §11 fixture submissions (PLAN T16, 4.9.2 / 4.9.4 / 4.9.6).
 *
 * Pure: turns `FIXTURE_DAILY_LOGS` / `FIXTURE_RESPONSES` /
 * `FIXTURE_WEEKLY_FEEDBACK` into the rows `seed.ts` writes and the alerts
 * those rows must end up with — without touching the database. It runs the
 * SAME pipeline as the /me/today Server Action (`prepareDailyLog` =
 * `validateAnswers` → `bySlot` → `runRules` → `reconcile`), so the expected
 * alerts here are computed by the rules, not typed by hand; the unit test
 * (tests/unit/seed-plan.test.ts) pins them to `EXPECTED_ALERTS`, and
 * `seed.ts` compares what the database holds after seeding against this plan
 * (「seed 與規則永不分岐」).
 *
 * `shiftDays` implements `--anchor` (PLAN 4.9.6): every `log_date` /
 * `submitted_at` moves by the same number of calendar days (Asia/Taipei has
 * no DST, so the Taipei clock time is preserved); the weekly feedback's
 * `week_start` is recomputed with `weekStartMonday` from the shifted
 * submission date (the feedback stays "this week's"), and `answers.week_start`
 * follows it. `shiftDays = 0` is the fixed §11 timeline used by CI and the
 * unit tests.
 *
 * `seed.ts` is the only file with a top-level `main()`; this module exports
 * functions only so vitest can import it.
 */
import type { Answers } from "@/lib/forms/schema";
import { prepareDailyLog, type VersionLike } from "@/lib/forms/submit";
import { validateAnswers } from "@/lib/forms/validate";
import { parseQuestions } from "@/lib/forms/schema";
import { parseRulesSettings } from "@/lib/rules/settings";
import type { AlertRuleKey } from "@/lib/rules/types";
import {
  addDaysTo,
  taipeiDateOf,
  toInstant,
  weekStartMonday,
  type DateString,
  type Instant,
} from "@/lib/time";

import {
  FIXTURE_DAILY_LOGS,
  FIXTURE_PROFILES,
  FIXTURE_RESPONSES,
  FIXTURE_WEEKLY_FEEDBACK,
  FORM_TEMPLATES,
  RULES_SETTINGS,
} from "./fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Shift an instant by whole days; returns UTC ISO (`toISOString()`). Taipei has no DST, so 1 day = 24h. */
export function shiftInstant(instant: Instant, days: number): string {
  return new Date(toInstant(instant).getTime() + days * DAY_MS).toISOString();
}

/** Shift a `YYYY-MM-DD` date by whole days. */
export function shiftDate(date: DateString, days: number): DateString {
  return addDaysTo(date, days);
}

export interface PlannedDailyLog {
  seq: number;
  username: string;
  /** profiles.id of the newcomer (fixed fixture UUID). */
  user_id: string;
  /** newcomer_daily v1 (fixed fixture UUID). */
  form_version_id: string;
  log_date: DateString;
  /** UTC ISO. */
  submitted_at: string;
  /** Normalized by `validateAnswers` (every v1 key; hidden / empty → null). */
  answers: Answers;
}

export interface PlannedAlert {
  /** `seq` of the daily log the alert hangs on. */
  log_seq: number;
  username: string;
  rule_key: AlertRuleKey;
  status: "open" | "responded";
  /** UTC ISO = the log's `submitted_at`. */
  created_at: string;
  /** UTC ISO = the response's `submitted_at`, when responded. */
  responded_at: string | null;
  /** `seq` of the manager_response submission, when responded. */
  response_seq: number | null;
  detail: Record<string, unknown>;
}

export interface PlannedResponse {
  seq: number;
  username: string;
  /** profiles.id of the manager. */
  user_id: string;
  target_username: string;
  /** profiles.id of the newcomer. */
  target_user_id: string;
  /** `seq` of the daily log this response targets. */
  target_log_seq: number;
  /** manager_response v1. */
  form_version_id: string;
  /** UTC ISO. */
  submitted_at: string;
  answers: Answers;
}

export interface PlannedWeekly {
  seq: number;
  username: string;
  user_id: string;
  target_username: string;
  target_user_id: string;
  /** weekly_feedback v1. */
  form_version_id: string;
  /** Monday, `YYYY-MM-DD`; equals `answers.week_start`. */
  week_start: DateString;
  /** UTC ISO. */
  submitted_at: string;
  answers: Answers;
}

export interface SeedPlan {
  shiftDays: number;
  /** In write order (log_date, then seq). */
  logs: PlannedDailyLog[];
  responses: PlannedResponse[];
  weekly: PlannedWeekly[];
  /** Final state after responses are applied; sorted by (log_seq, rule_key). */
  alerts: PlannedAlert[];
}

export interface SeedPlanOptions {
  /** `--anchor` offset: calendar days from FIXTURE_ANCHOR_DATE to the anchor; default 0. */
  shiftDays?: number;
}

function profileId(username: string): string {
  const found = FIXTURE_PROFILES.find((p) => p.username === username);
  if (!found) throw new Error(`seed plan: fixture 沒有帳號 ${username}`);
  return found.id;
}

function versionOf(key: (typeof FORM_TEMPLATES)[number]["key"]): VersionLike {
  const template = FORM_TEMPLATES.find((t) => t.key === key);
  if (!template) throw new Error(`seed plan: fixture 沒有範本 ${key}`);
  return { id: template.v1.id, questions: template.v1.questions };
}

/** Normalize a fixture answers object through the same validator the app uses. */
function normalizeAnswers(
  label: string,
  version: VersionLike,
  raw: Readonly<Record<string, unknown>>,
): Answers {
  const parsed = parseQuestions(version.questions);
  if (!parsed.ok) throw new Error(`seed plan: ${label} 的表單版本無法解析：${parsed.errors.join("；")}`);
  const validation = validateAnswers(parsed.questions, raw);
  if (!validation.ok) {
    throw new Error(`seed plan: ${label} 的答案未通過驗證：${JSON.stringify(validation.errors)}`);
  }
  return validation.normalized;
}

function byDateThenSeq<T extends { log_date: string; seq: number }>(a: T, b: T): number {
  if (a.log_date !== b.log_date) return a.log_date < b.log_date ? -1 : 1;
  return a.seq - b.seq;
}

/**
 * Build the rows and the expected alerts for the §11 submissions.
 * Throws when the fixture itself is inconsistent (an answer fails
 * validation, a response targets an unknown log, …) — a seed must never
 * silently write a broken fixture.
 */
export function buildSeedPlan(opts: SeedPlanOptions = {}): SeedPlan {
  const shiftDays = opts.shiftDays ?? 0;
  const settings = parseRulesSettings(RULES_SETTINGS);
  const dailyV1 = versionOf("newcomer_daily");
  const responseV1 = versionOf("manager_response");
  const weeklyV1 = versionOf("weekly_feedback");

  // --- daily logs, in log_date order, each against its previous planned log
  const logs: PlannedDailyLog[] = [];
  const alerts: PlannedAlert[] = [];
  const entries = [...FIXTURE_DAILY_LOGS].sort(byDateThenSeq);
  for (const entry of entries) {
    const userId = profileId(entry.username);
    const logDate = shiftDate(entry.log_date, shiftDays);
    const submittedAt = shiftInstant(entry.submitted_at, shiftDays);
    if (taipeiDateOf(submittedAt) !== logDate) {
      throw new Error(
        `seed plan: 日誌 seq ${entry.seq} 的 submitted_at（${entry.submitted_at}）不在 log_date ${entry.log_date} 當天`,
      );
    }
    // §6 / A05 (6): the latest earlier log of the same newcomer.
    const previous =
      logs
        .filter((l) => l.user_id === userId && l.log_date < logDate)
        .sort((a, b) => (a.log_date < b.log_date ? 1 : -1))[0] ?? null;

    const prepared = prepareDailyLog({
      now: submittedAt,
      actor: { id: userId },
      activeVersion: dailyV1,
      existingToday: null,
      previousLog: previous
        ? {
            id: `seq-${previous.seq}`,
            user_id: previous.user_id,
            form_version_id: previous.form_version_id,
            log_date: previous.log_date,
            submitted_at: previous.submitted_at,
            answers: previous.answers,
          }
        : null,
      previousVersion: previous ? dailyV1 : null,
      rawAnswers: entry.answers,
      settings,
    });
    if (!prepared.ok) {
      throw new Error(
        `seed plan: 日誌 seq ${entry.seq}（${entry.username} ${entry.log_date}）未通過 prepareDailyLog：${JSON.stringify(prepared.errors)}`,
      );
    }

    logs.push({
      seq: entry.seq,
      username: entry.username,
      user_id: userId,
      form_version_id: dailyV1.id,
      log_date: prepared.log_date,
      submitted_at: prepared.submitted_at,
      answers: prepared.answers,
    });
    for (const insert of prepared.alertPlan.insert) {
      alerts.push({
        log_seq: entry.seq,
        username: entry.username,
        rule_key: insert.rule_key,
        status: "open",
        created_at: insert.created_at,
        responded_at: null,
        response_seq: null,
        detail: insert.detail as unknown as Record<string, unknown>,
      });
    }
  }

  // --- manager responses: open alerts of the target log → responded
  const responses: PlannedResponse[] = [];
  for (const entry of FIXTURE_RESPONSES) {
    const target = logs.find((l) => l.seq === entry.target_log_seq);
    if (!target) throw new Error(`seed plan: 回應 seq ${entry.seq} 指向不存在的日誌 seq ${entry.target_log_seq}`);
    if (target.username !== entry.target_username) {
      throw new Error(
        `seed plan: 回應 seq ${entry.seq} 的對象 ${entry.target_username} 與日誌 seq ${entry.target_log_seq}（${target.username}）不符`,
      );
    }
    const submittedAt = shiftInstant(entry.submitted_at, shiftDays);
    responses.push({
      seq: entry.seq,
      username: entry.username,
      user_id: profileId(entry.username),
      target_username: entry.target_username,
      target_user_id: target.user_id,
      target_log_seq: entry.target_log_seq,
      form_version_id: responseV1.id,
      submitted_at: submittedAt,
      answers: normalizeAnswers(`回應 seq ${entry.seq}`, responseV1, entry.answers),
    });
    for (const alert of alerts) {
      if (alert.log_seq === entry.target_log_seq && alert.status === "open") {
        alert.status = "responded";
        alert.responded_at = submittedAt;
        alert.response_seq = entry.seq;
      }
    }
  }

  // --- weekly feedback: week_start = Monday of the (shifted) submission week
  const weekly: PlannedWeekly[] = [];
  for (const entry of FIXTURE_WEEKLY_FEEDBACK) {
    const submittedAt = shiftInstant(entry.submitted_at, shiftDays);
    const weekStart = weekStartMonday(taipeiDateOf(submittedAt));
    if (shiftDays === 0 && weekStart !== entry.week_start) {
      throw new Error(
        `seed plan: 週回饋 seq ${entry.seq} 的 week_start ${entry.week_start} 不是提交日所在週的週一（${weekStart}）`,
      );
    }
    weekly.push({
      seq: entry.seq,
      username: entry.username,
      user_id: profileId(entry.username),
      target_username: entry.target_username,
      target_user_id: profileId(entry.target_username),
      form_version_id: weeklyV1.id,
      week_start: weekStart,
      submitted_at: submittedAt,
      answers: normalizeAnswers(`週回饋 seq ${entry.seq}`, weeklyV1, {
        ...entry.answers,
        week_start: weekStart,
      }),
    });
  }

  alerts.sort((a, b) => a.log_seq - b.log_seq || (a.rule_key < b.rule_key ? -1 : 1));

  return { shiftDays, logs, responses, weekly, alerts };
}
