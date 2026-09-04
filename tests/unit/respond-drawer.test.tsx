import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  EDIT_RESPONSE_LABEL,
  NO_ALERTS_HINT,
  ON_BEHALF_BADGE,
  RESPOND_LABEL,
  ResponseDrawer,
} from "@/app/(front)/manager/newcomer/[id]/ResponseDrawer";
import { alertKindLabel } from "@/components/dashboard/AlertBadge";
import {
  buildTimeline,
  Timeline,
  type ResponderLike,
  type TimelineAlertLike,
  type TimelineDay,
  type TimelineLogLike,
  type TimelineResponseLike,
} from "@/components/dashboard/Timeline";
import type { FormActionState } from "@/components/forms/FormRenderer";
import type { Json } from "@/lib/db/types";
import { parseQuestions, type Question } from "@/lib/forms/schema";
import { ownResponseAnswers } from "@/lib/forms/submit";
import { BASE_PROFILES, CLOCK_0904_1800, FIXTURE_MANAGERS, FIXTURE_NEWCOMERS, FORM_TEMPLATES, SETTINGS } from "@seed/fixtures";
import { buildSeedPlan } from "@seed/plan";

/**
 * T18 `ResponseDrawer` and the `/manager/newcomer/[id]` action slot through
 * react-dom/server (initial state of the client hooks, D-25): every timeline
 * day gets one 44px 「回應」 button — with or without alerts (§11 工務主任
 * responds to Darren 9/3 which has none) — the button reads 「修改回應」 when
 * the actor already responded, the sheet body is not in the initial markup
 * (closed), and `readOnly` renders zero buttons (ceo / no active form).
 * `data-primary` is the 44px source (app/globals.css `[data-primary]{min-height:44px}`).
 */

const PLAN = buildSeedPlan();
const noop = async (): Promise<FormActionState> => ({ ok: true });

function parsed(questions: unknown): readonly Question[] {
  const result = parseQuestions(questions);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.questions;
}

const VERSIONS: ReadonlyMap<string, readonly Question[]> = new Map(
  FORM_TEMPLATES.map((t) => [t.v1.id, parsed(t.v1.questions)] as const),
);
const RESPONSE_QUESTIONS = parsed(FORM_TEMPLATES.find((t) => t.key === "manager_response")!.v1.questions);

const logId = (seq: number) => `log-${seq}`;

const LOGS: (TimelineLogLike & { user_id: string; log_date: string })[] = PLAN.logs.map((log) => ({
  id: logId(log.seq),
  user_id: log.user_id,
  log_date: log.log_date,
  submitted_at: log.submitted_at,
  form_version_id: log.form_version_id,
  answers: log.answers as Json,
}));

const ALERTS: (TimelineAlertLike & { user_id: string })[] = PLAN.alerts.map((alert, index) => ({
  id: `alert-${index + 1}`,
  submission_id: logId(alert.log_seq),
  user_id: PLAN.logs.find((l) => l.seq === alert.log_seq)!.user_id,
  rule_key: alert.rule_key,
  detail: alert.detail as Json,
  status: alert.status,
  created_at: alert.created_at,
  responded_at: alert.responded_at,
}));

const RESPONSES: TimelineResponseLike[] = PLAN.responses.map((response) => ({
  id: `resp-${response.seq}`,
  user_id: response.user_id,
  target_submission_id: logId(response.target_log_seq),
  submitted_at: response.submitted_at,
  form_version_id: response.form_version_id,
  answers: response.answers as Json,
}));

const RESPONDERS: ReadonlyMap<string, ResponderLike> = new Map(
  [...FIXTURE_MANAGERS, ...BASE_PROFILES].map((p) => [
    p.id,
    { id: p.id, display_name: p.display_name, role: p.role } satisfies ResponderLike,
  ]),
);

function person(username: string) {
  const found = [...FIXTURE_MANAGERS, ...FIXTURE_NEWCOMERS, ...BASE_PROFILES].find((p) => p.username === username);
  if (!found) throw new Error(`unknown profile ${username}`);
  return found;
}

const MGR_PROCUREMENT = person("mgr_procurement");
const MGR_CONSTRUCTION = person("mgr_construction");
const HR = person("hr");

/** The 9/3 logs of all four newcomers as one timeline (the page renders one newcomer; the builder does not care). */
function daysOf(logDate: string): TimelineDay[] {
  const logs = LOGS.filter((l) => l.log_date === logDate);
  const ids = new Set(logs.map((l) => l.id));
  return buildTimeline({
    logs,
    versions: VERSIONS,
    alerts: ALERTS.filter((a) => ids.has(a.submission_id)),
    responses: RESPONSES.filter((r) => r.target_submission_id !== null && ids.has(r.target_submission_id)),
    responders: RESPONDERS,
    now: CLOCK_0904_1800,
    thresholdHours: SETTINGS.response_threshold_hours,
  });
}

/** What the page's `renderAction` does (page.tsx), with the action stubbed. */
function renderAction(actorId: string, onBehalf = false) {
  return function respondAction(day: TimelineDay) {
    return (
      <ResponseDrawer
        dateLabel={day.dateLabel}
        alerts={day.alerts.map((alert) => ({ id: alert.id, kindLabel: alert.kindLabel }))}
        questions={RESPONSE_QUESTIONS}
        initialAnswers={ownResponseAnswers(RESPONSES, actorId, day.logId)}
        onBehalf={onBehalf}
        action={noop}
      />
    );
  };
}

const countButtons = (html: string) => (html.match(/data-testid="respond-button"/g) ?? []).length;
const textOf = (html: string) => html.replace(/<[^>]+>/g, "");

describe("ResponseDrawer — initial markup", () => {
  it("a day without alerts still gets a data-primary (44px) 「回應」 button; the sheet is closed", () => {
    const html = renderToStaticMarkup(
      <ResponseDrawer
        dateLabel="9/3"
        alerts={[]}
        questions={RESPONSE_QUESTIONS}
        initialAnswers={null}
        onBehalf={false}
        action={noop}
      />,
    );
    expect(countButtons(html)).toBe(1);
    // React serializes the boolean prop as data-primary="true"; the CSS selector is `[data-primary]`.
    expect(html).toMatch(/<button[^>]*data-primary="(true|)"[^>]*data-testid="respond-button"/);
    expect(html).toMatch(/data-testid="respond-button"[^>]*>回應<\/button>/);
    expect(html).not.toContain(EDIT_RESPONSE_LABEL);
    // Closed sheet: the form / hint / title are not rendered yet.
    expect(html).not.toContain(NO_ALERTS_HINT);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("response-sent");
  });

  it("with the actor's existing answers the button reads 「修改回應」", () => {
    const html = renderToStaticMarkup(
      <ResponseDrawer
        dateLabel="9/3"
        alerts={[{ id: "a1", kindLabel: alertKindLabel("R1") }]}
        questions={RESPONSE_QUESTIONS}
        initialAnswers={{ status: "已處理", comment: "已請 Patty 給工項對照表" }}
        onBehalf={false}
        action={noop}
      />,
    );
    expect(countButtons(html)).toBe(1);
    expect(textOf(html)).toContain(EDIT_RESPONSE_LABEL);
    expect(html).not.toMatch(/>回應<\/button>/);
  });

  it("onBehalf only affects the sheet (closed initially): the trigger markup is unchanged", () => {
    const html = renderToStaticMarkup(
      <ResponseDrawer
        dateLabel="9/3"
        alerts={[]}
        questions={RESPONSE_QUESTIONS}
        initialAnswers={null}
        onBehalf
        action={noop}
      />,
    );
    expect(countButtons(html)).toBe(1);
    expect(html).not.toContain(ON_BEHALF_BADGE);
  });
});

describe("Timeline + renderAction — every 9/3 day gets exactly one button (page.tsx wiring)", () => {
  const days = daysOf("2026-09-03");

  it("four 9/3 logs → four buttons, including Darren 9/3 (no alerts) and 謝文心 9/3 (no alerts)", () => {
    expect(days).toHaveLength(4);
    const darren = days.find((d) => d.logId === logId(5))!;
    const hsieh = days.find((d) => d.logId === logId(8))!;
    expect(darren.alerts).toEqual([]);
    expect(hsieh.alerts).toEqual([]);

    const html = renderToStaticMarkup(<Timeline days={days} renderAction={renderAction(HR.id)} />);
    expect(countButtons(html)).toBe(4);
    for (const day of days) {
      const single = renderToStaticMarkup(<Timeline days={[day]} renderAction={renderAction(HR.id)} />);
      expect(countButtons(single)).toBe(1);
      expect(single).toContain(`>${RESPOND_LABEL}</button>`);
    }
  });

  it("採購主管 sees 「修改回應」 on 嚴雅齡 9/3 (own response) but 「回應」 on the others", () => {
    const yen = days.find((d) => d.logId === logId(6))!;
    const darren = days.find((d) => d.logId === logId(5))!;
    const yenHtml = renderToStaticMarkup(<Timeline days={[yen]} renderAction={renderAction(MGR_PROCUREMENT.id)} />);
    expect(textOf(yenHtml)).toContain(EDIT_RESPONSE_LABEL);
    const darrenHtml = renderToStaticMarkup(
      <Timeline days={[darren]} renderAction={renderAction(MGR_PROCUREMENT.id)} />,
    );
    expect(darrenHtml).toContain(`>${RESPOND_LABEL}</button>`);
    // 工務主任 responded to Darren 9/3 (no alerts, §11) → edit mode for him.
    const constructionHtml = renderToStaticMarkup(
      <Timeline days={[darren]} renderAction={renderAction(MGR_CONSTRUCTION.id)} />,
    );
    expect(textOf(constructionHtml)).toContain(EDIT_RESPONSE_LABEL);
  });

  it("readOnly (ceo / no manager_response version) renders zero buttons", () => {
    const html = renderToStaticMarkup(<Timeline days={days} readOnly renderAction={renderAction(HR.id)} />);
    expect(countButtons(html)).toBe(0);
    expect(html).not.toContain(RESPOND_LABEL + "</button>");
  });
});
