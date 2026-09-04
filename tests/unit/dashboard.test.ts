import { describe, expect, it } from "vitest";
import {
  ALL_NEWCOMER_USERNAMES,
  CLOCK_0903_1800,
  CLOCK_0904_1200,
  CLOCK_0904_1800,
  CLOCK_0904_1830,
  EXPECTED_ALERTS,
  EXPECTED_ESCALATION,
  EXPECTED_MILESTONE_DUE_DATES,
  EXPECTED_MISSING_0904,
  EXPECTED_SUMMARY_0903_1800,
  FIXTURE_NEWCOMERS,
  SETTINGS,
} from "@seed/fixtures";
import { buildSeedPlan } from "@seed/plan";
import {
  MILESTONE_DUE_WINDOW_DAYS,
  buildHrDashboard,
  type DashboardAlert,
  type DashboardLog,
  type DashboardMilestone,
  type DashboardNewcomer,
  type DashboardResponse,
  type HrDashboardData,
} from "@/lib/metrics/dashboard";
import { buildDailySummary } from "@/lib/metrics/summary";
import { RESPONSE_STATUS_NEED_HR } from "@/lib/rules/constants";
import { addDaysTo, toInstant, type Instant } from "@/lib/time";
import { milestonesFor } from "@/lib/time/milestones";

/**
 * T19 `buildHrDashboard` (PLAN T19 / A02 / A04 / A09 / A13): the §11 seed
 * plan — the same rows `seed.ts` writes — assembled at the PLAN 4.9.5 fake
 * clocks. The database at an earlier clock is reconstructed by `dataAsOf`:
 * rows submitted after `now` do not exist yet, and an alert whose response
 * comes later is still `open`.
 */

const BASE_URL = "http://localhost:3000";
const PLAN = buildSeedPlan();

type Newcomer = DashboardNewcomer & { username: string };
type Log = DashboardLog & { submitted_at: string };
type Alert = DashboardAlert;
type Milestone = DashboardMilestone;
type Data = HrDashboardData<Newcomer, Log, Alert, DashboardResponse, Milestone>;

const SETTINGS_ROWS = {
  daily_cutoff_time: SETTINGS.daily_cutoff_time,
  response_threshold_hours: SETTINGS.response_threshold_hours,
};

function newcomer(username: string): Newcomer {
  const found = FIXTURE_NEWCOMERS.find((p) => p.username === username);
  if (!found) throw new Error(`unknown newcomer ${username}`);
  return found;
}

const submissionId = (logSeq: number) => `seq-${logSeq}`;

const ms = (instant: Instant) => toInstant(instant).getTime();

/** Every fixture milestone (`milestonesFor(start_date)`, none done). */
const ALL_MILESTONES: Milestone[] = FIXTURE_NEWCOMERS.flatMap((n) =>
  milestonesFor(n.start_date).map((due) => ({
    id: `${n.username}-${due.kind}`,
    user_id: n.id,
    kind: due.kind,
    due_date: due.due_date,
    done_at: null,
  })),
);

/** The seed rows as the database would hold them at `now`. */
function dataAsOf(now: Instant, overrides: Partial<Data> = {}): Data {
  const nowMs = ms(now);
  const logs: Log[] = PLAN.logs
    .filter((log) => ms(log.submitted_at) <= nowMs)
    .map((log) => ({ user_id: log.user_id, log_date: log.log_date, submitted_at: log.submitted_at }));
  const alerts: Alert[] = PLAN.alerts
    .filter((alert) => ms(alert.created_at) <= nowMs)
    .map((alert) => {
      const log = PLAN.logs.find((l) => l.seq === alert.log_seq)!;
      const responded = alert.responded_at !== null && ms(alert.responded_at) <= nowMs;
      return {
        id: `alert-${alert.log_seq}-${alert.rule_key}`,
        submission_id: submissionId(alert.log_seq),
        user_id: log.user_id,
        rule_key: alert.rule_key,
        status: responded ? "responded" : "open",
        created_at: alert.created_at,
        responded_at: responded ? alert.responded_at : null,
        submission: { id: submissionId(alert.log_seq), user_id: log.user_id, log_date: log.log_date },
      };
    });
  const responses: DashboardResponse[] = PLAN.responses
    .filter((r) => ms(r.submitted_at) <= nowMs)
    .map((r) => ({
      user_id: r.user_id,
      target_user_id: r.target_user_id,
      target_submission_id: submissionId(r.target_log_seq),
      submitted_at: r.submitted_at,
      // v1 `status` question carries slot response.status (what bySlot resolves)
      response_status: (r.answers.status as string | null) ?? null,
    }));
  return {
    newcomers: FIXTURE_NEWCOMERS,
    logs,
    alerts,
    responses,
    milestones: ALL_MILESTONES,
    settings: SETTINGS_ROWS,
    ...overrides,
  };
}

const dashboardAt = (now: Instant, overrides: Partial<Data> = {}) =>
  buildHrDashboard({ now, data: dataAsOf(now, overrides) });

const usernames = (rows: readonly { username: string }[]) => rows.map((r) => r.username);

// ---------------------------------------------------------------------------
// fixture wiring: the reconstructed database matches EXPECTED_ALERTS
// ---------------------------------------------------------------------------

describe("dataAsOf (test-side database snapshot)", () => {
  it("at 9/4 18:00 the alerts equal EXPECTED_ALERTS (嚴雅齡 R1 responded, 洪湘庭 R2 open)", () => {
    const { alerts } = dataAsOf(CLOCK_0904_1800);
    expect(alerts.map((a) => [a.rule_key, a.status, a.created_at, a.responded_at])).toEqual(
      EXPECTED_ALERTS.map((a) => [
        a.rule_key,
        a.status,
        new Date(a.created_at).toISOString(),
        a.responded_at === null ? null : new Date(a.responded_at).toISOString(),
      ]),
    );
  });

  it("at 9/3 18:00 both alerts are still open and no response exists yet", () => {
    const { alerts, responses, logs } = dataAsOf(CLOCK_0903_1800);
    expect(alerts.map((a) => a.status)).toEqual(["open", "open"]);
    expect(responses).toEqual([]);
    expect(logs).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// 今日交件 (§7 R3, §8)
// ---------------------------------------------------------------------------

describe("buildHrDashboard.today (今日交件)", () => {
  it("9/4 18:00: 應交 4／已交 0／缺交 4／未到時 0, 缺交名單 = all four", () => {
    const { today } = dashboardAt(CLOCK_0904_1800);
    expect(today.date).toBe("2026-09-04");
    expect(today.expected).toBe(4);
    expect(today.submitted).toBe(0);
    expect(today.missing).toBe(4);
    expect(today.pending).toBe(0);
    expect(usernames(today.missingList)).toEqual([...ALL_NEWCOMER_USERNAMES]);
    expect(usernames(today.missingList)).toEqual([...EXPECTED_MISSING_0904.at_1830]);
    expect(today.pendingList).toEqual([]);
    expect(today.rows.map((r) => r.status)).toEqual(["missing", "missing", "missing", "missing"]);
  });

  it("9/4 18:30: same as 18:00 (cutoff is >=)", () => {
    const { today } = dashboardAt(CLOCK_0904_1830);
    expect([today.expected, today.submitted, today.missing, today.pending]).toEqual([4, 0, 4, 0]);
    expect(usernames(today.missingList)).toEqual([...EXPECTED_MISSING_0904.at_1830]);
  });

  it("9/4 12:00: 未到時 4, nobody missing", () => {
    const { today } = dashboardAt(CLOCK_0904_1200);
    expect([today.expected, today.submitted, today.missing, today.pending]).toEqual([4, 0, 0, 4]);
    expect(today.missingList).toEqual([]);
    expect(usernames(today.missingList)).toEqual([...EXPECTED_MISSING_0904.at_1200]);
    expect(usernames(today.pendingList)).toEqual([...ALL_NEWCOMER_USERNAMES]);
  });

  it("9/3 18:00: 4/4 submitted", () => {
    const { today } = dashboardAt(CLOCK_0903_1800);
    expect(today.date).toBe("2026-09-03");
    expect([today.expected, today.submitted, today.missing, today.pending]).toEqual([4, 4, 0, 0]);
    expect(today.rows.map((r) => r.status)).toEqual(["submitted", "submitted", "submitted", "submitted"]);
  });

  it("rows keep the population order (activeNewcomers() order)", () => {
    const { today } = dashboardAt(CLOCK_0904_1800);
    expect(usernames(today.rows.map((r) => r.newcomer))).toEqual([...ALL_NEWCOMER_USERNAMES]);
  });

  it("only logs dated today count; a log for another date does not make someone 已交", () => {
    const darren = newcomer("darren");
    const { today } = dashboardAt(CLOCK_0904_1800, {
      logs: [
        { user_id: darren.id, log_date: "2026-09-03", submitted_at: "2026-09-03T09:01:00Z" },
        { user_id: newcomer("yen_yaling").id, log_date: "2026-09-04", submitted_at: "2026-09-04T09:00:00Z" },
      ],
    });
    expect(today.submitted).toBe(1);
    expect(usernames(today.missingList)).toEqual(["darren", "hsieh_wenhsin", "hung_hsiangting"]);
  });

  it("left / sample newcomers and those not yet started are not 應交 (A02, R3)", () => {
    const darren = newcomer("darren");
    const { today } = dashboardAt(CLOCK_0904_1800, {
      newcomers: [
        ...FIXTURE_NEWCOMERS,
        { ...darren, id: "left-1", username: "left_one", status: "left" },
        { ...darren, id: "sample-1", username: "e2e_fresh", status: "sample" },
        { ...darren, id: "future-1", username: "future_one", start_date: "2026-09-10" },
        { ...darren, id: "nostart-1", username: "no_start", start_date: null },
      ],
    });
    expect(today.expected).toBe(4);
    expect(usernames(today.missingList)).toEqual([...ALL_NEWCOMER_USERNAMES]);
  });

  it("follows the daily_cutoff_time setting", () => {
    const { today } = dashboardAt(CLOCK_0904_1200, {
      settings: { ...SETTINGS_ROWS, daily_cutoff_time: "11:00" },
    });
    expect([today.missing, today.pending]).toEqual([4, 0]);
  });
});

// ---------------------------------------------------------------------------
// 待處理預警 (§7 A1)
// ---------------------------------------------------------------------------

describe("buildHrDashboard.pendingAlerts (待處理預警)", () => {
  it("9/4 18:00: only 洪湘庭 R2, overdue (24h54m), labelled 卡點, on the 9/3 log", () => {
    const { pendingAlerts } = dashboardAt(CLOCK_0904_1800);
    expect(pendingAlerts).toHaveLength(1);
    const [entry] = pendingAlerts;
    expect(entry.newcomer.username).toBe("hung_hsiangting");
    expect(entry.newcomer.display_name).toBe("洪湘庭");
    expect(entry.alert.rule_key).toBe("R2");
    expect(entry.alert.status).toBe("open");
    expect(entry.state).toBe("overdue");
    expect(EXPECTED_ESCALATION.at_1800.overdue).toBe(true);
    expect(entry.label).toBe("卡點");
    expect(entry.log_date).toBe("2026-09-03");
    expect(entry.openHours).toBeCloseTo(24.9, 1);
  });

  it("9/4 12:00: 洪湘庭 R2 is still 待回應 (open, not overdue)", () => {
    const { pendingAlerts } = dashboardAt(CLOCK_0904_1200);
    expect(pendingAlerts.map((e) => [e.newcomer.username, e.state])).toEqual([
      ["hung_hsiangting", "open"],
    ]);
    expect(EXPECTED_ESCALATION.at_1200.overdue).toBe(false);
  });

  it("9/3 18:00: both alerts are open, oldest first (嚴雅齡 17:03 before 洪湘庭 17:06)", () => {
    const { pendingAlerts } = dashboardAt(CLOCK_0903_1800);
    expect(pendingAlerts.map((e) => [e.newcomer.display_name, e.label, e.state])).toEqual([
      ["嚴雅齡", "進度", "open"],
      ["洪湘庭", "卡點", "open"],
    ]);
  });

  it("responded and closed alerts are not pending; alerts of non-population newcomers are dropped", () => {
    const base = dataAsOf(CLOCK_0904_1800);
    const hung = base.alerts.find((a) => a.rule_key === "R2")!;
    const { pendingAlerts } = dashboardAt(CLOCK_0904_1800, {
      alerts: [
        ...base.alerts,
        { ...hung, id: "closed-1", status: "closed" },
        { ...hung, id: "left-alert", user_id: "left-1", submission: { ...hung.submission, user_id: "left-1" } },
      ],
    });
    expect(pendingAlerts.map((e) => e.alert.id)).toEqual([hung.id]);
  });

  it("follows the response_threshold_hours setting", () => {
    const { pendingAlerts } = dashboardAt(CLOCK_0904_1200, {
      settings: { ...SETTINGS_ROWS, response_threshold_hours: 12 },
    });
    expect(pendingAlerts.map((e) => e.state)).toEqual(["overdue"]);
  });
});

// ---------------------------------------------------------------------------
// HR 介入清單 (PLAN A04)
// ---------------------------------------------------------------------------

describe("buildHrDashboard.intervention (HR 介入清單)", () => {
  it("9/4 18:00: overdue contains 洪湘庭 R2; nothing needs HR", () => {
    const { intervention } = dashboardAt(CLOCK_0904_1800);
    expect(usernames(intervention.overdue.map((e) => e.newcomer))).toEqual([
      ...EXPECTED_ESCALATION.at_1800.hr_intervention,
    ]);
    expect(intervention.overdue[0].alert.rule_key).toBe("R2");
    expect(intervention.needHr).toEqual([]);
  });

  it("9/4 12:00: empty", () => {
    const { intervention } = dashboardAt(CLOCK_0904_1200);
    expect(intervention.overdue).toEqual([]);
    expect(intervention.needHr).toEqual([]);
  });

  it("a 需 HR 協助 response within 7 days is listed with its newcomer", () => {
    const base = dataAsOf(CLOCK_0904_1800);
    const { intervention } = dashboardAt(CLOCK_0904_1800, {
      responses: [
        ...base.responses,
        {
          user_id: "mgr_construction",
          target_user_id: newcomer("darren").id,
          target_submission_id: submissionId(5),
          submitted_at: "2026-09-04T10:00:00+08:00",
          response_status: RESPONSE_STATUS_NEED_HR,
        },
      ],
    });
    expect(usernames(intervention.needHr.map((e) => e.newcomer))).toEqual(["darren"]);
    expect(usernames(intervention.overdue.map((e) => e.newcomer))).toEqual(["hung_hsiangting"]);
  });

  it("the pending-alert overdue entries and the intervention overdue entries are the same alerts", () => {
    const { pendingAlerts, intervention } = dashboardAt(CLOCK_0904_1800);
    expect(pendingAlerts.filter((e) => e.state === "overdue").map((e) => e.alert)).toEqual(
      intervention.overdue.map((e) => e.alert),
    );
  });
});

// ---------------------------------------------------------------------------
// 節點到期 (§8, PLAN A09)
// ---------------------------------------------------------------------------

describe("buildHrDashboard.milestones (節點到期, [today, today+7])", () => {
  const taipei = (date: string, time = "18:00") => `${date}T${time}:00+08:00`;
  const entriesAt = (now: Instant, overrides: Partial<Data> = {}) =>
    dashboardAt(now, overrides).milestones.entries;

  it("window constant is 7 days and the window bounds are today / today+7", () => {
    expect(MILESTONE_DUE_WINDOW_DAYS).toBe(7);
    const { milestones } = dashboardAt(CLOCK_0904_1800);
    expect(milestones.windowStart).toBe("2026-09-04");
    expect(milestones.windowEnd).toBe("2026-09-11");
  });

  it("9/4 and 9/23: empty (D30 is due 10/01)", () => {
    expect(EXPECTED_MILESTONE_DUE_DATES.D30).toBe("2026-10-01");
    expect(entriesAt(CLOCK_0904_1800)).toEqual([]);
    expect(entriesAt(taipei("2026-09-23"))).toEqual([]);
    expect(entriesAt(taipei("2026-09-23", "23:59"))).toEqual([]);
  });

  it("9/24 (9/24 + 7 = 10/01, end included): four D30 entries, 7 days ahead, not overdue", () => {
    const entries = entriesAt(taipei("2026-09-24", "00:00"));
    expect(entries).toHaveLength(4);
    expect(usernames(entries.map((e) => e.newcomer))).toEqual([...ALL_NEWCOMER_USERNAMES]);
    for (const entry of entries) {
      expect(entry.milestone.kind).toBe("D30");
      expect(entry.milestone.due_date).toBe("2026-10-01");
      expect(entry.daysUntil).toBe(7);
      expect(entry.overdue).toBe(false);
      expect(entry.overdueDays).toBe(0);
    }
  });

  it("10/01 (due today): four D30 with daysUntil 0; 10/02: the same four, overdue by 1 day", () => {
    const dueToday = entriesAt(taipei("2026-10-01"));
    expect(dueToday.map((e) => [e.milestone.kind, e.daysUntil, e.overdue])).toEqual(
      Array(4).fill(["D30", 0, false]),
    );
    const overdue = entriesAt(taipei("2026-10-02"));
    expect(overdue.map((e) => [e.milestone.kind, e.daysUntil, e.overdue, e.overdueDays])).toEqual(
      Array(4).fill(["D30", -1, true, 1]),
    );
  });

  it("overdue pending milestones come first, then by due_date; done ones are not listed", () => {
    const darren = newcomer("darren");
    const yen = newcomer("yen_yaling");
    // 10/26: Darren's D30 (10/01) still not done → overdue 25 days, listed first;
    // 嚴雅齡's D30 done → gone; everybody's D60 (10/31) is 5 days ahead.
    const milestones: Milestone[] = ALL_MILESTONES.map((m) =>
      m.user_id === yen.id && m.kind === "D30" ? { ...m, done_at: "2026-10-01T02:00:00Z" } : m,
    );
    const entries = entriesAt(taipei("2026-10-26"), { milestones });
    expect(entries.map((e) => [e.newcomer.username, e.milestone.kind, e.daysUntil, e.overdue])).toEqual([
      ["darren", "D30", -25, true],
      ["hsieh_wenhsin", "D30", -25, true],
      ["hung_hsiangting", "D30", -25, true],
      ["darren", "D60", 5, false],
      ["yen_yaling", "D60", 5, false],
      ["hsieh_wenhsin", "D60", 5, false],
      ["hung_hsiangting", "D60", 5, false],
    ]);
    expect(entries[0].overdueDays).toBe(25);
    expect(entries.find((e) => e.newcomer.id === darren.id && e.milestone.kind === "D90")).toBeUndefined();
  });

  it("milestones of left / sample / unknown newcomers are dropped (A02)", () => {
    const darren = newcomer("darren");
    const entries = entriesAt(taipei("2026-10-01"), {
      newcomers: [...FIXTURE_NEWCOMERS, { ...darren, id: "left-1", username: "left_one", status: "left" }],
      milestones: [
        ...ALL_MILESTONES,
        { id: "m-left", user_id: "left-1", kind: "D30", due_date: "2026-10-01", done_at: null },
        { id: "m-unknown", user_id: "nobody", kind: "D30", due_date: "2026-10-01", done_at: null },
      ],
    });
    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.newcomer.status === "active")).toBe(true);
  });

  it("the window end moves with today: due 10/01 is listed from 9/24, not on 9/23", () => {
    expect(addDaysTo("2026-09-24", MILESTONE_DUE_WINDOW_DAYS)).toBe("2026-10-01");
    expect(entriesAt(taipei("2026-09-23", "23:59"))).toHaveLength(0);
    expect(entriesAt(taipei("2026-09-24", "00:00"))).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// one-line summary facts (PLAN A13) — the dashboard feeds buildDailySummary
// ---------------------------------------------------------------------------

describe("buildHrDashboard.summary → buildDailySummary", () => {
  it("9/3 18:00 → 9/3 新人日誌｜4/4 已交｜預警 2 筆：嚴雅齡（進度）、洪湘庭（卡點）｜待主管回應：2｜{APP_BASE_URL}/", () => {
    const { summary } = dashboardAt(CLOCK_0903_1800);
    expect(summary).toEqual({
      date: "2026-09-03",
      submitted: EXPECTED_SUMMARY_0903_1800.submitted,
      expected: EXPECTED_SUMMARY_0903_1800.expected,
      todayAlerts: [
        { display_name: "嚴雅齡", rule_key: "R1" },
        { display_name: "洪湘庭", rule_key: "R2" },
      ],
      openCount: EXPECTED_SUMMARY_0903_1800.awaiting_response,
    });
    expect(buildDailySummary({ ...summary, baseUrl: BASE_URL })).toBe(
      `9/3 新人日誌｜4/4 已交｜預警 2 筆：${EXPECTED_SUMMARY_0903_1800.alert_lines.join("、")}｜待主管回應：2｜${BASE_URL}/`,
    );
  });

  it("9/4 18:00 → 0/4 已交、預警 0 筆、待主管回應：1", () => {
    const { summary } = dashboardAt(CLOCK_0904_1800);
    expect(summary).toEqual({
      date: "2026-09-04",
      submitted: 0,
      expected: 4,
      todayAlerts: [],
      openCount: 1,
    });
    expect(buildDailySummary({ ...summary, baseUrl: BASE_URL })).toBe(
      `9/4 新人日誌｜0/4 已交｜預警 0 筆｜待主管回應：1｜${BASE_URL}/`,
    );
  });

  it("9/4 12:00: 待主管回應 still 1 (openCount counts past days, not only today)", () => {
    const { summary, pendingAlerts } = dashboardAt(CLOCK_0904_1200);
    expect(summary.openCount).toBe(1);
    expect(summary.openCount).toBe(pendingAlerts.length);
    expect(summary.todayAlerts).toEqual([]);
  });

  it("todayAlerts lists responded alerts of today too (status ≠ closed), never closed ones", () => {
    const base = dataAsOf(CLOCK_0903_1800);
    const [yen, hung] = base.alerts;
    const { summary } = dashboardAt(CLOCK_0903_1800, {
      alerts: [
        { ...yen, status: "responded", responded_at: "2026-09-03T09:30:00Z" },
        { ...hung, status: "closed" },
      ],
    });
    expect(summary.todayAlerts).toEqual([{ display_name: "嚴雅齡", rule_key: "R1" }]);
    expect(summary.openCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// shared between /hr and /ceo: the same input yields the same numbers
// ---------------------------------------------------------------------------

describe("buildHrDashboard is pure", () => {
  it("is deterministic and does not modify its input", () => {
    const data = dataAsOf(CLOCK_0904_1800);
    const snapshot = structuredClone(data);
    const first = buildHrDashboard({ now: CLOCK_0904_1800, data });
    const second = buildHrDashboard({ now: CLOCK_0904_1800, data });
    expect(first).toEqual(second);
    expect(data).toEqual(snapshot);
  });

  it("accepts `now` as a Date or as an offset ISO string; rejects naive strings", () => {
    const asDate = dashboardAt(CLOCK_0904_1800);
    const asString = dashboardAt("2026-09-04T18:00:00+08:00");
    expect(asString.today).toEqual(asDate.today);
    expect(asString.summary).toEqual(asDate.summary);
    expect(() => dashboardAt("2026-09-04T18:00:00")).toThrow(RangeError);
  });

  it("an empty population yields an empty dashboard (0/0)", () => {
    const dashboard = dashboardAt(CLOCK_0904_1800, { newcomers: [] });
    expect([dashboard.today.expected, dashboard.today.submitted]).toEqual([0, 0]);
    expect(dashboard.pendingAlerts).toEqual([]);
    expect(dashboard.intervention).toEqual({ overdue: [], needHr: [] });
    expect(dashboard.milestones.entries).toEqual([]);
    expect(buildDailySummary({ ...dashboard.summary, baseUrl: BASE_URL })).toBe(
      `9/4 新人日誌｜0/0 已交｜預警 0 筆｜待主管回應：0｜${BASE_URL}/`,
    );
  });
});
