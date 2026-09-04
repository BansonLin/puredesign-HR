import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  EDITING_HINT,
  NEWCOMER_SELECT_PLACEHOLDER,
  ON_BEHALF_BADGE,
  SUBMIT_WEEKLY_LABEL,
  UPDATE_WEEKLY_LABEL,
  WEEKLY_SAVED_TITLE,
  WeeklyFormView,
} from "@/app/(front)/manager/weekly/WeeklyForm";
import type { FormActionState } from "@/components/forms/FormRenderer";
import { parseQuestions, type Question } from "@/lib/forms/schema";
import { weeklyInitialAnswers } from "@/lib/forms/submit";
import { FIXTURE_NEWCOMERS, FORM_TEMPLATES } from "@seed/fixtures";

/**
 * T22 `WeeklyFormView` through react-dom/server (initial state of the client
 * hooks, D-25): the newcomer dropdown lists the offered rows with the
 * `?newcomer=` one selected, the `week_start` date input is pre-filled with
 * this week's Monday, the submit button is the 44px `data-primary` button
 * and is disabled until a newcomer is selected, and edit mode switches the
 * label to 「更新週回饋」 with the hint.
 */

const noop = async (): Promise<FormActionState> => ({ ok: true });

function parsed(questions: unknown): readonly Question[] {
  const result = parseQuestions(questions);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.questions;
}
const WEEKLY_QUESTIONS = parsed(FORM_TEMPLATES.find((t) => t.key === "weekly_feedback")!.v1.questions);

const NEWCOMERS = FIXTURE_NEWCOMERS.map((n) => ({ id: n.id, display_name: n.display_name }));
const DARREN = NEWCOMERS[0];

function render(overrides: Partial<Parameters<typeof WeeklyFormView>[0]> = {}) {
  const fresh = weeklyInitialAnswers({
    questions: WEEKLY_QUESTIONS,
    actorId: "mgr",
    newcomerId: DARREN.id,
    weekStart: "2026-08-31",
    feedback: [],
  });
  return renderToStaticMarkup(
    <WeeklyFormView
      newcomers={NEWCOMERS}
      selectedId={DARREN.id}
      questions={WEEKLY_QUESTIONS}
      initialAnswers={fresh.answers}
      editing={fresh.editing}
      onBehalf={false}
      action={noop}
      onSelect={() => {}}
      {...overrides}
    />,
  );
}

describe("WeeklyFormView", () => {
  it("lists every offered newcomer with the requested one selected and pre-fills the Monday", () => {
    const html = render();
    for (const n of NEWCOMERS) expect(html).toContain(`>${n.display_name}</option>`);
    expect(html).toContain(NEWCOMER_SELECT_PLACEHOLDER);
    expect(html).toMatch(new RegExp(`<option[^>]*selected[^>]*value="${DARREN.id}"|<option[^>]*value="${DARREN.id}"[^>]*selected`));
    expect(html).toMatch(/name="week_start"[^>]*type="date"[^>]*value="2026-08-31"|type="date"[^>]*name="week_start"[^>]*value="2026-08-31"/);
    expect(html).toContain(SUBMIT_WEEKLY_LABEL);
    expect(html).not.toContain(EDITING_HINT);
    expect(html).not.toContain(ON_BEHALF_BADGE);
    // enabled 44px primary submit
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*data-primary/);
    expect(html).not.toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });

  it("without a selection the submit button is disabled and the placeholder is selected", () => {
    const html = render({ selectedId: null });
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
    expect(html).not.toMatch(new RegExp(`<option[^>]*selected[^>]*value="${DARREN.id}"`));
  });

  it("a selectedId outside the list behaves like no selection", () => {
    const html = render({ selectedId: "00000000-0000-0000-0000-000000000000" });
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });

  it("edit mode: 「更新週回饋」 + hint, existing answers rendered", () => {
    const html = render({
      editing: true,
      initialAnswers: { week_start: "2026-08-31", good: "案場紀律好", improve: "木工協調", next_focus: "文風19" },
    });
    expect(html).toContain(UPDATE_WEEKLY_LABEL);
    expect(html).toContain(EDITING_HINT);
    expect(html).toContain('value="案場紀律好"');
  });

  it("HR on behalf shows the badge", () => {
    expect(render({ onBehalf: true })).toContain(ON_BEHALF_BADGE);
  });

  it("the 「已送出週回饋」 card is absent on a fresh render (it only follows a submit)", () => {
    // Scope of this assertion: it only pins the INITIAL state of the wrapper
    // (`saved` starts false) plus the existence of WEEKLY_SAVED_TITLE and the
    // card's data-testid. The actual reset on target change is React
    // reconciliation driven by `key={selected?.id ?? ""}` in page.tsx (D-47),
    // which this test cannot reach: `saved` only flips through a real submit,
    // and Phase 1 has no jsdom. The remount behaviour is covered by e2e
    // (T27) instead.
    for (const html of [render(), render({ selectedId: null }), render({ editing: true })]) {
      expect(html).not.toContain(WEEKLY_SAVED_TITLE);
      expect(html).not.toContain('data-testid="weekly-saved-card"');
    }
  });
});
