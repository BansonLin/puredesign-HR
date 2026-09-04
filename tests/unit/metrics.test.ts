import { describe, expect, it } from "vitest";
import {
  ALL_NEWCOMER_USERNAMES,
  CLOCK_0903_1800,
  CLOCK_0904_1200,
  CLOCK_0904_1800,
  CLOCK_0904_1830,
  DEPARTMENTS,
  EXPECTED_ALERTS,
  EXPECTED_METRICS_0904_1800,
  EXPECTED_MILESTONE_DUE_DATES,
  FIXTURE_NEWCOMERS,
  SETTINGS,
  YEN_R1_RESPONSE_LAG_MS,
} from "@seed/fixtures";
import { buildSeedPlan } from "@seed/plan";
import {
  DEPARTMENT_STATS_WINDOW_DAYS,
  WITHIN_HOURS,
  alertPopulation,
  alertRates,
  countedThrough,
  departmentStats7d,
  falsePositiveRate,
  missingRate,
  newcomerOverview,
  ratio,
  responseRate,
  within24hRate,
  type MetricAlert,
  type MetricResponse,
} from "@/lib/metrics";
import { RESPONSE_STATUS_NO_ACTION } from "@/lib/rules/constants";
import { toInstant, type Instant, type Workweek } from "@/lib/time";
import { milestonesFor } from "@/lib/time/milestones";

/**
 * T23 `lib/metrics` (PLAN T23, A02, A08, A09): the §11 seed plan — the same
 * rows `seed.ts` writes — run through the pure metric functions at the PLAN
 * 4.9.5 fake clocks. `dataAsOf` reconstructs the database at an earlier
 * clock: rows submitted after `now` do not exist yet, and an alert whose
 * response comes later is still `open`.
 */

const PLAN = buildSeedPlan();

const departmentId = (name: string): string => {
  const found = DEPARTMENTS.find((d) => d.name === name);
  if (!found) throw new Error(`unknown department ${name}`);
  return found.id;
};

interface Newcomer {
  id: string;
  username: string;
  display_name: string;
  status: "active" | "left" | "sample";
  start_date: string | null;
  department_id: string | null;
}

/** Fixture newcomers as `profiles` rows (department name → id). */
const NEWCOMERS: Newcomer[] = FIXTURE_NEWCOMERS.map((n) => ({
  id: n.id,
  username: n.username,
  display_name: n.display_name,
  status: n.status,
  start_date: n.start_date,
  department_id: departmentId(n.department),
}));

function newcomer(username: string): Newcomer {
  const found = NEWCOMERS.find((p) => p.username === username);
  if (!found) throw new Error(`unknown newcomer ${username}`);
  return found;
}

const submissionId = (logSeq: number) => `seq-${logSeq}`;
const responseId = (seq: number) => `resp-${seq}`;
const ms = (instant: Instant) => toInstant(instant).getTime();
const taipei = (date: string, time = "18:00") => `${date}T${time}:00+08:00`;

type Log = { id: string; user_id: string; log_date: string | null; submitted_at: string };
type Alert = MetricAlert & { id: string; rule_key: string; submission_id: string };
type Response = MetricResponse & { target_submission_id: string; submitted_at: string };

type Milestone = {
  id: string;
  user_id: string;
  kind: "D30" | "D60" | "D90";
  due_date: string;
  done_at: string | null;
};
type Department = { id: string; name: string; sort_order: number };

const SETTINGS_ROWS = {
  daily_cutoff_time: SETTINGS.daily_cutoff_time,
  workweek: SETTINGS.workweek as Workweek,
  response_threshold_hours: SETTINGS.response_threshold_hours,
};

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

interface DepartmentInput {
  departments: readonly Department[];
  newcomers: readonly Newcomer[];
  logs: readonly Log[];
  alerts: readonly Alert[];
  settings: typeof SETTINGS_ROWS;
  now: Instant;
}

interface OverviewInput {
  newcomers: readonly Newcomer[];
  logs: readonly Log[];
  alerts: readonly Alert[];
  milestones: readonly Milestone[];
  settings: typeof SETTINGS_ROWS;
  now: Instant;
}

/** The seed rows as the database would hold them at `now`. */
function dataAsOf(now: Instant) {
  const nowMs = ms(now);
  const logs: Log[] = PLAN.logs
    .filter((log) => ms(log.submitted_at) <= nowMs)
    .map((log) => ({
      id: submissionId(log.seq),
      user_id: log.user_id,
      log_date: log.log_date,
      submitted_at: log.submitted_at,
    }));
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
        response_submission_id:
          responded && alert.response_seq !== null ? responseId(alert.response_seq) : null,
        submission: { deleted_at: null },
      };
    });
  const responses: Response[] = PLAN.responses
    .filter((r) => ms(r.submitted_at) <= nowMs)
    .map((r) => ({
      id: responseId(r.seq),
      target_submission_id: submissionId(r.target_log_seq),
      submitted_at: r.submitted_at,
      // v1 `status` question carries slot response.status (what bySlot resolves)
      response_status: (r.answers.status as string | null) ?? null,
    }));
  return { logs, alerts, responses };
}

const usernames = (rows: readonly { newcomer: { username: string } }[]) =>
  rows.map((r) => r.newcomer.username);

// ---------------------------------------------------------------------------
// fixture wiring
// ---------------------------------------------------------------------------

describe("dataAsOf (test-side database snapshot)", () => {
  it("at 9/4 18:00 the alerts equal EXPECTED_ALERTS and link to their responses", () => {
    const { alerts, responses } = dataAsOf(CLOCK_0904_1800);
    expect(alerts.map((a) => [a.rule_key, a.status, a.response_submission_id])).toEqual(
      EXPECTED_ALERTS.map((a) => [
        a.rule_key,
        a.status,
        a.response_seq === null ? null : responseId(a.response_seq),
      ]),
    );
    expect(responses.map((r) => [r.id, r.response_status])).toEqual([
      [responseId(9), "已處理"],
      [responseId(10), RESPONSE_STATUS_NO_ACTION],
    ]);
  });
});

// ---------------------------------------------------------------------------
// ratio / population helpers
// ---------------------------------------------------------------------------

describe("ratio / alertPopulation", () => {
  it("ratio: rate is null when the denominator is 0, never NaN", () => {
    expect(ratio(0, 0)).toEqual({ numerator: 0, denominator: 0, rate: null });
    expect(ratio(1, 2)).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
  });

  it("population = open + responded, not closed, not on a deleted log, not sample (A08(b), A02)", () => {
    const { alerts } = dataAsOf(CLOCK_0904_1800);
    const [yen, hung] = alerts;
    const extra: Alert[] = [
      { ...hung, id: "closed", status: "closed" },
      { ...hung, id: "deleted", submission: { deleted_at: "2026-09-04T00:00:00Z" } },
      { ...hung, id: "sample", user_id: "sample-1" },
      { ...hung, id: "left", user_id: "left-1" },
      { ...hung, id: "no-submission", submission: undefined },
    ];
    const profiles = [
      ...NEWCOMERS,
      { id: "sample-1", status: "sample" as const },
      { id: "left-1", status: "left" as const },
    ];
    expect(alertPopulation([...alerts, ...extra], { profiles }).map((a) => a.id)).toEqual([
      yen.id,
      hung.id,
      "left",
      "no-submission",
    ]);
    // without profiles nothing is known about sample accounts: the row stays
    expect(alertPopulation(extra).map((a) => a.id)).toEqual(["sample", "left", "no-submission"]);
  });
});

// ---------------------------------------------------------------------------
// 三指標 (§7, A08(e)) at 9/4 18:00
// ---------------------------------------------------------------------------

describe("三指標 at 9/4 18:00 (EXPECTED_METRICS_0904_1800)", () => {
  const data = dataAsOf(CLOCK_0904_1800);

  it("誤報率 0/1 = 0% — Darren's 已讀，無需處理 response has no alert and is not counted", () => {
    const expected = EXPECTED_METRICS_0904_1800.false_alarm;
    expect(falsePositiveRate(data)).toEqual({
      numerator: expected.numerator,
      denominator: expected.denominator,
      rate: expected.rate,
    });
  });

  it("主管回應率 1/2 = 50%", () => {
    const expected = EXPECTED_METRICS_0904_1800.response_rate;
    expect(responseRate(data)).toEqual({
      numerator: expected.numerator,
      denominator: expected.denominator,
      rate: expected.rate,
    });
  });

  it("24h 內回應率 1/2 = 50% (嚴雅齡 responded after 16h07m; 洪湘庭 still open counts in the denominator)", () => {
    const expected = EXPECTED_METRICS_0904_1800.response_within_threshold;
    expect(within24hRate(data)).toEqual({
      numerator: expected.numerator,
      denominator: expected.denominator,
      rate: expected.rate,
    });
    const yen = data.alerts.find((a) => a.rule_key === "R1")!;
    expect(ms(yen.responded_at!) - ms(yen.created_at)).toBe(YEN_R1_RESPONSE_LAG_MS);
  });

  it("an alert whose log was soft-deleted leaves all three metrics (A05 (1) second gate, D-51)", () => {
    // `listAlertsWithSubmission()` never returns such a row, but it now
    // carries the real `deleted_at`, so `alertPopulation` is a true gate: with
    // 嚴雅齡's 9/3 log soft-deleted only 洪湘庭's open R2 remains.
    const alerts = data.alerts.map((alert) =>
      alert.rule_key === "R1"
        ? { ...alert, submission: { deleted_at: "2026-09-04T10:00:00+08:00" } }
        : alert,
    );
    const rates = alertRates({
      ...data,
      alerts,
      thresholdHours: SETTINGS_ROWS.response_threshold_hours,
      now: CLOCK_0904_1800,
    });
    expect(rates.total).toBe(1);
    expect(rates.response).toEqual({ numerator: 0, denominator: 1, rate: 0 });
    expect(rates.within24h).toEqual({ numerator: 0, denominator: 1, rate: 0 });
    // 誤報率's denominator is the responded alerts only — none are left.
    expect(rates.falsePositive).toEqual({ numerator: 0, denominator: 0, rate: null });
    expect(rates.late).toBe(0);
  });

  it("alertRates bundles the three with the A1 late count (0) and the population size (2)", () => {
    const rates = alertRates({ ...data, thresholdHours: SETTINGS_ROWS.response_threshold_hours, now: CLOCK_0904_1800 });
    expect(rates.falsePositive).toEqual(falsePositiveRate(data));
    expect(rates.response).toEqual(responseRate(data));
    expect(rates.within24h).toEqual(within24hRate(data));
    expect(rates.late).toBe(EXPECTED_METRICS_0904_1800.late_alerts);
    expect(rates.total).toBe(2);
  });

  it("with a 12h threshold 嚴雅齡's 16h response is late (statistics only; the 24h rate is unchanged)", () => {
    const rates = alertRates({ ...data, thresholdHours: 12, now: CLOCK_0904_1800 });
    expect(rates.late).toBe(1);
    expect(rates.within24h.rate).toBe(0.5);
  });

  it("9/3 18:00: two open alerts, nothing responded → 0/2, 0/2, 誤報率 0/0 = null", () => {
    const earlier = dataAsOf(CLOCK_0903_1800);
    expect(responseRate(earlier)).toEqual({ numerator: 0, denominator: 2, rate: 0 });
    expect(within24hRate(earlier)).toEqual({ numerator: 0, denominator: 2, rate: 0 });
    expect(falsePositiveRate(earlier)).toEqual({ numerator: 0, denominator: 0, rate: null });
  });

  it("誤報率 counts a responded alert whose response is 已讀，無需處理 (1/1); trims the status (A06)", () => {
    const responses = data.responses.map((r) =>
      r.id === responseId(9) ? { ...r, response_status: ` ${RESPONSE_STATUS_NO_ACTION} ` } : r,
    );
    expect(falsePositiveRate({ alerts: data.alerts, responses })).toEqual({
      numerator: 1,
      denominator: 1,
      rate: 1,
    });
  });

  it("誤報率: a responded alert whose response row is missing stays in the denominator only", () => {
    expect(falsePositiveRate({ alerts: data.alerts, responses: [] })).toEqual({
      numerator: 0,
      denominator: 1,
      rate: 0,
    });
  });

  it("24h window is fixed at 24h, inclusive: exactly 24h counts, 24h + 1ms does not", () => {
    expect(WITHIN_HOURS).toBe(24);
    const hung = data.alerts.find((a) => a.rule_key === "R2")!;
    const createdMs = ms(hung.created_at);
    const respondedAt = (lagMs: number) => new Date(createdMs + lagMs).toISOString();
    const at = (lagMs: number): Alert => ({
      ...hung,
      status: "responded",
      responded_at: respondedAt(lagMs),
      response_submission_id: "resp-x",
    });
    const day = 24 * 60 * 60 * 1000;
    expect(within24hRate({ alerts: [at(day)] }).numerator).toBe(1);
    expect(within24hRate({ alerts: [at(day + 1)] }).numerator).toBe(0);
    expect(responseRate({ alerts: [at(day + 1)] }).numerator).toBe(1);
  });

  it("closed alerts and alerts on deleted logs are not in any denominator; left newcomers' alerts are (A02)", () => {
    const hung = data.alerts.find((a) => a.rule_key === "R2")!;
    const alerts: Alert[] = [
      ...data.alerts,
      { ...hung, id: "closed", status: "closed" },
      { ...hung, id: "deleted", submission: { deleted_at: "2026-09-04T00:00:00Z" } },
      { ...hung, id: "left", user_id: "left-1" },
    ];
    const profiles = [...NEWCOMERS, { id: "left-1", status: "left" as const }];
    expect(responseRate({ alerts, profiles })).toEqual({ numerator: 1, denominator: 3, rate: 1 / 3 });
  });

  it("empty input → every rate is 0/0 = null", () => {
    expect(falsePositiveRate({ alerts: [] }).rate).toBeNull();
    expect(responseRate({ alerts: [] }).rate).toBeNull();
    expect(within24hRate({ alerts: [] }).rate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 缺交率 (§7)
// ---------------------------------------------------------------------------

describe("missingRate (缺交率)", () => {
  const darren = newcomer("darren");
  const darrenLogs = (now: Instant) => dataAsOf(now).logs.filter((l) => l.user_id === darren.id);
  const rateAt = (now: Instant, overrides: Partial<Parameters<typeof missingRate>[0]> = {}) =>
    missingRate({
      newcomer: darren,
      logs: darrenLogs(now),
      now,
      cutoff: SETTINGS_ROWS.daily_cutoff_time,
      workweek: SETTINGS_ROWS.workweek,
      ...overrides,
    });

  it("countedThrough: today once the cutoff has passed (>=), else yesterday", () => {
    expect(countedThrough(CLOCK_0904_1800, "18:00")).toBe("2026-09-04");
    expect(countedThrough(CLOCK_0904_1830, "18:00")).toBe("2026-09-04");
    expect(countedThrough(CLOCK_0904_1200, "18:00")).toBe("2026-09-03");
    expect(countedThrough(CLOCK_0904_1200, "11:00")).toBe("2026-09-04");
  });

  it("Darren 9/4 18:00: 1 − 2/4 = 50% (workdays 9/1–9/4, logs 9/2 and 9/3)", () => {
    expect(rateAt(CLOCK_0904_1800)).toEqual({
      numerator: 2,
      denominator: 4,
      rate: 0.5,
      logs: 2,
      countedThrough: "2026-09-04",
    });
  });

  it("Darren 9/4 12:00: today not yet counted → 1 − 2/3", () => {
    const result = rateAt(CLOCK_0904_1200)!;
    expect([result.numerator, result.denominator, result.logs]).toEqual([1, 3, 2]);
    expect(result.rate).toBeCloseTo(1 - 2 / 3, 10);
    expect(result.countedThrough).toBe("2026-09-03");
  });

  it("start_date = today before the cutoff → null (no workday counted yet); after the cutoff → 1/1", () => {
    const startsToday = { ...darren, start_date: "2026-09-04" };
    expect(rateAt(CLOCK_0904_1200, { newcomer: startsToday, logs: [] })).toBeNull();
    expect(rateAt(CLOCK_0904_1800, { newcomer: startsToday, logs: [] })).toMatchObject({
      numerator: 1,
      denominator: 1,
      rate: 1,
      logs: 0,
    });
  });

  it("null for non-active newcomers, a missing start_date, or a start on a non-workday (A08(c))", () => {
    expect(rateAt(CLOCK_0904_1800, { newcomer: { ...darren, status: "left" } })).toBeNull();
    expect(rateAt(CLOCK_0904_1800, { newcomer: { ...darren, status: "sample" } })).toBeNull();
    expect(rateAt(CLOCK_0904_1800, { newcomer: { ...darren, start_date: null } })).toBeNull();
    // 9/5 is a Saturday: mon_fri counts nothing, mon_sat counts one day
    const saturday = { ...darren, start_date: "2026-09-05" };
    expect(rateAt(taipei("2026-09-05"), { newcomer: saturday, logs: [] })).toBeNull();
    expect(rateAt(taipei("2026-09-05"), { newcomer: saturday, logs: [], workweek: "mon_sat" })).toMatchObject({
      denominator: 1,
    });
  });

  it("follows settings.workweek: Saturday 9/5 18:00 → 4 workdays (mon_fri) or 5 (mon_sat)", () => {
    const now = taipei("2026-09-05");
    expect(rateAt(now)!.denominator).toBe(4);
    expect(rateAt(now, { workweek: "mon_sat" })!.denominator).toBe(5);
  });

  it("only logs dated within [start_date, countedThrough] count; a non-workday log clamps at 0, never negative", () => {
    const logs: Log[] = [
      { id: "l1", user_id: darren.id, log_date: "2026-08-31", submitted_at: "2026-08-31T09:00:00Z" }, // before start
      { id: "l2", user_id: darren.id, log_date: "2026-09-04", submitted_at: "2026-09-04T03:00:00Z" }, // today, before cutoff
      { id: "l3", user_id: darren.id, log_date: null, submitted_at: "2026-09-04T03:00:00Z" },
    ];
    expect(rateAt(CLOCK_0904_1200, { logs })).toMatchObject({ numerator: 3, denominator: 3, logs: 0 });
    expect(rateAt(CLOCK_0904_1800, { logs })).toMatchObject({ numerator: 3, denominator: 4, logs: 1 });
    const monday = { ...darren, start_date: "2026-09-01" };
    const everyDay: Log[] = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"].map(
      (date, i) => ({ id: `d${i}`, user_id: darren.id, log_date: date, submitted_at: `${date}T09:00:00Z` }),
    );
    // 9/7 (Monday) 18:00: 5 workdays, 6 logs → 0 missing, not −1
    expect(rateAt(taipei("2026-09-07"), { newcomer: monday, logs: everyDay })).toMatchObject({
      numerator: 0,
      denominator: 5,
      rate: 0,
      logs: 6,
    });
  });
});

// ---------------------------------------------------------------------------
// 近 7 日各部門統計 (A08(d))
// ---------------------------------------------------------------------------

describe("departmentStats7d (近 7 日各部門統計)", () => {
  const statsAt = (now: Instant, overrides: Partial<DepartmentInput> = {}) => {
    const data = dataAsOf(now);
    return departmentStats7d({
      departments: DEPARTMENTS,
      newcomers: NEWCOMERS,
      logs: data.logs,
      alerts: data.alerts,
      settings: SETTINGS_ROWS,
      now,
      ...overrides,
    });
  };
  const rowOf = (stats: ReturnType<typeof statsAt>, name: string) => {
    const row = stats.rows.find((r) => r.department.name === name);
    if (!row) throw new Error(`no row for ${name}`);
    return row;
  };

  it("window = 7 Taipei calendar days ending today; countedThrough follows the cutoff", () => {
    expect(DEPARTMENT_STATS_WINDOW_DAYS).toBe(7);
    const stats = statsAt(CLOCK_0904_1800);
    expect([stats.windowStart, stats.windowEnd, stats.countedThrough]).toEqual([
      "2026-08-29",
      "2026-09-04",
      "2026-09-04",
    ]);
    expect(statsAt(CLOCK_0904_1200).countedThrough).toBe("2026-09-03");
  });

  it("9/4 18:00: 採購 2 logs / 1 alert / 1 responded (100%); 信義設計 2 / 1 / 0 (0%)", () => {
    const stats = statsAt(CLOCK_0904_1800);
    expect(rowOf(stats, "採購")).toMatchObject({
      newcomers: 1,
      expected: 4,
      submitted: 2,
      missing: 2,
      alerts: 1,
      responded: 1,
      responseRate: { numerator: 1, denominator: 1, rate: 1 },
    });
    expect(rowOf(stats, "信義設計")).toMatchObject({
      newcomers: 1,
      expected: 4,
      submitted: 2,
      missing: 2,
      alerts: 1,
      responded: 0,
      responseRate: { numerator: 0, denominator: 1, rate: 0 },
    });
    for (const name of ["工務", "設計"]) {
      expect(rowOf(stats, name)).toMatchObject({
        newcomers: 1,
        expected: 4,
        submitted: 2,
        missing: 2,
        alerts: 0,
        responded: 0,
        responseRate: { numerator: 0, denominator: 0, rate: null },
      });
    }
  });

  it("9/4 12:00: today is not 應交 yet (3 workdays, 1 missing); alerts still count for the window", () => {
    const stats = statsAt(CLOCK_0904_1200);
    expect(rowOf(stats, "採購")).toMatchObject({ expected: 3, submitted: 2, missing: 1, alerts: 1, responded: 1 });
    expect(rowOf(stats, "信義設計")).toMatchObject({ expected: 3, submitted: 2, missing: 1, alerts: 1, responded: 0 });
  });

  it("9/3 18:00: 3 workdays, 2 logs, both alerts open", () => {
    const stats = statsAt(CLOCK_0903_1800);
    expect(rowOf(stats, "採購")).toMatchObject({ expected: 3, submitted: 2, missing: 1, alerts: 1, responded: 0 });
    expect(rowOf(stats, "工務")).toMatchObject({ expected: 3, submitted: 2, missing: 1, alerts: 0 });
  });

  it("rows follow departments.sort_order and include departments without newcomers (zeros)", () => {
    const stats = statsAt(CLOCK_0904_1800, {
      departments: [
        { id: "dept-empty", name: "總務", sort_order: 0 },
        ...[...DEPARTMENTS].reverse(),
      ],
    });
    expect(stats.rows.map((r) => r.department.name)).toEqual(["總務", "工務", "採購", "設計", "信義設計"]);
    expect(stats.rows[0]).toMatchObject({
      newcomers: 0,
      expected: 0,
      submitted: 0,
      missing: 0,
      alerts: 0,
      responded: 0,
      responseRate: { rate: null },
    });
  });

  it("population is active newcomers with a department (A02): left / sample / no department are not counted", () => {
    const darren = newcomer("darren");
    const data = dataAsOf(CLOCK_0904_1800);
    const stats = statsAt(CLOCK_0904_1800, {
      newcomers: [
        ...NEWCOMERS,
        { ...darren, id: "left-1", username: "left_one", status: "left" },
        { ...darren, id: "sample-1", username: "e2e_fresh", status: "sample" },
        { ...darren, id: "nodept-1", username: "no_dept", department_id: null },
      ],
      logs: [
        ...data.logs,
        { id: "x1", user_id: "left-1", log_date: "2026-09-03", submitted_at: "2026-09-03T09:00:00Z" },
        { id: "x2", user_id: "nodept-1", log_date: "2026-09-03", submitted_at: "2026-09-03T09:00:00Z" },
      ],
      alerts: [
        ...data.alerts,
        { ...data.alerts[0], id: "left-alert", user_id: "left-1" },
        { ...data.alerts[0], id: "sample-alert", user_id: "sample-1" },
      ],
    });
    expect(rowOf(stats, "工務")).toMatchObject({ newcomers: 1, expected: 4, submitted: 2, alerts: 0 });
    expect(stats.rows.reduce((sum, r) => sum + r.newcomers, 0)).toBe(4);
  });

  it("a newcomer who started inside the window is only 應交 from start_date; one not started yet counts 0", () => {
    const stats = statsAt(CLOCK_0904_1800, {
      newcomers: NEWCOMERS.map((n) =>
        n.username === "darren"
          ? { ...n, start_date: "2026-09-03" }
          : n.username === "yen_yaling"
            ? { ...n, start_date: "2026-09-10" }
            : n,
      ),
    });
    expect(rowOf(stats, "工務")).toMatchObject({ expected: 2, submitted: 1, missing: 1 });
    expect(rowOf(stats, "採購")).toMatchObject({ newcomers: 1, expected: 0, submitted: 0, missing: 0 });
  });

  it("only alerts created on a Taipei day inside the window count; closed ones never", () => {
    const data = dataAsOf(CLOCK_0904_1800);
    const hung = data.alerts.find((a) => a.rule_key === "R2")!;
    const stats = statsAt(CLOCK_0904_1800, {
      alerts: [
        ...data.alerts,
        { ...hung, id: "old", created_at: "2026-08-28T15:59:59Z" }, // 8/28 23:59:59 Taipei: outside
        { ...hung, id: "edge", created_at: "2026-08-28T16:00:00Z" }, // 8/29 00:00 Taipei: inside
        { ...hung, id: "closed", status: "closed" },
      ],
    });
    expect(rowOf(stats, "信義設計")).toMatchObject({ alerts: 2, responded: 0 });
  });

  it("logs on a non-workday count as 已交 but never push 缺交 below 0; logs outside the counted range are ignored", () => {
    const darren = newcomer("darren");
    const stats = statsAt(taipei("2026-09-07"), {
      logs: ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"].map(
        (date, i) => ({ id: `d${i}`, user_id: darren.id, log_date: date, submitted_at: `${date}T09:00:00Z` }),
      ),
    });
    // window 9/1–9/7, 5 workdays (mon_fri), 7 logs → missing 0
    expect(rowOf(stats, "工務")).toMatchObject({ expected: 5, submitted: 7, missing: 0 });
    const before = statsAt(CLOCK_0904_1200, {
      logs: [{ id: "t", user_id: darren.id, log_date: "2026-09-04", submitted_at: "2026-09-04T03:00:00Z" }],
    });
    expect(rowOf(before, "工務")).toMatchObject({ expected: 3, submitted: 0, missing: 3 });
  });
});

// ---------------------------------------------------------------------------
// 新人總覽 (A08(a), A09)
// ---------------------------------------------------------------------------

describe("newcomerOverview (新人總覽)", () => {
  const overviewAt = (now: Instant, overrides: Partial<OverviewInput> = {}) => {
    const data = dataAsOf(now);
    return newcomerOverview({
      newcomers: NEWCOMERS,
      logs: data.logs,
      alerts: data.alerts,
      milestones: ALL_MILESTONES,
      settings: SETTINGS_ROWS,
      now,
      ...overrides,
    });
  };
  const rowOf = (rows: ReturnType<typeof overviewAt>, username: string) => {
    const row = rows.find((r) => r.newcomer.username === username);
    if (!row) throw new Error(`no row for ${username}`);
    return row;
  };

  it("9/4 18:00: four rows in population order; day 4, 第一階段, next D30 10/01", () => {
    const rows = overviewAt(CLOCK_0904_1800);
    expect(usernames(rows)).toEqual([...ALL_NEWCOMER_USERNAMES]);
    for (const row of rows) {
      expect(row.dayNumber).toBe(4);
      expect(row.stage).toEqual({ no: 1, label: "第一階段（D30 前）" });
      expect(row.nextMilestone).toEqual({ kind: "D30", due: EXPECTED_MILESTONE_DUE_DATES.D30, overdueDays: 0 });
      expect(row.missingRate).toMatchObject({ numerator: 2, denominator: 4, rate: 0.5 });
    }
  });

  it("嚴雅齡: 累計預警 1, 回應率 100%; 洪湘庭: 1, 0% (open 1); Darren / 謝文心: 0, rate null", () => {
    const rows = overviewAt(CLOCK_0904_1800);
    expect(rowOf(rows, "yen_yaling")).toMatchObject({
      alertCount: 1,
      openCount: 0,
      responseRate: { numerator: 1, denominator: 1, rate: 1 },
    });
    expect(rowOf(rows, "hung_hsiangting")).toMatchObject({
      alertCount: 1,
      openCount: 1,
      responseRate: { numerator: 0, denominator: 1, rate: 0 },
    });
    for (const username of ["darren", "hsieh_wenhsin"]) {
      expect(rowOf(rows, username)).toMatchObject({
        alertCount: 0,
        openCount: 0,
        responseRate: { numerator: 0, denominator: 0, rate: null },
      });
    }
  });

  it("9/4 12:00: 缺交率 1 − 2/3 and 嚴雅齡 already responded (09:10)", () => {
    const rows = overviewAt(CLOCK_0904_1200);
    expect(rowOf(rows, "darren").missingRate).toMatchObject({ numerator: 1, denominator: 3 });
    expect(rowOf(rows, "yen_yaling").responseRate.rate).toBe(1);
  });

  it("9/3 18:00: day 3, both alerts open, 回應率 0%", () => {
    const rows = overviewAt(CLOCK_0903_1800);
    expect(rowOf(rows, "yen_yaling")).toMatchObject({ dayNumber: 3, alertCount: 1, openCount: 1 });
    expect(rowOf(rows, "yen_yaling").responseRate.rate).toBe(0);
    expect(rowOf(rows, "darren").missingRate).toMatchObject({ numerator: 1, denominator: 3 });
  });

  it("stage and next milestone follow the milestones (A09 / D-05): day 31 → 第二階段, done D30 → next D60", () => {
    const yen = newcomer("yen_yaling");
    const milestones = ALL_MILESTONES.map((m) =>
      m.user_id === yen.id && m.kind === "D30" ? { ...m, done_at: "2026-10-01T02:00:00Z" } : m,
    );
    const rows = overviewAt(taipei("2026-10-02"), { milestones });
    expect(rowOf(rows, "yen_yaling")).toMatchObject({
      dayNumber: 32,
      stage: { no: 2 },
      nextMilestone: { kind: "D60", due: EXPECTED_MILESTONE_DUE_DATES.D60, overdueDays: 0 },
    });
    // Darren's D30 is not done: stage 2 by due date, next milestone overdue by 1 day
    expect(rowOf(rows, "darren")).toMatchObject({
      stage: { no: 2 },
      nextMilestone: { kind: "D30", overdueDays: 1 },
    });
  });

  it("without milestones: stage null and next milestone null; without start_date: dayNumber null, 缺交率 null", () => {
    const darren = newcomer("darren");
    const rows = overviewAt(CLOCK_0904_1800, {
      newcomers: [{ ...darren, start_date: null }],
      milestones: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dayNumber: null, stage: null, nextMilestone: null, missingRate: null });
  });

  it("left / sample profiles yield no row and their rows are ignored (A02)", () => {
    const darren = newcomer("darren");
    const data = dataAsOf(CLOCK_0904_1800);
    const rows = overviewAt(CLOCK_0904_1800, {
      newcomers: [
        ...NEWCOMERS,
        { ...darren, id: "left-1", username: "left_one", status: "left" },
        { ...darren, id: "sample-1", username: "e2e_fresh", status: "sample" },
      ],
      alerts: [...data.alerts, { ...data.alerts[0], id: "left-alert", user_id: "left-1" }],
    });
    expect(usernames(rows)).toEqual([...ALL_NEWCOMER_USERNAMES]);
  });

  it("closed alerts and alerts on deleted logs are not 累計預警 (A08(b))", () => {
    const data = dataAsOf(CLOCK_0904_1800);
    const hung = data.alerts.find((a) => a.rule_key === "R2")!;
    const rows = overviewAt(CLOCK_0904_1800, {
      alerts: [
        ...data.alerts,
        { ...hung, id: "closed", status: "closed" },
        { ...hung, id: "deleted", submission: { deleted_at: "2026-09-04T00:00:00Z" } },
      ],
    });
    expect(rowOf(rows, "hung_hsiangting").alertCount).toBe(1);
  });

  it("is pure: deterministic and does not modify its input", () => {
    const data = dataAsOf(CLOCK_0904_1800);
    const input = {
      newcomers: NEWCOMERS,
      logs: data.logs,
      alerts: data.alerts,
      milestones: ALL_MILESTONES,
      settings: SETTINGS_ROWS,
      now: CLOCK_0904_1800,
    };
    const snapshot = structuredClone(input);
    expect(newcomerOverview(input)).toEqual(newcomerOverview(input));
    expect(input).toEqual(snapshot);
    expect(() => overviewAt("2026-09-04T18:00:00")).toThrow(RangeError);
  });
});
