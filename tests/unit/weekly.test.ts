import { describe, expect, it } from "vitest";

import {
  ERROR_WEEKLY_DATE_INVALID,
  ERROR_WEEKLY_FORBIDDEN,
  ERROR_WEEKLY_VERSION_INVALID,
  FORM_ERROR_KEY,
  prepareWeeklyFeedback,
  weeklyInitialAnswers,
  weeklyReminders,
  weekStartQuestion,
  type ExistingWeeklyLike,
  type PrepareWeeklyFeedbackInput,
  type VersionLike,
} from "@/lib/forms/submit";
import { parseQuestions, type Question } from "@/lib/forms/schema";
import { isFriday, weekStartMonday } from "@/lib/time";
import {
  BASE_PROFILES,
  DEPARTMENTS,
  FIXTURE_MANAGERS,
  FIXTURE_NEWCOMERS,
  FIXTURE_WEEKLY_FEEDBACK,
  FORM_TEMPLATES,
} from "@seed/fixtures";
import { buildSeedPlan } from "@seed/plan";

/**
 * T22 `prepareWeeklyFeedback` / `weeklyInitialAnswers` / `weeklyReminders`
 * (pure) on the §11 fixture: 工務主任 writes Darren's 8/31 feedback (the seed
 * row), a Wednesday `week_start` is normalized to its Monday and written
 * back into the answers, the same (author, newcomer, week) updates instead
 * of inserting, 工務主任 is refused on 嚴雅齡, HR fills in on behalf, and the
 * Friday reminder skips Darren on 9/4 (8/31 week already covered) while
 * listing the other three. No database: rows are in-memory objects shaped
 * like the tables.
 */

const PLAN = buildSeedPlan();

function departmentId(name: string | null): string | null {
  if (name === null) return null;
  const found = DEPARTMENTS.find((d) => d.name === name);
  if (!found) throw new Error(`unknown department ${name}`);
  return found.id;
}

type SeedPerson =
  | (typeof FIXTURE_MANAGERS)[number]
  | (typeof FIXTURE_NEWCOMERS)[number]
  | (typeof BASE_PROFILES)[number];

function profile(person: SeedPerson) {
  return {
    id: person.id,
    role: person.role,
    department_id: departmentId(person.department),
    status: person.status,
  };
}

function manager(username: string) {
  const found = FIXTURE_MANAGERS.find((m) => m.username === username);
  if (!found) throw new Error(`unknown manager ${username}`);
  return profile(found);
}

function newcomer(username: string) {
  const found = FIXTURE_NEWCOMERS.find((n) => n.username === username);
  if (!found) throw new Error(`unknown newcomer ${username}`);
  return profile(found);
}

function base(username: string) {
  const found = BASE_PROFILES.find((p) => p.username === username);
  if (!found) throw new Error(`unknown base profile ${username}`);
  return profile(found);
}

const MGR_CONSTRUCTION = manager("mgr_construction");
const MGR_PROCUREMENT = manager("mgr_procurement");
const DARREN = newcomer("darren");
const YEN = newcomer("yen_yaling");
const HR = base("hr");
const CEO = base("ceo");

const WEEKLY_TEMPLATE = FORM_TEMPLATES.find((t) => t.key === "weekly_feedback")!;
const WEEKLY_V1: VersionLike = { id: WEEKLY_TEMPLATE.v1.id, questions: WEEKLY_TEMPLATE.v1.questions };

function parsed(questions: unknown): readonly Question[] {
  const result = parseQuestions(questions);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.questions;
}
const WEEKLY_QUESTIONS = parsed(WEEKLY_V1.questions);

const SEED_WEEKLY = FIXTURE_WEEKLY_FEEDBACK[0];
/** 9/4 17:00 Taipei — the seed submission instant of the 8/31 feedback. */
const NOW_0904_1700 = new Date("2026-09-04T09:00:00Z");
const FRIDAY_0904 = "2026-09-04";
const THURSDAY_0903 = "2026-09-03";

const SEED_ANSWERS = { ...SEED_WEEKLY.answers };

function input(overrides: Partial<PrepareWeeklyFeedbackInput> = {}): PrepareWeeklyFeedbackInput {
  return {
    now: NOW_0904_1700,
    actor: MGR_CONSTRUCTION,
    newcomer: DARREN,
    activeVersion: WEEKLY_V1,
    existingFeedback: [],
    rawAnswers: SEED_ANSWERS,
    ...overrides,
  };
}

describe("prepareWeeklyFeedback — §11 seed row (工務主任 → Darren, week 8/31)", () => {
  it("prepares exactly the row the seed writes", () => {
    const result = prepareWeeklyFeedback(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const planned = PLAN.weekly.find((w) => w.seq === SEED_WEEKLY.seq)!;
    expect(result.user_id).toBe(planned.user_id);
    expect(result.target_user_id).toBe(planned.target_user_id);
    expect(result.form_version_id).toBe(planned.form_version_id);
    expect(result.week_start).toBe("2026-08-31");
    expect(result.answers).toEqual(planned.answers);
    expect(result.answers.week_start).toBe(result.week_start);
    expect(result.submitted_at).toBe(planned.submitted_at);
    expect(result.updated_at).toBe(result.submitted_at);
    expect(result.existing_id).toBeNull();
    expect(result.on_behalf).toBe(false);
  });

  it("normalizes a mid-week start_date to its Monday and syncs answers.week_start", () => {
    const result = prepareWeeklyFeedback(
      input({ rawAnswers: { ...SEED_ANSWERS, week_start: "2026-09-02" } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.week_start).toBe("2026-08-31");
    expect(result.answers.week_start).toBe("2026-08-31");
  });

  it("falls back to the week of `now` when the start_date answer is empty (non-required slot)", () => {
    const optional = WEEKLY_QUESTIONS.map((q) => (q.key === "week_start" ? { ...q, required: false } : q));
    const result = prepareWeeklyFeedback(
      input({
        activeVersion: { id: "v-optional", questions: optional },
        rawAnswers: { ...SEED_ANSWERS, week_start: "" },
        now: new Date("2026-09-09T02:00:00Z"), // Wed 9/9 10:00 Taipei
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.week_start).toBe("2026-09-07");
    expect(result.answers.week_start).toBe("2026-09-07");
  });

  it("falls back to the week of `now` when the version has no weekly.start_date question", () => {
    const noSlot = WEEKLY_QUESTIONS.filter((q) => q.slot !== "weekly.start_date");
    const result = prepareWeeklyFeedback(
      input({
        activeVersion: { id: "v-noslot", questions: noSlot },
        rawAnswers: { good: "a", improve: "b", next_focus: "c" },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.week_start).toBe("2026-08-31");
    expect(Object.keys(result.answers)).toEqual(["good", "improve", "next_focus"]);
  });

  it("uses Taipei, not UTC, for the fallback week (Sunday 23:00Z is Monday 07:00 Taipei)", () => {
    const noSlot = WEEKLY_QUESTIONS.filter((q) => q.slot !== "weekly.start_date");
    const result = prepareWeeklyFeedback(
      input({
        activeVersion: { id: "v-noslot", questions: noSlot },
        rawAnswers: { good: "a", improve: "b", next_focus: "c" },
        now: new Date("2026-09-06T23:00:00Z"),
      }),
    );
    expect(result.ok && result.week_start).toBe("2026-09-07");
  });

  it("re-sending the same week updates the existing row (natural key) with a fresh submitted_at", () => {
    const existing: ExistingWeeklyLike[] = [
      { id: "wk-other-week", week_start: "2026-08-24" },
      { id: "wk-0831", week_start: "2026-08-31" },
    ];
    const later = new Date("2026-09-05T01:00:00Z");
    const result = prepareWeeklyFeedback(
      input({ existingFeedback: existing, rawAnswers: { ...SEED_ANSWERS, week_start: "2026-09-03" }, now: later }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.existing_id).toBe("wk-0831");
    expect(result.submitted_at).toBe(later.toISOString());
  });

  it("a different week inserts even when other weeks exist", () => {
    const result = prepareWeeklyFeedback(
      input({
        existingFeedback: [{ id: "wk-0831", week_start: "2026-08-31" }],
        rawAnswers: { ...SEED_ANSWERS, week_start: "2026-09-07" },
      }),
    );
    expect(result.ok && result.existing_id).toBeNull();
    expect(result.ok && result.week_start).toBe("2026-09-07");
  });
});

describe("prepareWeeklyFeedback — §10 row 4", () => {
  it("工務主任 cannot write 嚴雅齡's feedback (other department)", () => {
    const result = prepareWeeklyFeedback(input({ newcomer: YEN }));
    expect(result).toEqual({
      ok: false,
      code: "forbidden",
      errors: { [FORM_ERROR_KEY]: ERROR_WEEKLY_FORBIDDEN },
    });
  });

  it("採購主管 can write 嚴雅齡's feedback", () => {
    const result = prepareWeeklyFeedback(input({ actor: MGR_PROCUREMENT, newcomer: YEN }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.on_behalf).toBe(false);
  });

  it("HR fills in on behalf (on_behalf true, target_user_id = the newcomer)", () => {
    const result = prepareWeeklyFeedback(input({ actor: HR, newcomer: YEN }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.on_behalf).toBe(true);
    expect(result.user_id).toBe(HR.id);
    expect(result.target_user_id).toBe(YEN.id);
  });

  it("ceo is refused; a left newcomer is refused", () => {
    expect(prepareWeeklyFeedback(input({ actor: CEO })).ok).toBe(false);
    expect(prepareWeeklyFeedback(input({ newcomer: { ...DARREN, status: "left" } })).ok).toBe(false);
  });
});

describe("prepareWeeklyFeedback — version and answers", () => {
  it("an unparseable active version fails with code 'version'", () => {
    const result = prepareWeeklyFeedback(input({ activeVersion: { id: "bad", questions: "nope" } }));
    expect(result).toEqual({
      ok: false,
      code: "version",
      errors: { [FORM_ERROR_KEY]: ERROR_WEEKLY_VERSION_INVALID },
    });
  });

  it("missing required answers come back per question", () => {
    const result = prepareWeeklyFeedback(input({ rawAnswers: { week_start: "2026-08-31", good: "ok" } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("validation");
    expect(Object.keys(result.errors).sort()).toEqual(["improve", "next_focus"]);
  });

  it("a malformed date on the start_date question is rejected on that question", () => {
    // `date` questions are caught by validateAnswers; a short_text on the slot by the weekly gate.
    const viaDate = prepareWeeklyFeedback(input({ rawAnswers: { ...SEED_ANSWERS, week_start: "2026/8/31" } }));
    expect(viaDate.ok).toBe(false);
    expect(!viaDate.ok && viaDate.errors.week_start).toBeDefined();

    const textSlot = WEEKLY_QUESTIONS.map((q) =>
      q.key === "week_start" ? { ...q, type: "short_text" as const } : q,
    );
    const viaText = prepareWeeklyFeedback(
      input({
        activeVersion: { id: "v-text", questions: textSlot },
        rawAnswers: { ...SEED_ANSWERS, week_start: "last week" },
      }),
    );
    expect(viaText).toEqual({
      ok: false,
      code: "validation",
      errors: { week_start: ERROR_WEEKLY_DATE_INVALID },
    });
  });

  it("weekStartQuestion finds the enabled slot question only", () => {
    expect(weekStartQuestion(WEEKLY_QUESTIONS)?.key).toBe("week_start");
    const disabled = WEEKLY_QUESTIONS.map((q) => (q.key === "week_start" ? { ...q, disabled: true } : q));
    expect(weekStartQuestion(disabled)).toBeNull();
  });
});

describe("weeklyInitialAnswers — /manager/weekly initial form", () => {
  const planned = PLAN.weekly.find((w) => w.seq === SEED_WEEKLY.seq)!;
  const rows = [
    {
      user_id: planned.user_id,
      target_user_id: planned.target_user_id,
      week_start: planned.week_start,
      answers: planned.answers,
    },
  ];

  it("pre-fills this week's Monday on a fresh form", () => {
    const { answers, editing } = weeklyInitialAnswers({
      questions: WEEKLY_QUESTIONS,
      actorId: MGR_CONSTRUCTION.id,
      newcomerId: DARREN.id,
      weekStart: "2026-09-07",
      feedback: rows,
    });
    expect(editing).toBe(false);
    expect(answers).toEqual({ week_start: "2026-09-07", good: null, improve: null, next_focus: null });
  });

  it("switches to edit mode with the actor's own row for (newcomer, week)", () => {
    const { answers, editing } = weeklyInitialAnswers({
      questions: WEEKLY_QUESTIONS,
      actorId: MGR_CONSTRUCTION.id,
      newcomerId: DARREN.id,
      weekStart: "2026-08-31",
      feedback: rows,
    });
    expect(editing).toBe(true);
    expect(answers).toEqual(planned.answers);
  });

  it("another author's row does not become the actor's edit mode", () => {
    const { editing, answers } = weeklyInitialAnswers({
      questions: WEEKLY_QUESTIONS,
      actorId: HR.id,
      newcomerId: DARREN.id,
      weekStart: "2026-08-31",
      feedback: rows,
    });
    expect(editing).toBe(false);
    expect(answers.week_start).toBe("2026-08-31");
    expect(answers.good).toBeNull();
  });
});

describe("weeklyReminders — /manager Friday 「週回饋未填」", () => {
  const NEWCOMER_IDS = FIXTURE_NEWCOMERS.map((n) => n.id);
  const THIS_WEEK_ROWS = PLAN.weekly.map((w) => ({ target_user_id: w.target_user_id, week_start: w.week_start }));

  it("9/4 is a Friday and 8/31 is its Monday (fixture sanity)", () => {
    expect(isFriday(FRIDAY_0904)).toBe(true);
    expect(isFriday(THURSDAY_0903)).toBe(false);
    expect(weekStartMonday(FRIDAY_0904)).toBe("2026-08-31");
  });

  it("seed at Fri 9/4: Darren has the 8/31 feedback → not reminded; the other three are", () => {
    const result = weeklyReminders({ today: FRIDAY_0904, newcomerIds: NEWCOMER_IDS, feedback: THIS_WEEK_ROWS });
    expect(result.due).toBe(true);
    expect(result.weekStart).toBe("2026-08-31");
    expect(result.missing).not.toContain(DARREN.id);
    expect([...result.missing].sort()).toEqual(NEWCOMER_IDS.filter((id) => id !== DARREN.id).sort());
  });

  it("not a Friday → nothing is due, even with no feedback at all", () => {
    const result = weeklyReminders({ today: THURSDAY_0903, newcomerIds: NEWCOMER_IDS, feedback: [] });
    expect(result).toEqual({ weekStart: "2026-08-31", due: false, missing: [] });
  });

  it("feedback for another week does not cover this week; any author counts", () => {
    const lastWeek = weeklyReminders({
      today: FRIDAY_0904,
      newcomerIds: [DARREN.id],
      feedback: [{ target_user_id: DARREN.id, week_start: "2026-08-24" }],
    });
    expect(lastWeek.missing).toEqual([DARREN.id]);

    const nextFriday = weeklyReminders({ today: "2026-09-11", newcomerIds: [DARREN.id], feedback: THIS_WEEK_ROWS });
    expect(nextFriday.weekStart).toBe("2026-09-07");
    expect(nextFriday.missing).toEqual([DARREN.id]);

    const byHr = weeklyReminders({
      today: FRIDAY_0904,
      newcomerIds: [DARREN.id],
      feedback: [{ target_user_id: DARREN.id, week_start: "2026-08-31" }],
    });
    expect(byHr.missing).toEqual([]);
  });

  it("only listed newcomers are reported; null target rows are ignored", () => {
    const result = weeklyReminders({
      today: FRIDAY_0904,
      newcomerIds: [YEN.id],
      feedback: [{ target_user_id: null, week_start: "2026-08-31" }],
    });
    expect(result.missing).toEqual([YEN.id]);
  });
});
