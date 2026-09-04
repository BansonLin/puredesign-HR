import { describe, expect, it } from "vitest";

import {
  ERROR_RESPOND_FORBIDDEN,
  ERROR_RESPONSE_VERSION_INVALID,
  ERROR_TARGET_LOG_NOT_FOUND,
  FORM_ERROR_KEY,
  ownResponseAnswers,
  prepareResponse,
  type PrepareResponseInput,
  type ResponseRowLike,
  type ResponseTargetLike,
  type VersionLike,
} from "@/lib/forms/submit";
import type { ExistingAlertLike } from "@/lib/rules/types";
import {
  BASE_PROFILES,
  DEPARTMENTS,
  FIXTURE_MANAGERS,
  FIXTURE_NEWCOMERS,
  FIXTURE_RESPONSES,
  FORM_TEMPLATES,
  YEN_R1_RESPONSE_LAG_MS,
} from "@seed/fixtures";
import { buildSeedPlan } from "@seed/plan";

/**
 * T18 `prepareResponse` (pure) on the §11 fixture: 採購主管 responds to
 * 嚴雅齡 9/3 (open R1 → responded, responded_at = now, ≈16.1h after the
 * alert), 工務主任 responds to Darren 9/3 (no alerts → response still
 * prepared, alert plan empty), HR responds on behalf, 工務主任 is refused on
 * 嚴雅齡, a re-send updates instead of inserting, and responded / closed
 * alerts are never touched. No database: rows are in-memory objects shaped
 * like the tables. Only lib/forms/submit and the fixtures are imported.
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

/** The profile columns the §10 matrix reads (`Actor` / `NewcomerRef`). */
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

const MGR_PROCUREMENT = manager("mgr_procurement");
const MGR_CONSTRUCTION = manager("mgr_construction");
const HR = base("hr");
const ADMIN = base("banson");
const CEO = base("ceo");
const YEN = newcomer("yen_yaling");
const DARREN = newcomer("darren");
const HUNG = newcomer("hung_hsiangting");

const RESPONSE_TEMPLATE = FORM_TEMPLATES.find((t) => t.key === "manager_response")!;
const RESPONSE_V1: VersionLike = { id: RESPONSE_TEMPLATE.v1.id, questions: RESPONSE_TEMPLATE.v1.questions };

const logId = (seq: number) => `log-${seq}`;

/** The daily log of a fixture `seq` as the Server Action loads it (by id). */
function targetLog(seq: number, overrides: Partial<ResponseTargetLike> = {}): ResponseTargetLike {
  const log = PLAN.logs.find((l) => l.seq === seq);
  if (!log) throw new Error(`no planned log seq ${seq}`);
  return { id: logId(seq), template_key: "newcomer_daily", user_id: log.user_id, deleted_at: null, ...overrides };
}

interface AlertRow extends ExistingAlertLike {
  id: string;
  submission_id: string;
  created_at: string;
  responded_at: string | null;
}

/** The alert rows of one log BEFORE any response (the plan's final state reverted to open). */
function openAlertsOf(seq: number): AlertRow[] {
  return PLAN.alerts
    .filter((a) => a.log_seq === seq)
    .map((a, index) => ({
      id: `alert-${seq}-${index + 1}`,
      submission_id: logId(seq),
      rule_key: a.rule_key,
      status: "open" as const,
      detail: a.detail,
      created_at: a.created_at,
      responded_at: null,
    }));
}

const YEN_0903_SEQ = 6;
const DARREN_0903_SEQ = 5;
const HUNG_0903_SEQ = 7;

const YEN_RESPONSE = FIXTURE_RESPONSES.find((r) => r.seq === 9)!;
const DARREN_RESPONSE = FIXTURE_RESPONSES.find((r) => r.seq === 10)!;

/** 9/4 09:10 Taipei — 採購主管's fixture `submitted_at`. */
const T_0904_0910 = new Date("2026-09-04T01:10:00Z");
/** 9/4 09:20 Taipei — 工務主任's fixture `submitted_at`. */
const T_0904_0920 = new Date("2026-09-04T01:20:00Z");

function input(overrides: Partial<PrepareResponseInput<AlertRow>> = {}): PrepareResponseInput<AlertRow> {
  return {
    now: T_0904_0910,
    actor: MGR_PROCUREMENT,
    newcomer: YEN,
    targetLog: targetLog(YEN_0903_SEQ),
    activeVersion: RESPONSE_V1,
    existingResponse: null,
    alerts: openAlertsOf(YEN_0903_SEQ),
    rawAnswers: YEN_RESPONSE.answers,
    ...overrides,
  };
}

function prepared(overrides: Partial<PrepareResponseInput<AlertRow>> = {}) {
  const result = prepareResponse(input(overrides));
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result;
}

describe("prepareResponse — 採購主管 responds to 嚴雅齡 9/3 (open R1)", () => {
  it("plans the open R1 as responded with responded_at = now and the response's own columns", () => {
    const alerts = openAlertsOf(YEN_0903_SEQ);
    expect(alerts.map((a) => a.rule_key)).toEqual(["R1"]);

    const result = prepared({ alerts });

    expect(result.on_behalf).toBe(false);
    expect(result.user_id).toBe(MGR_PROCUREMENT.id);
    expect(result.target_user_id).toBe(YEN.id);
    expect(result.target_submission_id).toBe(logId(YEN_0903_SEQ));
    expect(result.form_version_id).toBe(RESPONSE_V1.id);
    expect(result.answers).toEqual({
      status: "已處理",
      comment: "已請 Patty 給工項對照表；宏偉訂金明早追",
    });
    expect(result.existing_id).toBeNull();
    expect(result.submitted_at).toBe(T_0904_0910.toISOString());
    expect(result.updated_at).toBe(T_0904_0910.toISOString());
    expect(result.responded_at).toBe(T_0904_0910.toISOString());

    expect(result.alertPlan.respond.map((a) => a.id)).toEqual([alerts[0].id]);
    expect(result.alertPlan.untouched).toEqual([]);
  });

  it("responded_at − created_at ≈ 16.1h (not late at the 24h threshold)", () => {
    const result = prepared();
    const r1 = result.alertPlan.respond[0];
    const lag = new Date(result.responded_at).getTime() - new Date(r1.created_at).getTime();
    expect(lag).toBe(YEN_R1_RESPONSE_LAG_MS);
    expect(lag).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it("takes target_user_id from the log, never from the client", () => {
    // The client cannot pass target_user_id at all; the log's owner wins.
    const result = prepared();
    expect(result.target_user_id).toBe(PLAN.logs.find((l) => l.seq === YEN_0903_SEQ)!.user_id);
  });
});

describe("prepareResponse — 工務主任 responds to Darren 9/3 (no alerts)", () => {
  it("still prepares the response and plans zero alert updates", () => {
    expect(openAlertsOf(DARREN_0903_SEQ)).toEqual([]);
    const result = prepared({
      now: T_0904_0920,
      actor: MGR_CONSTRUCTION,
      newcomer: DARREN,
      targetLog: targetLog(DARREN_0903_SEQ),
      alerts: [],
      rawAnswers: DARREN_RESPONSE.answers,
    });
    expect(result.on_behalf).toBe(false);
    expect(result.target_user_id).toBe(DARREN.id);
    expect(result.answers).toEqual({ status: "已讀，無需處理", comment: null });
    expect(result.alertPlan.respond).toEqual([]);
    expect(result.alertPlan.untouched).toEqual([]);
  });
});

describe("prepareResponse — §10 row 4", () => {
  it("hr responds on behalf (on_behalf = true, no extra column)", () => {
    const result = prepared({ actor: HR });
    expect(result.on_behalf).toBe(true);
    expect(result.user_id).toBe(HR.id);
    expect(result.alertPlan.respond).toHaveLength(1);
  });

  it("admin responds on behalf too", () => {
    expect(prepared({ actor: ADMIN }).on_behalf).toBe(true);
  });

  it("工務主任 on 嚴雅齡 (other department) → forbidden", () => {
    const result = prepareResponse(input({ actor: MGR_CONSTRUCTION }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("forbidden");
    expect(result.errors).toEqual({ [FORM_ERROR_KEY]: ERROR_RESPOND_FORBIDDEN });
  });

  it("ceo → forbidden (read-only)", () => {
    const result = prepareResponse(input({ actor: CEO }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("a left newcomer cannot be responded to", () => {
    const result = prepareResponse(input({ newcomer: { ...YEN, status: "left" } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("a left actor is refused", () => {
    const result = prepareResponse(input({ actor: { ...MGR_PROCUREMENT, status: "left" } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });
});

describe("prepareResponse — target log lookup (client target_submission_id is not trusted)", () => {
  function expectTargetError(overrides: Partial<PrepareResponseInput<AlertRow>>) {
    const result = prepareResponse(input(overrides));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("target");
    expect(result.errors).toEqual({ [FORM_ERROR_KEY]: ERROR_TARGET_LOG_NOT_FOUND });
  }

  it("no such log → 找不到要回應的日誌", () => {
    expectTargetError({ targetLog: null });
  });

  it("a log of another newcomer (Darren's) on 嚴雅齡's page → refused", () => {
    expectTargetError({ targetLog: targetLog(DARREN_0903_SEQ), alerts: [] });
  });

  it("a soft-deleted log → refused", () => {
    expectTargetError({ targetLog: targetLog(YEN_0903_SEQ, { deleted_at: "2026-09-04T00:00:00Z" }) });
  });

  it("a non-daily submission (e.g. a response row) → refused", () => {
    expectTargetError({ targetLog: targetLog(YEN_0903_SEQ, { template_key: "manager_response" }) });
  });

  it("permission is checked before the target (other department + missing log → forbidden)", () => {
    const result = prepareResponse(input({ actor: MGR_CONSTRUCTION, targetLog: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });
});

describe("prepareResponse — re-send by the same responder", () => {
  it("updates the existing row (existing_id set) and submitted_at becomes the re-send instant (A04)", () => {
    const existing = { id: "resp-9" };
    const later = new Date("2026-09-04T03:00:00Z");
    const result = prepared({
      now: later,
      existingResponse: existing,
      rawAnswers: { status: "需 HR 協助", comment: "Patty 未回覆，請 HR 協助" },
    });
    expect(result.existing_id).toBe("resp-9");
    // A re-send that turns the status into 需 HR 協助 must enter the A04 7-day
    // window from the re-send, not from the first response's instant.
    expect(result.submitted_at).toBe(later.toISOString());
    expect(result.updated_at).toBe(later.toISOString());
    expect(result.responded_at).toBe(later.toISOString());
    expect(result.answers).toEqual({ status: "需 HR 協助", comment: "Patty 未回覆，請 HR 協助" });
  });

  it("a re-send 8 days later is still inside the 7-day HR window (submitted_at = the re-send)", () => {
    const eightDaysLater = new Date("2026-09-12T01:10:00Z");
    const result = prepared({
      now: eightDaysLater,
      existingResponse: { id: "resp-9" },
      rawAnswers: { status: "需 HR 協助", comment: null },
    });
    expect(result.submitted_at).toBe(eightDaysLater.toISOString());
  });

  it("responded / closed alerts stay untouched; only open ones are planned", () => {
    const [r1] = openAlertsOf(YEN_0903_SEQ);
    const responded: AlertRow = {
      ...r1,
      status: "responded",
      responded_at: T_0904_0910.toISOString(),
    };
    const closed: AlertRow = {
      ...r1,
      id: "alert-closed",
      rule_key: "R2",
      status: "closed",
      detail: { text: "舊卡點" },
    };
    const reopened: AlertRow = { ...r1, id: "alert-open-again", rule_key: "R2", status: "open" };

    const result = prepared({
      now: new Date("2026-09-04T03:00:00Z"),
      existingResponse: { id: "resp-9" },
      alerts: [responded, closed, reopened],
    });
    expect(result.alertPlan.respond.map((a) => a.id)).toEqual(["alert-open-again"]);
    expect(result.alertPlan.untouched.map((a) => a.id)).toEqual([r1.id, "alert-closed"]);
  });

  it("a re-send with nothing open plans zero alert updates", () => {
    const [r1] = openAlertsOf(YEN_0903_SEQ);
    const result = prepared({
      existingResponse: { id: "resp-9" },
      alerts: [{ ...r1, status: "responded", responded_at: T_0904_0910.toISOString() }],
    });
    expect(result.alertPlan.respond).toEqual([]);
    expect(result.alertPlan.untouched).toHaveLength(1);
  });
});

describe("prepareResponse — 洪湘庭 9/3 (open R2) answered 「需 HR 協助」 by 信義總監", () => {
  it("plans R2 as responded; the 需 HR 協助 status is stored in answers for the HR list", () => {
    const result = prepared({
      now: new Date("2026-09-04T02:00:00Z"),
      actor: manager("mgr_xinyi"),
      newcomer: HUNG,
      targetLog: targetLog(HUNG_0903_SEQ),
      alerts: openAlertsOf(HUNG_0903_SEQ),
      rawAnswers: { status: "需 HR 協助", comment: "Luma 授權請 HR 協助採購" },
    });
    expect(result.alertPlan.respond.map((a) => a.rule_key)).toEqual(["R2"]);
    expect(result.answers.status).toBe("需 HR 協助");
  });
});

describe("prepareResponse — validation and version", () => {
  it("missing required status → per-question error, no plan", () => {
    const result = prepareResponse(input({ rawAnswers: { comment: "只有一句話" } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("validation");
    expect(result.errors).toEqual({ status: "此題必填" });
  });

  it("status outside the options → 請從選項中選擇", () => {
    const result = prepareResponse(input({ rawAnswers: { status: "處理中", comment: null } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual({ status: "請從選項中選擇" });
  });

  it("answers are trimmed and empty text becomes null (A11)", () => {
    const result = prepared({ rawAnswers: { status: " 已處理 ", comment: "   " } });
    expect(result.answers).toEqual({ status: "已處理", comment: null });
  });

  it("unparseable active version → 表單設定有誤", () => {
    const result = prepareResponse(input({ activeVersion: { id: "bad", questions: "nope" } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("version");
    expect(result.errors).toEqual({ [FORM_ERROR_KEY]: ERROR_RESPONSE_VERSION_INVALID });
  });
});

describe("ownResponseAnswers — the drawer's edit mode (the actor's own row on a log)", () => {
  const rows: ResponseRowLike[] = PLAN.responses.map((response) => ({
    user_id: response.user_id,
    target_submission_id: logId(response.target_log_seq),
    answers: response.answers,
  }));

  it("採購主管 on 嚴雅齡 9/3 → her fixture answers; other logs / other responders → null", () => {
    expect(ownResponseAnswers(rows, MGR_PROCUREMENT.id, logId(YEN_0903_SEQ))).toEqual({
      status: "已處理",
      comment: "已請 Patty 給工項對照表；宏偉訂金明早追",
    });
    expect(ownResponseAnswers(rows, MGR_PROCUREMENT.id, logId(DARREN_0903_SEQ))).toBeNull();
    expect(ownResponseAnswers(rows, MGR_CONSTRUCTION.id, logId(YEN_0903_SEQ))).toBeNull();
    expect(ownResponseAnswers(rows, HR.id, logId(YEN_0903_SEQ))).toBeNull();
    expect(ownResponseAnswers([], MGR_PROCUREMENT.id, logId(YEN_0903_SEQ))).toBeNull();
  });

  it("工務主任 on Darren 9/3 → status only, comment null (A11)", () => {
    expect(ownResponseAnswers(rows, MGR_CONSTRUCTION.id, logId(DARREN_0903_SEQ))).toEqual({
      status: "已讀，無需處理",
      comment: null,
    });
  });

  it("coerces jsonb: non-string values → null, non-object answers → null, a null target never matches", () => {
    const odd: ResponseRowLike[] = [
      { user_id: "u1", target_submission_id: "log-x", answers: { status: "已處理", comment: 3, extra: null } },
      { user_id: "u1", target_submission_id: "log-y", answers: "not-an-object" },
      { user_id: "u1", target_submission_id: "log-z", answers: ["已處理"] },
      { user_id: "u1", target_submission_id: null, answers: { status: "已處理" } },
    ];
    expect(ownResponseAnswers(odd, "u1", "log-x")).toEqual({ status: "已處理", comment: null, extra: null });
    expect(ownResponseAnswers(odd, "u1", "log-y")).toBeNull();
    expect(ownResponseAnswers(odd, "u1", "log-z")).toBeNull();
    expect(ownResponseAnswers(odd, "u1", "log-w")).toBeNull();
  });
});
