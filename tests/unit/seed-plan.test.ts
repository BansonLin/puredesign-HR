import { describe, expect, it } from "vitest";

import { weekStartMonday } from "@/lib/time";
import {
  EXPECTED_ALERT_FREE_LOG_SEQS,
  EXPECTED_ALERTS,
  EXPECTED_ROW_COUNTS,
  FIXTURE_DAILY_LOGS,
  FIXTURE_RESPONSES,
  FIXTURE_WEEKLY_FEEDBACK,
  FORM_TEMPLATES,
  NEWCOMER_DAILY_QUESTIONS,
  YEN_R1_RESPONSE_LAG_MS,
} from "@seed/fixtures";
import { buildSeedPlan, shiftDate, shiftInstant, type PlannedAlert } from "@seed/plan";

/**
 * T16 seed plan (pure): the §11 fixture run through the SAME pipeline as
 * /me/today (`prepareDailyLog`) must reproduce `EXPECTED_ALERTS` exactly,
 * responses must flip the targeted open alerts to `responded`, and the
 * `--anchor` shift must keep every date equidistant and `week_start` a Monday.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const iso = (value: string | null): string | null =>
  value === null ? null : new Date(value).toISOString();

/** `EXPECTED_ALERTS` with instants in `toISOString()` form (what the plan emits). */
const EXPECTED: PlannedAlert[] = EXPECTED_ALERTS.map((a) => ({
  log_seq: a.log_seq,
  username: a.username,
  rule_key: a.rule_key,
  status: a.status,
  created_at: iso(a.created_at)!,
  responded_at: iso(a.responded_at),
  response_seq: a.response_seq,
  detail: a.detail as Record<string, unknown>,
}));

const V1_KEYS = NEWCOMER_DAILY_QUESTIONS.map((q) => q.key).sort();
const DAILY_V1 = FORM_TEMPLATES.find((t) => t.key === "newcomer_daily")!.v1.id;
const RESPONSE_V1 = FORM_TEMPLATES.find((t) => t.key === "manager_response")!.v1.id;
const WEEKLY_V1 = FORM_TEMPLATES.find((t) => t.key === "weekly_feedback")!.v1.id;

describe("buildSeedPlan (fixed §11 timeline)", () => {
  const plan = buildSeedPlan();

  it("emits the 8 daily logs in log_date order, on newcomer_daily v1, with every v1 key", () => {
    expect(plan.shiftDays).toBe(0);
    expect(plan.logs).toHaveLength(FIXTURE_DAILY_LOGS.length);
    expect(plan.logs.map((l) => l.log_date)).toEqual([...plan.logs.map((l) => l.log_date)].sort());
    for (const log of plan.logs) {
      const entry = FIXTURE_DAILY_LOGS.find((e) => e.seq === log.seq)!;
      expect(log.username).toBe(entry.username);
      expect(log.log_date).toBe(entry.log_date);
      expect(log.submitted_at).toBe(new Date(entry.submitted_at).toISOString());
      expect(log.form_version_id).toBe(DAILY_V1);
      expect(Object.keys(log.answers).sort()).toEqual(V1_KEYS);
      expect(log.answers).toEqual(entry.answers);
    }
  });

  it("row totals match EXPECTED_ROW_COUNTS.full (submissions 11, alerts 2)", () => {
    expect(plan.logs.length + plan.responses.length + plan.weekly.length).toBe(
      EXPECTED_ROW_COUNTS.full.submissions,
    );
    expect(plan.alerts).toHaveLength(EXPECTED_ROW_COUNTS.full.alerts);
  });

  it("alerts deep-equal EXPECTED_ALERTS after the responses are applied", () => {
    expect(plan.alerts).toEqual(EXPECTED);
  });

  it("嚴雅齡 R1 is responded by seq 9 (≈16.1h later); 洪湘庭 R2 stays open", () => {
    const yen = plan.alerts.find((a) => a.username === "yen_yaling")!;
    expect(yen.rule_key).toBe("R1");
    expect(yen.status).toBe("responded");
    expect(yen.response_seq).toBe(9);
    expect(new Date(yen.responded_at!).getTime() - new Date(yen.created_at).getTime()).toBe(
      YEN_R1_RESPONSE_LAG_MS,
    );

    const hung = plan.alerts.find((a) => a.username === "hung_hsiangting")!;
    expect(hung.rule_key).toBe("R2");
    expect(hung.status).toBe("open");
    expect(hung.responded_at).toBeNull();
    expect(hung.response_seq).toBeNull();
  });

  it("alert-free logs (all of 9/2, Darren 9/3, 謝文心 9/3) produce nothing", () => {
    for (const seq of EXPECTED_ALERT_FREE_LOG_SEQS) {
      expect(plan.alerts.filter((a) => a.log_seq === seq)).toEqual([]);
    }
  });

  it("responses target the right logs and keep {status, comment}", () => {
    expect(plan.responses).toHaveLength(FIXTURE_RESPONSES.length);
    for (const response of plan.responses) {
      const entry = FIXTURE_RESPONSES.find((e) => e.seq === response.seq)!;
      const target = plan.logs.find((l) => l.seq === entry.target_log_seq)!;
      expect(response.target_user_id).toBe(target.user_id);
      expect(response.target_username).toBe(target.username);
      expect(response.form_version_id).toBe(RESPONSE_V1);
      expect(response.submitted_at).toBe(new Date(entry.submitted_at).toISOString());
      expect(response.answers).toEqual(entry.answers);
    }
    // Darren's response (seq 10) has no alert to flip.
    expect(plan.alerts.some((a) => a.response_seq === 10)).toBe(false);
  });

  it("weekly feedback: week_start 2026-08-31 in both the column and answers", () => {
    expect(plan.weekly).toHaveLength(FIXTURE_WEEKLY_FEEDBACK.length);
    const weekly = plan.weekly[0]!;
    const entry = FIXTURE_WEEKLY_FEEDBACK[0];
    expect(weekly.week_start).toBe(entry.week_start);
    expect(weekly.answers.week_start).toBe(entry.week_start);
    expect(weekly.answers).toEqual(entry.answers);
    expect(weekly.form_version_id).toBe(WEEKLY_V1);
    expect(weekly.user_id).not.toBe(weekly.target_user_id);
  });

  it("is deterministic (two builds are deep-equal)", () => {
    expect(buildSeedPlan()).toEqual(plan);
  });
});

describe("buildSeedPlan --anchor (shiftDays)", () => {
  const base = buildSeedPlan();

  it.each([1, 13, -3, 21])("shift %i: dates stay equidistant, alerts keep detail/status", (days) => {
    const shifted = buildSeedPlan({ shiftDays: days });
    expect(shifted.shiftDays).toBe(days);

    expect(shifted.logs.map((l) => l.seq)).toEqual(base.logs.map((l) => l.seq));
    shifted.logs.forEach((log, i) => {
      const original = base.logs[i]!;
      expect(log.log_date).toBe(shiftDate(original.log_date, days));
      expect(new Date(log.submitted_at).getTime() - new Date(original.submitted_at).getTime()).toBe(
        days * DAY_MS,
      );
      expect(log.answers).toEqual(original.answers);
    });

    expect(shifted.alerts.map((a) => [a.log_seq, a.rule_key, a.status, a.response_seq, a.detail]))
      .toEqual(base.alerts.map((a) => [a.log_seq, a.rule_key, a.status, a.response_seq, a.detail]));
    shifted.alerts.forEach((alert, i) => {
      const original = base.alerts[i]!;
      expect(alert.created_at).toBe(shiftInstant(original.created_at, days));
      expect(alert.responded_at).toBe(
        original.responded_at === null ? null : shiftInstant(original.responded_at, days),
      );
    });

    shifted.responses.forEach((response, i) => {
      expect(response.submitted_at).toBe(shiftInstant(base.responses[i]!.submitted_at, days));
    });
  });

  it.each([1, 13, -3, 21])("shift %i: week_start is a Monday of the submission week", (days) => {
    const shifted = buildSeedPlan({ shiftDays: days });
    for (const weekly of shifted.weekly) {
      expect(weekStartMonday(weekly.week_start)).toBe(weekly.week_start);
      expect(weekly.answers.week_start).toBe(weekly.week_start);
      expect(weekly.submitted_at).toBe(shiftInstant(base.weekly[0]!.submitted_at, days));
    }
  });

  it("anchor 2026-09-16 (shift 13): logs 9/15–9/16, weekly for the week of 9/14", () => {
    const shifted = buildSeedPlan({ shiftDays: 13 });
    expect(new Set(shifted.logs.map((l) => l.log_date))).toEqual(new Set(["2026-09-15", "2026-09-16"]));
    expect(shifted.weekly[0]!.week_start).toBe("2026-09-14");
    expect(shifted.alerts[0]!.created_at).toBe("2026-09-16T09:03:00.000Z");
  });
});
