import { describe, expect, it } from "vitest";
import {
  ALL_NEWCOMER_USERNAMES,
  CLOCK_0903_1800,
  CLOCK_0904_1200,
  CLOCK_0904_1800,
  CLOCK_0904_1830,
  EXPECTED_ALERTS,
  EXPECTED_ESCALATION,
  EXPECTED_MISSING_0904,
  FIXTURE_DAILY_LOGS,
  FIXTURE_NEWCOMERS,
  FIXTURE_RESPONSES,
  SETTINGS,
  YEN_R1_RESPONSE_LAG_MS,
} from "@seed/fixtures";
import { RESPONSE_STATUS_NEED_HR } from "@/lib/rules/constants";
import {
  HR_NEED_HELP_WINDOW_DAYS,
  alertState,
  hrInterventionList,
  listMissing,
  logStatus,
  type AlertLike,
  type InterventionAlertLike,
  type NewcomerLike,
  type ResponseLike,
} from "@/lib/rules/derived";

// ---------------------------------------------------------------------------
// fixture → row shapes (natural keys → ids, as seed.ts does)
// ---------------------------------------------------------------------------

const CUTOFF = SETTINGS.daily_cutoff_time; // "18:00"
const THRESHOLD = SETTINGS.response_threshold_hours; // 24

function newcomer(username: string) {
  const found = FIXTURE_NEWCOMERS.find((p) => p.username === username);
  if (!found) throw new Error(`unknown newcomer ${username}`);
  return found;
}

/** `alerts` rows as `applyAlertChanges` writes them: `created_at = log.submitted_at`. */
function alertRow(
  expected: (typeof EXPECTED_ALERTS)[number],
): InterventionAlertLike & { rule_key: string } {
  return {
    user_id: newcomer(expected.username).id,
    rule_key: expected.rule_key,
    status: expected.status,
    created_at: expected.created_at,
    responded_at: expected.responded_at,
  };
}

const YEN_R1 = alertRow(EXPECTED_ALERTS[0]);
const HUNG_R2 = alertRow(EXPECTED_ALERTS[1]);
const ALERT_ROWS = [YEN_R1, HUNG_R2];

/** Fixture manager responses with `response.status` resolved (v1 key `status`). */
const RESPONSE_ROWS: ResponseLike[] = FIXTURE_RESPONSES.map((r) => ({
  user_id: r.username,
  target_user_id: newcomer(r.target_username).id,
  target_submission_id: `log-${r.target_log_seq}`,
  submitted_at: r.submitted_at,
  response_status: r.answers.status,
}));

/** Ids of the newcomers that have a daily log on `date`. */
function logsOn(date: string): Set<string> {
  return new Set(
    FIXTURE_DAILY_LOGS.filter((log) => log.log_date === date).map(
      (log) => newcomer(log.username).id,
    ),
  );
}

function usernames(rows: readonly { username: string }[]): string[] {
  return rows.map((r) => r.username);
}

// ---------------------------------------------------------------------------
// sanity: the fixture ties the alert clock to the log clock
// ---------------------------------------------------------------------------

describe("fixture wiring", () => {
  it("EXPECTED_ALERTS.created_at equals the daily log's submitted_at", () => {
    for (const expected of EXPECTED_ALERTS) {
      const log = FIXTURE_DAILY_LOGS.find((l) => l.seq === expected.log_seq);
      expect(log).toBeDefined();
      expect(new Date(expected.created_at).getTime()).toBe(
        new Date(log!.submitted_at).getTime(),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// A1 — alertState
// ---------------------------------------------------------------------------

describe("alertState (§7 A1, strict > threshold)", () => {
  it("洪湘庭 R2 (created 9/3 17:06) is overdue at 9/4 18:00 and open at 9/4 12:00", () => {
    expect(alertState({ alert: HUNG_R2, thresholdHours: THRESHOLD, now: CLOCK_0904_1800 })).toBe(
      "overdue",
    );
    expect(EXPECTED_ESCALATION.at_1800.overdue).toBe(true);
    expect(alertState({ alert: HUNG_R2, thresholdHours: THRESHOLD, now: CLOCK_0904_1200 })).toBe(
      "open",
    );
    expect(EXPECTED_ESCALATION.at_1200.overdue).toBe(false);
  });

  it("exactly 24h after creation is still open; one minute later is overdue", () => {
    expect(
      alertState({ alert: HUNG_R2, thresholdHours: THRESHOLD, now: "2026-09-04T09:06:00Z" }),
    ).toBe("open");
    expect(
      alertState({ alert: HUNG_R2, thresholdHours: THRESHOLD, now: "2026-09-04T09:07:00Z" }),
    ).toBe("overdue");
    // also as a Date and at the millisecond boundary
    expect(
      alertState({
        alert: HUNG_R2,
        thresholdHours: THRESHOLD,
        now: new Date("2026-09-04T09:06:00.000Z"),
      }),
    ).toBe("open");
    expect(
      alertState({
        alert: HUNG_R2,
        thresholdHours: THRESHOLD,
        now: new Date("2026-09-04T09:06:00.001Z"),
      }),
    ).toBe("overdue");
  });

  it("嚴雅齡 R1 is responded after 16h07m — not late at 24h, late at a 12h threshold", () => {
    const lagMs = new Date(YEN_R1.responded_at!).getTime() - new Date(YEN_R1.created_at).getTime();
    expect(lagMs).toBe(YEN_R1_RESPONSE_LAG_MS);
    expect(lagMs / 3_600_000).toBeCloseTo(16.12, 2);

    expect(alertState({ alert: YEN_R1, thresholdHours: THRESHOLD, now: CLOCK_0904_1800 })).toBe(
      "responded",
    );
    expect(alertState({ alert: YEN_R1, thresholdHours: 12, now: CLOCK_0904_1800 })).toBe(
      "responded_late",
    );
    // the response lag is fixed: `now` does not change a responded alert
    expect(alertState({ alert: YEN_R1, thresholdHours: 12, now: "2026-12-31T00:00:00Z" })).toBe(
      "responded_late",
    );
    expect(alertState({ alert: YEN_R1, thresholdHours: THRESHOLD, now: "2026-12-31T00:00:00Z" })).toBe(
      "responded",
    );
  });

  it("late is strict: a lag equal to the threshold is on time", () => {
    const lagHours = YEN_R1_RESPONSE_LAG_MS / 3_600_000; // 16 + 7/60
    expect(alertState({ alert: YEN_R1, thresholdHours: lagHours, now: CLOCK_0904_1800 })).toBe(
      "responded",
    );
    expect(
      alertState({ alert: YEN_R1, thresholdHours: lagHours - 1 / 60, now: CLOCK_0904_1800 }),
    ).toBe("responded_late");
  });

  it("closed alerts never escalate; a responded row without responded_at counts as on time", () => {
    const closed: AlertLike = { ...HUNG_R2, status: "closed" };
    expect(alertState({ alert: closed, thresholdHours: THRESHOLD, now: "2027-01-01T00:00:00Z" })).toBe(
      "closed",
    );
    const inconsistent: AlertLike = { ...HUNG_R2, status: "responded", responded_at: null };
    expect(alertState({ alert: inconsistent, thresholdHours: 0, now: CLOCK_0904_1800 })).toBe(
      "responded",
    );
  });

  it("accepts PostgREST '+00:00' timestamps", () => {
    const pg: AlertLike = {
      status: "open",
      created_at: "2026-09-03T09:06:00+00:00",
      responded_at: null,
    };
    expect(alertState({ alert: pg, thresholdHours: THRESHOLD, now: CLOCK_0904_1800 })).toBe("overdue");
    expect(alertState({ alert: pg, thresholdHours: THRESHOLD, now: CLOCK_0904_1200 })).toBe("open");
  });

  it("rejects naive strings (no Z / ±HH:mm) and date-only strings, like lib/time", () => {
    const naive: AlertLike = {
      status: "open",
      created_at: "2026-09-03T09:06:00",
      responded_at: null,
    };
    expect(() =>
      alertState({ alert: naive, thresholdHours: THRESHOLD, now: CLOCK_0904_1800 }),
    ).toThrow(RangeError);
    expect(() =>
      alertState({ alert: HUNG_R2, thresholdHours: THRESHOLD, now: "2026-09-04T18:00:00" }),
    ).toThrow(RangeError);
    expect(() =>
      alertState({ alert: HUNG_R2, thresholdHours: THRESHOLD, now: "2026-09-04" }),
    ).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// R3 — logStatus / listMissing
// ---------------------------------------------------------------------------

describe("logStatus (§7 R3, cutoff >=)", () => {
  const darren = newcomer("darren");
  const base = { newcomer: darren, date: "2026-09-04", hasLog: false, cutoff: CUTOFF };

  it("9/4: pending at 12:00, missing at 18:00:00 sharp and at 18:30", () => {
    expect(logStatus({ ...base, now: CLOCK_0904_1200 })).toBe("pending");
    expect(logStatus({ ...base, now: CLOCK_0904_1800 })).toBe("missing");
    expect(logStatus({ ...base, now: CLOCK_0904_1830 })).toBe("missing");
    expect(logStatus({ ...base, now: "2026-09-04T09:59:59.999Z" })).toBe("pending");
  });

  it("a log on the date is submitted regardless of the clock", () => {
    expect(logStatus({ ...base, hasLog: true, now: CLOCK_0904_1200 })).toBe("submitted");
    expect(logStatus({ ...base, hasLog: true, now: CLOCK_0904_1830 })).toBe("submitted");
  });

  it("9/3: all four newcomers submitted (checked from 9/3 18:00 and 9/4 18:30)", () => {
    const logs = logsOn("2026-09-03");
    for (const n of FIXTURE_NEWCOMERS) {
      for (const now of [CLOCK_0903_1800, CLOCK_0904_1830]) {
        expect(
          logStatus({ newcomer: n, date: "2026-09-03", hasLog: logs.has(n.id), cutoff: CUTOFF, now }),
        ).toBe("submitted");
      }
    }
  });

  it("is n/a for left / sample profiles even when a log exists or the cutoff passed", () => {
    const left: NewcomerLike = { ...darren, status: "left" };
    const sample: NewcomerLike = { ...darren, status: "sample" };
    for (const n of [left, sample]) {
      expect(logStatus({ ...base, newcomer: n, now: CLOCK_0904_1830 })).toBe("n/a");
      expect(logStatus({ ...base, newcomer: n, hasLog: true, now: CLOCK_0904_1830 })).toBe("n/a");
      expect(logStatus({ ...base, newcomer: n, now: CLOCK_0904_1200 })).toBe("n/a");
    }
  });

  it("is n/a before start_date and when start_date is unset; counts from start_date itself", () => {
    expect(logStatus({ ...base, date: "2026-08-31", now: CLOCK_0904_1830 })).toBe("n/a");
    expect(logStatus({ ...base, date: "2026-09-01", now: CLOCK_0904_1830 })).toBe("missing");
    const noStart: NewcomerLike = { ...darren, start_date: null };
    expect(logStatus({ ...base, newcomer: noStart, now: CLOCK_0904_1830 })).toBe("n/a");
  });

  it("a future date is pending", () => {
    expect(logStatus({ ...base, date: "2026-09-05", now: CLOCK_0904_1830 })).toBe("pending");
  });

  it("follows a changed cutoff", () => {
    expect(logStatus({ ...base, cutoff: "19:00", now: CLOCK_0904_1830 })).toBe("pending");
    expect(logStatus({ ...base, cutoff: "12:00", now: CLOCK_0904_1200 })).toBe("missing");
  });
});

describe("listMissing (R3 缺交名單)", () => {
  it("9/4 at 18:30: all four are missing; at 18:00:00: already all four; at 12:00: nobody", () => {
    const logs = logsOn("2026-09-04");
    expect(logs.size).toBe(0);
    const at = (now: Date) =>
      usernames(
        listMissing({ newcomers: FIXTURE_NEWCOMERS, date: "2026-09-04", logsByUserId: logs, cutoff: CUTOFF, now }),
      );
    expect(at(CLOCK_0904_1830)).toEqual([...EXPECTED_MISSING_0904.at_1830]);
    expect(at(CLOCK_0904_1830)).toEqual([...ALL_NEWCOMER_USERNAMES]);
    expect(at(CLOCK_0904_1800)).toEqual([...ALL_NEWCOMER_USERNAMES]);
    expect(at(CLOCK_0904_1200)).toEqual([...EXPECTED_MISSING_0904.at_1200]);
    expect(at(CLOCK_0904_1200)).toEqual([]);
  });

  it("9/3 at 18:00: nobody is missing (all four submitted)", () => {
    expect(
      listMissing({
        newcomers: FIXTURE_NEWCOMERS,
        date: "2026-09-03",
        logsByUserId: logsOn("2026-09-03"),
        cutoff: CUTOFF,
        now: CLOCK_0903_1800,
      }),
    ).toEqual([]);
  });

  it("lists only those without a log, keeping the input order", () => {
    const logs = new Set([newcomer("yen_yaling").id, newcomer("hung_hsiangting").id]);
    expect(
      usernames(
        listMissing({ newcomers: FIXTURE_NEWCOMERS, date: "2026-09-04", logsByUserId: logs, cutoff: CUTOFF, now: CLOCK_0904_1830 }),
      ),
    ).toEqual(["darren", "hsieh_wenhsin"]);
  });

  it("accepts a Map keyed by user id as the log lookup", () => {
    const logs = new Map([[newcomer("darren").id, { seq: 99 }]]);
    expect(
      usernames(
        listMissing({ newcomers: FIXTURE_NEWCOMERS, date: "2026-09-04", logsByUserId: logs, cutoff: CUTOFF, now: CLOCK_0904_1830 }),
      ),
    ).toEqual(["yen_yaling", "hsieh_wenhsin", "hung_hsiangting"]);
  });

  it("skips left / sample newcomers even when handed in (A02: population is activeNewcomers())", () => {
    const withOthers = [
      ...FIXTURE_NEWCOMERS,
      { ...newcomer("darren"), id: "left-1", username: "left_one", status: "left" as const },
      { ...newcomer("darren"), id: "sample-1", username: "e2e_fresh", status: "sample" as const },
    ];
    expect(
      usernames(
        listMissing({ newcomers: withOthers, date: "2026-09-04", logsByUserId: new Set(), cutoff: CUTOFF, now: CLOCK_0904_1830 }),
      ),
    ).toEqual([...ALL_NEWCOMER_USERNAMES]);
  });
});

// ---------------------------------------------------------------------------
// HR intervention list (PLAN A04)
// ---------------------------------------------------------------------------

describe("hrInterventionList (§8 HR 介入清單)", () => {
  const list = (now: Date, extra: { alerts?: InterventionAlertLike[]; responses?: ResponseLike[] } = {}) =>
    hrInterventionList({
      newcomers: FIXTURE_NEWCOMERS,
      alerts: extra.alerts ?? ALERT_ROWS,
      responses: extra.responses ?? RESPONSE_ROWS,
      now,
      thresholdHours: THRESHOLD,
    });

  it("default window is 7 days", () => {
    expect(HR_NEED_HELP_WINDOW_DAYS).toBe(7);
  });

  it("9/4 18:00: overdue = 洪湘庭 R2 (24h54m open); 嚴雅齡's responded R1 is not listed", () => {
    const result = list(CLOCK_0904_1800);
    expect(result.overdue.map((e) => e.newcomer.username)).toEqual([
      ...EXPECTED_ESCALATION.at_1800.hr_intervention,
    ]);
    expect(result.overdue).toHaveLength(1);
    expect(result.overdue[0].alert).toBe(HUNG_R2);
    expect(result.overdue[0].newcomer.display_name).toBe("洪湘庭");
    expect(result.overdue[0].openHours).toBeCloseTo(24.9, 1);
    // fixture responses are 已處理 / 已讀，無需處理: nothing needs HR
    expect(result.needHr).toEqual([]);
  });

  it("9/4 12:00: nothing is overdue yet", () => {
    const result = list(CLOCK_0904_1200);
    expect(result.overdue).toEqual([]);
    expect([...EXPECTED_ESCALATION.at_1200.hr_intervention]).toEqual([]);
    expect(result.needHr).toEqual([]);
  });

  it("an alert leaves the overdue segment once responded; closed never enters", () => {
    const responded: InterventionAlertLike = {
      ...HUNG_R2,
      status: "responded",
      responded_at: "2026-09-04T11:00:00Z",
    };
    expect(list(CLOCK_0904_1830, { alerts: [responded] }).overdue).toEqual([]);
    const closed: InterventionAlertLike = { ...HUNG_R2, status: "closed" };
    expect(list(CLOCK_0904_1830, { alerts: [closed] }).overdue).toEqual([]);
  });

  it("overdue is sorted oldest first", () => {
    const older: InterventionAlertLike = {
      user_id: newcomer("darren").id,
      status: "open",
      created_at: "2026-09-02T09:05:00Z",
      responded_at: null,
    };
    const result = list(CLOCK_0904_1800, { alerts: [HUNG_R2, older] });
    expect(result.overdue.map((e) => e.newcomer.username)).toEqual(["darren", "hung_hsiangting"]);
  });

  it("needHr: a 需 HR 協助 response on an alert-free log (Darren 9/3) is listed, with the newcomer", () => {
    const needHelp: ResponseLike = {
      user_id: "mgr_construction",
      target_user_id: newcomer("darren").id,
      target_submission_id: "log-5",
      submitted_at: "2026-09-04T10:00:00+08:00",
      response_status: RESPONSE_STATUS_NEED_HR,
    };
    const result = list(CLOCK_0904_1800, { responses: [...RESPONSE_ROWS, needHelp] });
    expect(result.needHr).toHaveLength(1);
    expect(result.needHr[0].response).toBe(needHelp);
    expect(result.needHr[0].newcomer.username).toBe("darren");
    // the overdue segment is unaffected
    expect(result.overdue.map((e) => e.newcomer.username)).toEqual(["hung_hsiangting"]);
  });

  it("needHr: window is windowDays Taipei calendar days including today", () => {
    const at = (submitted_at: string, windowDays?: number) =>
      hrInterventionList({
        newcomers: FIXTURE_NEWCOMERS,
        alerts: [],
        responses: [
          {
            user_id: "mgr_construction",
            target_user_id: newcomer("darren").id,
            target_submission_id: "log-x",
            submitted_at,
            response_status: RESPONSE_STATUS_NEED_HR,
          },
        ],
        now: CLOCK_0904_1800, // Taipei 9/4
        thresholdHours: THRESHOLD,
        windowDays,
      }).needHr.length;
    expect(at("2026-09-04T09:00:00+08:00")).toBe(1); // today
    expect(at("2026-08-29T00:00:00+08:00")).toBe(1); // 6 days ago: last day inside
    expect(at("2026-08-28T23:59:00+08:00")).toBe(0); // 7 days ago: out
    expect(at("2026-08-28T20:00:00Z")).toBe(1); // = 8/29 04:00 Taipei: inside
    expect(at("2026-09-05T08:00:00+08:00")).toBe(0); // in the future: not yet
    expect(at("2026-08-28T23:59:00+08:00", 8)).toBe(1); // wider window
    expect(at("2026-09-03T09:00:00+08:00", 1)).toBe(0); // window of 1 = today only
  });

  it("needHr: other statuses, trimmed match, missing target, left / sample newcomers", () => {
    const mk = (over: Partial<ResponseLike>): ResponseLike => ({
      user_id: "mgr_construction",
      target_user_id: newcomer("darren").id,
      target_submission_id: "log-5",
      submitted_at: "2026-09-04T10:00:00+08:00",
      response_status: RESPONSE_STATUS_NEED_HR,
      ...over,
    });
    const leftNewcomer = { ...newcomer("darren"), id: "left-1", username: "left_one", status: "left" as const };
    const sampleNewcomer = { ...newcomer("darren"), id: "sample-1", username: "e2e_fresh", status: "sample" as const };
    const result = hrInterventionList({
      newcomers: [...FIXTURE_NEWCOMERS, leftNewcomer, sampleNewcomer],
      alerts: [
        { ...HUNG_R2, user_id: "left-1" }, // overdue alert of a left newcomer: dropped
        HUNG_R2,
      ],
      responses: [
        mk({ response_status: "已處理" }),
        mk({ response_status: "已讀，無需處理" }),
        mk({ response_status: null }),
        mk({ response_status: ` ${RESPONSE_STATUS_NEED_HR} ` }), // trimmed: counts
        mk({ target_user_id: null }),
        mk({ target_user_id: "left-1" }),
        mk({ target_user_id: "sample-1" }),
        mk({ target_user_id: "unknown" }),
      ],
      now: CLOCK_0904_1800,
      thresholdHours: THRESHOLD,
    });
    expect(result.needHr).toHaveLength(1);
    expect(result.needHr[0].response.response_status).toBe(` ${RESPONSE_STATUS_NEED_HR} `);
    expect(result.overdue.map((e) => e.newcomer.username)).toEqual(["hung_hsiangting"]);
  });

  it("needHr is sorted newest first", () => {
    const mk = (submitted_at: string): ResponseLike => ({
      user_id: "mgr_construction",
      target_user_id: newcomer("darren").id,
      target_submission_id: "log-5",
      submitted_at,
      response_status: RESPONSE_STATUS_NEED_HR,
    });
    const result = list(CLOCK_0904_1800, {
      responses: [mk("2026-09-02T10:00:00+08:00"), mk("2026-09-04T10:00:00+08:00")],
    });
    expect(result.needHr.map((e) => e.response.submitted_at)).toEqual([
      "2026-09-04T10:00:00+08:00",
      "2026-09-02T10:00:00+08:00",
    ]);
  });
});
