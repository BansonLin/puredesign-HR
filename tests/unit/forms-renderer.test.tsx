import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FormRenderer, type FormActionState } from "@/components/forms/FormRenderer";
import { parseQuestions, type Answers, type Question } from "@/lib/forms/schema";
import { NEWCOMER_DAILY_QUESTIONS } from "@seed/fixtures";

import { ALL_TYPES_QUESTIONS, ALL_TYPES_USER_OPTIONS } from "./fixtures/all-types";

/**
 * T13: the renderer is exercised through react-dom/server (no jsdom), which
 * renders the initial state of `useState` / `useActionState` — enough to
 * check every field type, required / help / placeholder, and the show_if
 * visibility that FormRenderer derives from `resolveVisibility`.
 */

const noop = async (): Promise<FormActionState> => ({ ok: true });

function render(questions: readonly Question[], answers: Answers | null = null) {
  return renderToStaticMarkup(
    <FormRenderer
      questions={questions}
      initialAnswers={answers}
      userOptions={ALL_TYPES_USER_OPTIONS}
      action={noop}
      submitLabel="儲存"
    />,
  );
}

/** The opening tag (`<tag …>`) of the element whose `id` is `id`, or null. */
function tagById(html: string, id: string): string | null {
  const at = html.indexOf(`id="${id}"`);
  if (at === -1) return null;
  const start = html.lastIndexOf("<", at);
  const end = html.indexOf(">", at);
  return html.slice(start, end + 1);
}

function v1(): readonly Question[] {
  const parsed = parseQuestions(NEWCOMER_DAILY_QUESTIONS);
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.questions;
}

/** Every v1 answer empty except the overrides (so show_if chains start from null). */
function v1Answers(overrides: Record<string, string>): Answers {
  const answers: Answers = {};
  for (const q of NEWCOMER_DAILY_QUESTIONS) answers[q.key] = null;
  return { ...answers, ...overrides };
}

describe("FormRenderer: six question types (all-types fixture)", () => {
  const html = render(ALL_TYPES_QUESTIONS);

  it("single_select → radio group with one 44px row per option", () => {
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('id="q-mood"');
    for (const option of ["很好", "普通", "不佳"]) expect(html).toContain(option);
    expect((html.match(/role="radio"/g) ?? []).length).toBe(3);
    // each option row is a <label htmlFor=item> so the whole row is tappable
    expect(html).toContain('for="q-mood-opt-0"');
    const item = tagById(html, "q-mood-opt-0");
    expect(item).toContain('role="radio"');
    const row = html.slice(html.lastIndexOf("<label", html.indexOf('id="q-mood-opt-0"')));
    expect(row).toMatch(/^<label[^>]*for="q-mood-opt-0"/);
    expect(row).toMatch(/^<label[^>]*class="[^"]*min-h-11/);
    // hidden input carries the value into FormData
    expect(html).toContain('type="hidden" name="mood"');
  });

  it("short_text → text input with placeholder", () => {
    const input = tagById(html, "q-headline");
    expect(input).toMatch(/^<input /);
    expect(input).toContain('type="text"');
    expect(input).toContain('name="headline"');
    expect(input).toContain('required=""');
    expect(html).toContain('placeholder="例：今天完成了什麼"');
  });

  it("long_text → <textarea>", () => {
    const textarea = tagById(html, "q-story");
    expect(textarea).toMatch(/^<textarea /);
    expect(textarea).toContain('name="story"');
    expect(html).toContain('placeholder="想到什麼都可以寫"');
  });

  it('date → native <input type="date">', () => {
    const input = tagById(html, "q-when");
    expect(input).toMatch(/^<input /);
    expect(input).toContain('type="date"');
    expect(input).toContain('name="when"');
  });

  it('number → inputmode="numeric"', () => {
    const input = tagById(html, "q-hours");
    expect(input).toMatch(/^<input /);
    expect(input).toMatch(/inputmode="numeric"/i);
    expect(input).toContain('name="hours"');
    expect(input).toContain('aria-describedby="q-hours-help"');
  });

  it("user_select → <select> listing exactly the given userOptions", () => {
    const select = tagById(html, "q-buddy");
    expect(select).toMatch(/^<select /);
    expect(select).toContain('name="buddy"');
    for (const option of ALL_TYPES_USER_OPTIONS) {
      expect(html).toContain(`<option value="${option.id}">${option.display_name}</option>`);
    }
    const body = html.slice(html.indexOf("<select"), html.indexOf("</select>"));
    // placeholder row + the two users, nothing else
    expect((body.match(/<option/g) ?? []).length).toBe(ALL_TYPES_USER_OPTIONS.length + 1);
    expect(body).toMatch(/<option value=""[^>]*>請選擇<\/option>/);
  });

  it("renders required marks, help text and the submit button", () => {
    expect(html).toContain("選一個最接近的");
    expect(html).toContain("以小時計");
    // required questions: mood, headline, when → three marks
    expect((html.match(/aria-hidden="true">\*<\/span>/g) ?? []).length).toBe(3);
    const button = html.slice(html.lastIndexOf("<button"), html.lastIndexOf("</button>") + 9);
    expect(button).toContain('type="submit"');
    expect(button).toContain("data-primary");
    expect(button).toMatch(/>儲存<\/button>$/);
    // nothing is disabled while idle (pending state only)
    expect(html).not.toMatch(/ disabled=""/);
  });

  it("initialAnswers pre-fill the controls (removed user kept as「（已移除）」)", () => {
    const filled = render(ALL_TYPES_QUESTIONS, {
      mood: "普通",
      headline: "完成三件事",
      story: null,
      when: "2026-09-04",
      hours: "8",
      buddy: "99999999-9999-4999-8999-999999999999",
    });
    expect(filled).toContain('type="hidden" name="mood" value="普通"');
    expect(tagById(filled, "q-mood-opt-1")).toContain('data-state="checked"');
    expect(tagById(filled, "q-mood-opt-0")).toContain('data-state="unchecked"');
    expect(filled).toContain('value="完成三件事"');
    expect(filled).toContain('value="2026-09-04"');
    expect(filled).toContain('value="8"');
    expect(filled).toMatch(
      /<option value="99999999-9999-4999-8999-999999999999"[^>]*>（已移除）<\/option>/,
    );
  });
});

describe("FormRenderer: show_if on the §11 newcomer_daily v1 questions", () => {
  const questions = v1();

  it("blocker='沒有' hides blocker_detail; '有，已解決' shows it", () => {
    const none = render(questions, v1Answers({ blocker: "沒有" }));
    expect(none).toContain('id="q-blocker"');
    expect(none).not.toContain('id="q-blocker_detail"');
    expect(none).not.toContain("卡點說明");

    const solved = render(questions, v1Answers({ blocker: "有，已解決" }));
    expect(solved).toContain('id="q-blocker_detail"');
    expect(solved).toContain("卡點說明");
  });

  it("p2_expect appears only once p2_text has text", () => {
    const empty = render(questions, v1Answers({}));
    expect(empty).toContain('id="q-p2_text"');
    expect(empty).not.toContain('id="q-p2_expect"');

    const typed = render(questions, v1Answers({ p2_text: "裕福門窗報價" }));
    expect(typed).toContain('id="q-p2_expect"');
    expect(typed).toContain("明日項目二預計");
  });

  it("r1_reason follows r1_status ∈ {持續中, 取消}", () => {
    expect(render(questions, v1Answers({ r1_status: "完成" }))).not.toContain('id="q-r1_reason"');
    expect(render(questions, v1Answers({ r1_status: "持續中" }))).toContain('id="q-r1_reason"');
  });

  it("beforeQuestion is rendered above the question it targets", () => {
    const html = renderToStaticMarkup(
      <FormRenderer
        questions={questions}
        action={noop}
        submitLabel="儲存"
        beforeQuestion={(q) =>
          q.key === "r1_status" ? <p data-testid="yesterday-1">昨日：跟著博凱跑案場</p> : null
        }
      />,
    );
    const marker = html.indexOf('data-testid="yesterday-1"');
    const label = html.indexOf("昨日項目一狀態");
    expect(marker).toBeGreaterThan(-1);
    expect(marker).toBeLessThan(label);
    expect((html.match(/data-testid="yesterday-1"/g) ?? []).length).toBe(1);
  });
});
