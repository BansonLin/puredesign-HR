import { describe, expect, it } from "vitest";

import {
  ERROR_PAST_LOG,
  ERROR_PREVIOUS_VERSION_MISSING,
  FORM_ERROR_KEY,
  prepareDailyLog,
  type DailyLogLike,
  type ExistingDailyLog,
  type PrepareDailyLogInput,
  type PrepareDailyLogResult,
  type VersionLike,
} from "@/lib/forms/submit";
import type { Question } from "@/lib/forms/schema";
import { parseRulesSettings } from "@/lib/rules/settings";
import type { ExistingAlertLike } from "@/lib/rules/types";
import {
  EXPECTED_ALERTS,
  FIXTURE_DAILY_LOGS,
  FIXTURE_RESPONSES,
  NEWCOMER_DAILY_QUESTIONS,
  RULES_SETTINGS,
  YEN_R1_RESPONSE_LAG_MS,
} from "@seed/fixtures";

/**
 * T14 `prepareDailyLog` (pure): Taipei log_date and the 23:59 boundary,
 * validation, rules by slot across versions, and the reconcile plan — on
 * 嚴雅齡's / 洪湘庭's §11 logs. No database: `existingToday.alerts` are
 * in-memory rows shaped like `alerts`.
 */

const SETTINGS = parseRulesSettings(RULES_SETTINGS);
const YEN = "00000002-0000-4000-8000-000000000009";
const V1: VersionLike = { id: "v1", questions: NEWCOMER_DAILY_QUESTIONS };

type FixtureLog = (typeof FIXTURE_DAILY_LOGS)[number];

function fixtureLog(username: string, logDate: string): FixtureLog {
  const found = FIXTURE_DAILY_LOGS.find((l) => l.username === username && l.log_date === logDate);
  if (!found) throw new Error(`no fixture log for ${username} ${logDate}`);
  return found;
}

/** A stored daily-log row built from a fixture entry (answers as jsonb, instants in UTC). */
function storedLog(
  entry: FixtureLog,
  overrides: Partial<DailyLogLike> = {},
): DailyLogLike {
  return {
    id: `log-${entry.seq}`,
    user_id: YEN,
    form_version_id: V1.id,
    log_date: entry.log_date,
    submitted_at: new Date(entry.submitted_at).toISOString(),
    answers: entry.answers,
    ...overrides,
  };
}

interface AlertRow extends ExistingAlertLike {
  id: string;
  created_at: string;
}

const YEN_0902 = fixtureLog("yen_yaling", "2026-09-02");
const YEN_0903 = fixtureLog("yen_yaling", "2026-09-03");
const YEN_R1 = EXPECTED_ALERTS.find((a) => a.username === "yen_yaling" && a.rule_key === "R1")!;
const HUNG_R2 = EXPECTED_ALERTS.find((a) => a.username === "hung_hsiangting" && a.rule_key === "R2")!;

/** 9/3 17:03 Taipei — 嚴雅齡's fixture `submitted_at`. */
const T_0903_1703 = new Date("2026-09-03T09:03:00Z");
/** 9/3 23:59 Taipei — still 9/3. */
const T_0903_2359 = new Date("2026-09-03T15:59:00Z");
/** 9/4 00:00 Taipei — a new log date. */
const T_0904_0000 = new Date("2026-09-03T16:00:00Z");

function baseInput(
  overrides: Partial<PrepareDailyLogInput<AlertRow>> = {},
): PrepareDailyLogInput<AlertRow> {
  return {
    now: T_0903_1703,
    actor: { id: YEN },
    activeVersion: V1,
    existingToday: null,
    previousLog: storedLog(YEN_0902),
    previousVersion: V1,
    rawAnswers: YEN_0903.answers,
    settings: SETTINGS,
    ...overrides,
  };
}

function prepared(overrides: Partial<PrepareDailyLogInput<AlertRow>> = {}) {
  const result = prepareDailyLog(baseInput(overrides));
  if (!result.ok) throw new Error(`unexpected errors: ${JSON.stringify(result.errors)}`);
  return result;
}

/** What the 9/3 17:03 first submit leaves in the database (one open R1). */
function yenExistingToday(
  overrides: Partial<ExistingDailyLog<AlertRow>> = {},
): ExistingDailyLog<AlertRow> {
  const first = prepared();
  const insert = first.alertPlan.insert[0]!;
  return {
    ...storedLog(YEN_0903, { id: "log-6" }),
    answers: first.answers,
    alerts: [
      {
        id: "alert-r1",
        rule_key: insert.rule_key,
        status: "open",
        detail: insert.detail,
        created_at: insert.created_at,
      },
    ],
    ...overrides,
  };
}

function errorsOf(result: PrepareDailyLogResult<AlertRow>): Record<string, string> {
  if (result.ok) throw new Error("expected a failure");
  return result.errors;
}

describe("prepareDailyLog — first submit (嚴雅齡 9/3 17:03)", () => {
  it("uses the Taipei date of `now` as log_date and the previous log as 9/2", () => {
    const result = prepared();
    expect(result.log_date).toBe("2026-09-03");
    expect(result.user_id).toBe(YEN);
    expect(result.form_version_id).toBe("v1");
    expect(result.existing_id).toBeNull();
    expect(result.submitted_at).toBe("2026-09-03T09:03:00.000Z");
    expect(result.updated_at).toBe("2026-09-03T09:03:00.000Z");
  });

  it("plans exactly one R1 insert with the §11 detail (items 1 and 3)", () => {
    const { alertPlan } = prepared();
    expect(alertPlan.insert).toEqual([
      { rule_key: "R1", detail: YEN_R1.detail, created_at: "2026-09-03T09:03:00.000Z" },
    ]);
    expect(alertPlan.updateDetail).toEqual([]);
    expect(alertPlan.close).toEqual([]);
    expect(alertPlan.reopen).toEqual([]);
    expect(alertPlan.untouched).toEqual([]);
  });

  it("stamps a new alert with created_at = submitted_at so the 9/4 09:10 response is ≈16.1h later", () => {
    const result = prepared();
    const insert = result.alertPlan.insert[0]!;
    expect(insert.created_at).toBe(result.submitted_at);
    expect(new Date(insert.created_at).toISOString()).toBe(
      new Date(YEN_R1.created_at).toISOString(),
    );
    const response = FIXTURE_RESPONSES.find((r) => r.seq === YEN_R1.response_seq)!;
    const lag = new Date(response.submitted_at).getTime() - new Date(insert.created_at).getTime();
    expect(lag).toBe(YEN_R1_RESPONSE_LAG_MS);
  });

  it("stores every key of the version, with hidden questions as null", () => {
    const result = prepared({
      rawAnswers: {
        ...YEN_0903.answers,
        r2_reason: "should be dropped: item 2 is 完成",
        blocker: "沒有",
        blocker_detail: "should be dropped: blocker is 沒有",
        support_detail: "should be dropped: support is 不需要",
      },
    });
    const keys = NEWCOMER_DAILY_QUESTIONS.map((q) => q.key);
    expect(Object.keys(result.answers).sort()).toEqual([...keys].sort());
    expect(result.answers.r2_reason).toBeNull();
    expect(result.answers.blocker_detail).toBeNull();
    expect(result.answers.support_detail).toBeNull();
    expect(result.answers.r1_reason).toBe("案件利潤表工項明細不確定，已問 Patty");
  });

  it("洪湘庭 9/3 → exactly one R2 insert and no R1", () => {
    const hung0902 = fixtureLog("hung_hsiangting", "2026-09-02");
    const hung0903 = fixtureLog("hung_hsiangting", "2026-09-03");
    const hungId = "00000002-0000-4000-8000-000000000011";
    const result = prepareDailyLog<AlertRow>(
      baseInput({
        now: new Date(hung0903.submitted_at),
        actor: { id: hungId },
        previousLog: storedLog(hung0902, { user_id: hungId }),
        rawAnswers: hung0903.answers,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alertPlan.insert).toEqual([
      { rule_key: "R2", detail: HUNG_R2.detail, created_at: "2026-09-03T09:06:00.000Z" },
    ]);
  });

  it("first log of a newcomer (no previous) → zero alerts", () => {
    const result = prepared({
      now: new Date(YEN_0902.submitted_at),
      previousLog: null,
      previousVersion: null,
      rawAnswers: YEN_0902.answers,
    });
    expect(result.log_date).toBe("2026-09-02");
    expect(result.alertPlan.insert).toEqual([]);
  });
});

describe("prepareDailyLog — resubmit and the 23:59 boundary", () => {
  it("same day 23:59 → updates the same row: submitted_at kept, updated_at = now, alert untouched", () => {
    const existing = yenExistingToday();
    const result = prepared({ now: T_0903_2359, existingToday: existing });
    expect(result.log_date).toBe("2026-09-03");
    expect(result.existing_id).toBe("log-6");
    expect(result.submitted_at).toBe(existing.submitted_at);
    expect(result.submitted_at).toBe("2026-09-03T09:03:00.000Z");
    expect(result.updated_at).toBe("2026-09-03T15:59:00.000Z");
    expect(result.alertPlan.insert).toEqual([]);
    expect(result.alertPlan.untouched.map((a) => a.id)).toEqual(["alert-r1"]);
  });

  it("00:00 next day with no log for that date → a new 9/4 row whose previous is 9/3", () => {
    const result = prepared({
      now: T_0904_0000,
      existingToday: null,
      previousLog: storedLog(YEN_0903, { id: "log-6" }),
      rawAnswers: {
        ...YEN_0903.answers,
        r1_status: "完成",
        r1_reason: null,
        r2_status: "完成",
        r3_status: "昨日無此項",
        r3_reason: null,
      },
    });
    expect(result.log_date).toBe("2026-09-04");
    expect(result.existing_id).toBeNull();
    expect(result.submitted_at).toBe("2026-09-03T16:00:00.000Z");
    expect(result.alertPlan.insert).toEqual([]);
  });

  it("editing the 9/3 log on 9/4 → 已超過可修改時間", () => {
    const result = prepareDailyLog(
      baseInput({ now: T_0904_0000, existingToday: yenExistingToday() }),
    );
    expect(errorsOf(result)).toEqual({ [FORM_ERROR_KEY]: ERROR_PAST_LOG });
    expect("alertPlan" in result).toBe(false);
  });

  it("resubmitting with all three items 完成 → closes the open R1 with reason resubmitted", () => {
    const result = prepared({
      now: T_0903_2359,
      existingToday: yenExistingToday(),
      rawAnswers: {
        ...YEN_0903.answers,
        r1_status: "完成",
        r1_reason: null,
        r2_status: "完成",
        r3_status: "完成",
        r3_reason: null,
      },
    });
    expect(result.alertPlan.insert).toEqual([]);
    expect(result.alertPlan.close).toHaveLength(1);
    const close = result.alertPlan.close[0]!;
    expect(close.alert.id).toBe("alert-r1");
    expect(close.closed_reason).toBe("resubmitted");
    expect(close.closed_at).toBe("2026-09-03T15:59:00.000Z");
  });

  it("resubmitting with a changed reason → updateDetail only", () => {
    const result = prepared({
      now: T_0903_2359,
      existingToday: yenExistingToday(),
      rawAnswers: { ...YEN_0903.answers, r1_reason: "改了原因" },
    });
    expect(result.alertPlan.updateDetail).toHaveLength(1);
    expect(result.alertPlan.updateDetail[0]!.alert.id).toBe("alert-r1");
    expect(result.alertPlan.close).toEqual([]);
    expect(result.alertPlan.insert).toEqual([]);
  });

  it("a closed R1 that holds again → reopen with created_at = now", () => {
    const existing = yenExistingToday();
    existing.alerts[0]!.status = "closed";
    const result = prepared({ now: T_0903_2359, existingToday: existing });
    expect(result.alertPlan.reopen).toHaveLength(1);
    expect(result.alertPlan.reopen[0]!.created_at).toBe("2026-09-03T15:59:00.000Z");
  });
});

describe("prepareDailyLog — validation", () => {
  it("a missing required answer → per-question errors and no alertPlan", () => {
    const raw: Record<string, unknown> = { ...YEN_0903.answers };
    delete raw.r1_status;
    const result = prepareDailyLog(baseInput({ rawAnswers: raw }));
    expect(errorsOf(result)).toEqual({ r1_status: "此題必填" });
    expect("alertPlan" in result).toBe(false);
    expect("answers" in result).toBe(false);
  });

  it("a value outside the options → error on that question", () => {
    const result = prepareDailyLog(
      baseInput({ rawAnswers: { ...YEN_0903.answers, blocker: "不存在的選項" } }),
    );
    expect(errorsOf(result).blocker).toBe("請從選項中選擇");
  });

  it("a previous log without its version → form error", () => {
    const result = prepareDailyLog(baseInput({ previousVersion: null }));
    expect(errorsOf(result)).toEqual({ [FORM_ERROR_KEY]: ERROR_PREVIOUS_VERSION_MISSING });
  });
});

describe("prepareDailyLog — previous log on an older version resolves by slot (§6)", () => {
  /** v0: same questions with every key renamed; the slots are what carry over. */
  const V0_QUESTIONS = NEWCOMER_DAILY_QUESTIONS.map((q: Question) => ({
    ...q,
    key: `${q.key}_v0`,
    show_if: q.show_if ? { ...q.show_if, question_key: `${q.show_if.question_key}_v0` } : undefined,
  }));
  const V0: VersionLike = { id: "v0", questions: V0_QUESTIONS };
  const v0Answers = Object.fromEntries(
    Object.entries(YEN_0902.answers).map(([key, value]) => [`${key}_v0`, value]),
  );

  it("R1 still triggers when the 9/2 plan was written with different keys", () => {
    const result = prepared({
      previousLog: storedLog(YEN_0902, { form_version_id: "v0", answers: v0Answers }),
      previousVersion: V0,
    });
    expect(result.alertPlan.insert).toEqual([
      { rule_key: "R1", detail: YEN_R1.detail, created_at: "2026-09-03T09:03:00.000Z" },
    ]);
  });

  it("the previous version id must match the previous log's form_version_id", () => {
    const result = prepareDailyLog(
      baseInput({
        previousLog: storedLog(YEN_0902, { form_version_id: "v0", answers: v0Answers }),
        previousVersion: V1,
      }),
    );
    expect(errorsOf(result)).toEqual({ [FORM_ERROR_KEY]: ERROR_PREVIOUS_VERSION_MISSING });
  });
});
