/**
 * Seed script (PLAN 4.9). Run with `pnpm db:seed [flags]`, i.e.
 * `tsx --conditions=react-server --env-file-if-exists=.env.local supabase/seed/seed.ts`.
 * The `react-server` condition makes `server-only` (imported by lib/db/admin.ts)
 * resolve to an empty module under plain Node (PLAN 5.1).
 *
 * Modes / flags
 *   (none)             base + fixture (staging, local stack, CI only; refuses NODE_ENV=production)
 *   --base             departments, settings, three form templates v1, banson/hr/ceo (production too)
 *   --verify           run the seed twice and compare row counts (with each other and with
 *                      EXPECTED_ROW_COUNTS); any difference exits 1
 *   --anchor <date>    shift fixture dates so that "9/3" becomes <date> (PLAN 4.9.6; refused when CI=true)
 *   --milestones-only  add missing D30/D60/D90 rows for every newcomer with a start_date (PLAN 4.7)
 *   --reset-passwords  reset every seed account's password to SEED_PASSWORD (default: leave existing)
 *
 * Guards: SEED_PASSWORD must be set in every mode (--milestones-only included,
 * PLAN T04); the project ref of NEXT_PUBLIC_SUPABASE_URL must equal
 * SEED_ALLOWED_PROJECT_REF (`local` for the supabase CLI stack).
 *
 * Idempotency (PLAN 4.9.2): fixed UUIDs + upsert; nothing is ever deleted.
 * A departments.name / profiles.username / form_templates.key that already
 * exists under a different id (created by hand) aborts the run instead of
 * being overwritten.
 * form_templates / form_versions are inserted only when missing so that a
 * later v2 published from /admin/forms is never reverted (see DECISIONS).
 *
 * Submissions (T16, PLAN 4.9.2 / 4.9.4): the §11 rows come from the pure
 * plan in ./plan.ts (`buildSeedPlan`, which also applies `--anchor`). Daily
 * logs go through the SAME pipeline as /me/today — `prepareDailyLog` →
 * `insertDailyLog` / `updateDailyLog` (natural-key select first, never
 * supabase-js `upsert`: the partial unique index cannot be an ON CONFLICT
 * target) → `applyAlertChanges(now = submitted_at)`. Manager responses and
 * the weekly feedback are looked up by their natural keys the same way; a
 * response flips the target log's open alerts to `responded`. Afterwards the
 * alerts in the database are compared with the plan and any difference
 * exits 1 (seed and rules never diverge).
 */
import { getAdminClient, type AdminClient } from "@/lib/db/admin";
import { applyAlertChanges, listAlertsForSubmission } from "@/lib/db/queries/alerts";
import { getVersionById } from "@/lib/db/queries/forms";
import { getSettings } from "@/lib/db/queries/settings";
import {
  getLogByDate,
  getPreviousLog,
  insertDailyLog,
  updateDailyLog,
} from "@/lib/db/queries/submissions";
import type { Database, Json, TablesInsert } from "@/lib/db/types";
import { prepareDailyLog } from "@/lib/forms/submit";
import { detailEquals } from "@/lib/rules/run";
import { parseRulesSettings } from "@/lib/rules/settings";
import { addDaysTo, calendarDaysBetween, toInstant, type DateString } from "@/lib/time";
import { MILESTONE_KINDS, milestonesFor } from "@/lib/time/milestones";

import {
  AUTH_EMAIL_DOMAIN,
  BASE_PROFILES,
  DEPARTMENTS,
  E2E_FRESH_PROFILE,
  EXPECTED_ROW_COUNTS,
  FIXTURE_ANCHOR_DATE,
  FIXTURE_PROFILES,
  FORM_TEMPLATES,
  SETTINGS,
  V1_CHANGE_NOTE,
  V1_PUBLISHED_AT,
  type SeedProfile,
  type SettingKey,
} from "./fixtures";
import { buildSeedPlan, type PlannedAlert, type SeedPlan } from "./plan";

type Mode = "base" | "full" | "milestones-only";

interface Options {
  mode: Mode;
  verify: boolean;
  anchor: DateString | null;
  resetPasswords: boolean;
}

/** Tables this script writes; `--verify` counts exactly these. */
const SEEDED_TABLES = [
  "departments",
  "settings",
  "form_templates",
  "form_versions",
  "profiles",
  "milestones",
  "submissions",
  "alerts",
] as const;
type SeededTable = (typeof SEEDED_TABLES)[number];
type TableName = keyof Database["public"]["Tables"];

const USAGE = `用法：pnpm db:seed [--base] [--verify] [--anchor YYYY-MM-DD] [--milestones-only] [--reset-passwords]
  （無旗標）         base＋fixture：四主管、四新人、e2e_fresh、milestones（只准 staging／本機／CI）
  --base             只跑 base：departments、settings、三範本 v1、banson／hr／ceo（production 也跑）
  --verify           連跑兩次並比對各表筆數，不同即 exit 1
  --anchor <date>    把 fixture 的 9/3 平移到 <date>：start_date、milestones、log_date、submitted_at 等距平移，
                     week_start 以 weekStartMonday 重算（只准 staging／本機；CI=true 時拒絕）
  --milestones-only  為所有有到職日的新人補齊缺少的 D30／D60／D90
  --reset-passwords  把所有 seed 帳號密碼重設為 SEED_PASSWORD`;

function abort(message: string): never {
  console.error(`seed 中止：${message}`);
  process.exit(1);
}

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = { mode: "full", verify: false, anchor: null, resetPasswords: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--base") {
      opts.mode = "base";
    } else if (arg === "--milestones-only") {
      opts.mode = "milestones-only";
    } else if (arg === "--verify") {
      opts.verify = true;
    } else if (arg === "--reset-passwords") {
      opts.resetPasswords = true;
    } else if (arg === "--anchor" || arg.startsWith("--anchor=")) {
      const value = arg === "--anchor" ? argv[(i += 1)] : arg.slice("--anchor=".length);
      if (!value) abort("--anchor 需要日期（YYYY-MM-DD）");
      opts.anchor = value;
    } else {
      console.error(USAGE);
      abort(`不認識的參數：${arg}`);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// guards
// ---------------------------------------------------------------------------

function requireSeedPassword(): string {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.trim() === "") {
    abort("SEED_PASSWORD 未設定。請在 .env.local（或 CI secret）提供 seed 帳號密碼後重跑（PLAN A03）");
  }
  return password;
}

/** `https://<ref>.supabase.co` → `<ref>`; localhost / 127.0.0.1 → `local`; otherwise the hostname. */
function projectRefOf(supabaseUrl: string): string {
  const { hostname } = new URL(supabaseUrl);
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "host.docker.internal" ||
    hostname.endsWith(".localhost")
  ) {
    return "local";
  }
  const match = /^([a-z0-9-]+)\.supabase\.co$/i.exec(hostname);
  return match ? match[1] : hostname;
}

function requireAllowedProject(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) abort("NEXT_PUBLIC_SUPABASE_URL 未設定（見 .env.example）");
  const allowed = process.env.SEED_ALLOWED_PROJECT_REF?.trim();
  if (!allowed) abort("SEED_ALLOWED_PROJECT_REF 未設定（本機堆疊填 local；staging 填該專案 ref）");
  let ref: string;
  try {
    ref = projectRefOf(url);
  } catch {
    return abort(`NEXT_PUBLIC_SUPABASE_URL 不是合法網址：${url}`);
  }
  if (ref !== allowed) {
    abort(`拒絕對專案「${ref}」執行：SEED_ALLOWED_PROJECT_REF=${allowed}。確認 .env.local 指向正確專案`);
  }
  return ref;
}

function isCI(): boolean {
  const ci = process.env.CI?.trim().toLowerCase();
  return ci === "true" || ci === "1";
}

function parseAnchor(anchor: string): number {
  try {
    return calendarDaysBetween(FIXTURE_ANCHOR_DATE, anchor);
  } catch {
    return abort(`--anchor 日期格式錯誤（需 YYYY-MM-DD）：${anchor}`);
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function emailOf(username: string): string {
  return `${username}@${AUTH_EMAIL_DOMAIN}`;
}

function log(line: string): void {
  console.log(`seed  ${line}`);
}

// ---------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------

async function seedSettings(client: AdminClient): Promise<void> {
  const rows: TablesInsert<"settings">[] = (Object.keys(SETTINGS) as SettingKey[]).map((key) => ({
    key,
    value: toJson(SETTINGS[key]),
  }));
  await client.from("settings").upsert(rows, { onConflict: "key" }).throwOnError();
  log(`settings：upsert ${rows.length} 筆（${rows.map((r) => r.key).join("、")}）`);
}

async function seedDepartments(client: AdminClient): Promise<Map<string, string>> {
  // PLAN 4.9.2: a hand-made row that collides on the natural key aborts the run.
  const { data: byName } = await client
    .from("departments")
    .select("id, name")
    .in(
      "name",
      DEPARTMENTS.map((d) => d.name),
    )
    .throwOnError();
  for (const row of byName) {
    const seed = DEPARTMENTS.find((d) => d.name === row.name);
    if (seed && row.id !== seed.id) {
      abort(
        `departments.name=${row.name} 已存在但 id 為 ${row.id}（非 seed 建立）。請人工處理後重跑`,
      );
    }
  }
  const rows: TablesInsert<"departments">[] = DEPARTMENTS.map((d) => ({ ...d }));
  await client.from("departments").upsert(rows, { onConflict: "id" }).throwOnError();
  log(`departments：upsert ${rows.length} 筆`);
  return new Map(DEPARTMENTS.map((d) => [d.name, d.id]));
}

function isNotFound(error: { status?: number; code?: string }): boolean {
  return error.status === 404 || error.code === "user_not_found";
}

/**
 * PLAN 4.9.3: getUserById(fixed id) → exists: leave the password alone
 * (unless --reset-passwords; e2e_fresh is always reset) → missing:
 * createUser with the fixed id. Same e-mail under a different id → abort.
 */
async function ensureAuthUser(
  client: AdminClient,
  profile: SeedProfile,
  password: string,
  resetPasswords: boolean,
): Promise<"created" | "kept" | "password-reset"> {
  const email = emailOf(profile.username);
  const found = await client.auth.admin.getUserById(profile.id);
  if (found.error && !isNotFound(found.error)) {
    abort(`auth.admin.getUserById(${profile.username}) 失敗：${found.error.message}`);
  }
  const existing = found.data?.user ?? null;
  if (existing) {
    if ((existing.email ?? "").toLowerCase() !== email) {
      abort(
        `auth user ${profile.id} 的 email 是 ${existing.email ?? "(空)"}，不是 ${email}。請在 Supabase Auth 後台處理後重跑`,
      );
    }
    const mustReset = resetPasswords || profile.username === E2E_FRESH_PROFILE.username;
    if (!mustReset) return "kept";
    const updated = await client.auth.admin.updateUserById(profile.id, {
      password,
      email_confirm: true,
    });
    if (updated.error) {
      abort(`auth.admin.updateUserById(${profile.username}) 失敗：${updated.error.message}`);
    }
    return "password-reset";
  }
  const created = await client.auth.admin.createUser({
    id: profile.id,
    email,
    password,
    email_confirm: true,
  });
  if (created.error) {
    abort(
      `auth.admin.createUser(${profile.username}) 失敗：${created.error.message}。` +
        `若 ${email} 已存在但 id 不是 ${profile.id}，請在 Supabase Auth 後台刪除該使用者（或改用其 id）後重跑`,
    );
  }
  return "created";
}

async function seedProfiles(
  client: AdminClient,
  profiles: readonly SeedProfile[],
  departmentIds: Map<string, string>,
  ctx: { password: string; resetPasswords: boolean; shiftDays: number },
): Promise<void> {
  const idByUsername = new Map<string, string>(
    [...BASE_PROFILES, ...FIXTURE_PROFILES].map((p) => [p.username, p.id]),
  );
  // PLAN 4.9.2: a hand-made row that collides on the natural key aborts the run
  // (checked before any auth user is created).
  const { data: byUsername } = await client
    .from("profiles")
    .select("id, username")
    .in(
      "username",
      profiles.map((p) => p.username),
    )
    .throwOnError();
  for (const row of byUsername) {
    const seed = profiles.find((p) => p.username === row.username);
    if (seed && row.id !== seed.id) {
      abort(
        `profiles.username=${row.username} 已存在但 id 為 ${row.id}（非 seed 建立）。請人工處理後重跑`,
      );
    }
  }
  const tally = { created: 0, kept: 0, "password-reset": 0 };
  for (const profile of profiles) {
    tally[await ensureAuthUser(client, profile, ctx.password, ctx.resetPasswords)] += 1;

    const departmentId = profile.department ? departmentIds.get(profile.department) : null;
    if (profile.department && !departmentId) {
      abort(`部門「${profile.department}」不存在（${profile.username}）`);
    }
    const managerId = profile.manager_username
      ? idByUsername.get(profile.manager_username)
      : null;
    if (profile.manager_username && !managerId) {
      abort(`主管「${profile.manager_username}」不存在（${profile.username}）`);
    }
    const row: TablesInsert<"profiles"> = {
      id: profile.id,
      username: profile.username,
      display_name: profile.display_name,
      role: profile.role,
      department_id: departmentId ?? null,
      manager_id: managerId ?? null,
      start_date: profile.start_date ? addDaysTo(profile.start_date, ctx.shiftDays) : null,
      status: profile.status,
      must_change_password: profile.must_change_password,
    };
    await client.from("profiles").upsert(row, { onConflict: "id" }).throwOnError();
  }
  log(
    `profiles：upsert ${profiles.length} 筆（auth 新建 ${tally.created}、沿用 ${tally.kept}、重設密碼 ${tally["password-reset"]}）`,
  );
}

async function seedForms(client: AdminClient): Promise<void> {
  let templatesInserted = 0;
  let versionsInserted = 0;
  let activated = 0;
  for (const template of FORM_TEMPLATES) {
    const { data: existing } = await client
      .from("form_templates")
      .select("id, key, active_version_id")
      .eq("id", template.id)
      .maybeSingle()
      .throwOnError();
    if (existing && existing.key !== template.key) {
      abort(`form_templates ${template.id} 的 key 是 ${existing.key}，不是 ${template.key}`);
    }
    if (!existing) {
      const { data: byKey } = await client
        .from("form_templates")
        .select("id")
        .eq("key", template.key)
        .maybeSingle()
        .throwOnError();
      if (byKey) {
        abort(
          `form_templates.key=${template.key} 已存在但 id 為 ${byKey.id}（非 seed 建立）。請人工處理後重跑`,
        );
      }
      const row: TablesInsert<"form_templates"> = {
        id: template.id,
        key: template.key,
        name: template.name,
        description: template.description,
        target_role: template.target_role,
      };
      await client.from("form_templates").insert(row).throwOnError();
      templatesInserted += 1;
    }

    const { data: version } = await client
      .from("form_versions")
      .select("id")
      .eq("id", template.v1.id)
      .maybeSingle()
      .throwOnError();
    if (!version) {
      const row: TablesInsert<"form_versions"> = {
        id: template.v1.id,
        template_id: template.id,
        version_no: template.v1.version_no,
        status: "published",
        questions: toJson(template.v1.questions),
        change_note: V1_CHANGE_NOTE,
        published_at: V1_PUBLISHED_AT,
        published_by: null,
      };
      await client.from("form_versions").insert(row).throwOnError();
      versionsInserted += 1;
    }

    if (!existing?.active_version_id) {
      await client
        .from("form_templates")
        .update({ active_version_id: template.v1.id })
        .eq("id", template.id)
        .throwOnError();
      activated += 1;
    }
  }
  log(
    `forms：templates 新增 ${templatesInserted}、versions 新增 ${versionsInserted}、active_version_id 設定 ${activated}（既有列不動）`,
  );
}

async function seedMilestones(
  client: AdminClient,
  newcomers: readonly SeedProfile[],
  shiftDays: number,
): Promise<void> {
  const rows: TablesInsert<"milestones">[] = [];
  for (const profile of newcomers) {
    if (!profile.start_date) continue;
    const startDate = addDaysTo(profile.start_date, shiftDays);
    for (const m of milestonesFor(startDate)) {
      rows.push({ user_id: profile.id, kind: m.kind, due_date: m.due_date });
    }
  }
  if (rows.length === 0) return;
  await client.from("milestones").upsert(rows, { onConflict: "user_id,kind" }).throwOnError();
  log(`milestones：upsert ${rows.length} 筆`);
}

/** PLAN 4.7 safety net: add the missing kinds for every newcomer with a start_date; existing rows untouched. */
async function addMissingMilestones(client: AdminClient): Promise<void> {
  const { data: newcomers } = await client
    .from("profiles")
    .select("id, username, start_date")
    .eq("role", "newcomer")
    .not("start_date", "is", null)
    .throwOnError();
  const ids = newcomers.map((p) => p.id);
  const { data: existing } =
    ids.length === 0
      ? { data: [] }
      : await client.from("milestones").select("user_id, kind").in("user_id", ids).throwOnError();
  const have = new Set(existing.map((m) => `${m.user_id}:${m.kind}`));
  const rows: TablesInsert<"milestones">[] = [];
  for (const p of newcomers) {
    if (!p.start_date) continue;
    for (const m of milestonesFor(p.start_date)) {
      if (!have.has(`${p.id}:${m.kind}`)) {
        rows.push({ user_id: p.id, kind: m.kind, due_date: m.due_date });
      }
    }
  }
  if (rows.length > 0) {
    await client.from("milestones").insert(rows).throwOnError();
  }
  log(
    `milestones-only：新人 ${newcomers.length} 位（有到職日），補齊 ${rows.length} 筆（${MILESTONE_KINDS.join("/")}）`,
  );
}

// ---------------------------------------------------------------------------
// submissions (T16; PLAN 4.9.2 / 4.9.4)
// ---------------------------------------------------------------------------

/** seq → submissions.id, filled as rows are written. */
type SubmissionIds = Map<number, string>;

/**
 * The 8 §11 daily logs, in log_date order, through the /me/today pipeline:
 * natural-key lookup (`getLogByDate`) → `prepareDailyLog(now = submitted_at)`
 * with the previous non-deleted log from the database → insert / update by
 * id → `applyAlertChanges`. A re-run finds the row, reconciles against its
 * existing alerts (untouched when nothing changed) and rewrites identical
 * values, so nothing moves (the updated_at trigger only fires on a change).
 * `form_version_id` is always newcomer_daily v1 (the fixture answers use v1
 * keys), even when staging has a newer active version.
 */
async function seedDailyLogs(plan: SeedPlan): Promise<SubmissionIds> {
  const dailyTemplate = FORM_TEMPLATES.find((t) => t.key === "newcomer_daily");
  if (!dailyTemplate) abort("fixture 缺 newcomer_daily 範本");
  const v1 = await getVersionById(dailyTemplate.v1.id);
  if (!v1) abort(`form_versions 缺 newcomer_daily v1（${dailyTemplate.v1.id}）；請先跑 --base`);
  const settings = parseRulesSettings((await getSettings()).rules);

  const ids: SubmissionIds = new Map();
  const tally = { inserted: 0, updated: 0, alerts: { inserted: 0, updated: 0, closed: 0, reopened: 0 } };
  for (const log of plan.logs) {
    const existing = await getLogByDate(log.user_id, log.log_date);
    const existingAlerts = existing ? await listAlertsForSubmission(existing.id) : [];
    const previousLog = await getPreviousLog(log.user_id, log.log_date);
    const previousVersion = previousLog ? await getVersionById(previousLog.form_version_id) : null;

    const prepared = prepareDailyLog({
      now: log.submitted_at,
      actor: { id: log.user_id },
      activeVersion: v1,
      existingToday: existing ? { ...existing, alerts: existingAlerts } : null,
      previousLog,
      previousVersion,
      rawAnswers: log.answers,
      settings,
    });
    if (!prepared.ok) {
      abort(
        `日誌 seq ${log.seq}（${log.username} ${log.log_date}）未通過 prepareDailyLog：${JSON.stringify(prepared.errors)}`,
      );
    }
    if (prepared.log_date !== log.log_date) {
      abort(`日誌 seq ${log.seq} 的 log_date 應為 ${log.log_date}，pipeline 算出 ${prepared.log_date}`);
    }

    const saved = prepared.existing_id
      ? await updateDailyLog(prepared.existing_id, {
          form_version_id: prepared.form_version_id,
          answers: prepared.answers,
          updated_at: prepared.updated_at,
        })
      : await insertDailyLog({
          user_id: prepared.user_id,
          form_version_id: prepared.form_version_id,
          log_date: prepared.log_date,
          answers: prepared.answers,
          submitted_at: prepared.submitted_at,
          updated_at: prepared.submitted_at,
        });
    if (prepared.existing_id) tally.updated += 1;
    else tally.inserted += 1;

    const applied = await applyAlertChanges(prepared.alertPlan, {
      submissionId: saved.id,
      userId: saved.user_id,
    });
    tally.alerts.inserted += applied.inserted;
    tally.alerts.updated += applied.updated;
    tally.alerts.closed += applied.closed;
    tally.alerts.reopened += applied.reopened;
    ids.set(log.seq, saved.id);
  }
  log(
    `submissions（newcomer_daily）：新增 ${tally.inserted}、既有 ${tally.updated}；alerts 新增 ${tally.alerts.inserted}、改 detail ${tally.alerts.updated}、關閉 ${tally.alerts.closed}、重開 ${tally.alerts.reopened}`,
  );
  return ids;
}

/**
 * The 2 §11 manager responses. Natural key (PLAN 4.9.2):
 * (template_key='manager_response', user_id, target_submission_id), non-deleted.
 * After the row is written, the target log's `open` alerts become
 * `responded` (responded_at = the response's submitted_at,
 * response_submission_id = the row). Already-responded / closed alerts are
 * not touched, so a re-run is a no-op. (T18 adds the app's own
 * open→responded query in lib/db/queries/alerts.ts; the seed writes the same
 * three columns directly.)
 */
async function seedResponses(
  client: AdminClient,
  plan: SeedPlan,
  logIds: SubmissionIds,
): Promise<SubmissionIds> {
  const ids: SubmissionIds = new Map();
  let inserted = 0;
  let updated = 0;
  let responded = 0;
  for (const response of plan.responses) {
    const targetId = logIds.get(response.target_log_seq);
    if (!targetId) abort(`回應 seq ${response.seq} 的對象日誌 seq ${response.target_log_seq} 尚未寫入`);

    const { data: existing } = await client
      .from("submissions")
      .select("id")
      .eq("template_key", "manager_response")
      .eq("user_id", response.user_id)
      .eq("target_submission_id", targetId)
      .is("deleted_at", null)
      .order("submitted_at", { ascending: true })
      .throwOnError();
    if (existing.length > 1) {
      abort(
        `回應 seq ${response.seq}：同一主管對同一日誌已有 ${existing.length} 筆回應（非 seed 建立）。請人工處理後重跑`,
      );
    }

    let id: string;
    if (existing.length === 1) {
      id = existing[0].id;
      await client
        .from("submissions")
        .update({
          form_version_id: response.form_version_id,
          answers: toJson(response.answers),
          submitted_at: response.submitted_at,
          updated_at: response.submitted_at,
        })
        .eq("id", id)
        .throwOnError();
      updated += 1;
    } else {
      const row: TablesInsert<"submissions"> = {
        template_key: "manager_response",
        form_version_id: response.form_version_id,
        user_id: response.user_id,
        target_user_id: response.target_user_id,
        target_submission_id: targetId,
        answers: toJson(response.answers),
        source: "app",
        submitted_at: response.submitted_at,
        updated_at: response.submitted_at,
      };
      const { data } = await client
        .from("submissions")
        .insert(row)
        .select("id")
        .single()
        .throwOnError();
      id = data.id;
      inserted += 1;
    }
    ids.set(response.seq, id);

    const { data: flipped } = await client
      .from("alerts")
      .update({
        status: "responded",
        responded_at: response.submitted_at,
        response_submission_id: id,
      })
      .eq("submission_id", targetId)
      .eq("status", "open")
      .select("id")
      .throwOnError();
    responded += flipped.length;
  }
  log(`submissions（manager_response）：新增 ${inserted}、既有 ${updated}；alerts open→responded ${responded}`);
  return ids;
}

/**
 * The 1 §11 weekly feedback. Natural key (§5 partial unique index):
 * (template_key='weekly_feedback', user_id, target_user_id, week_start), non-deleted.
 */
async function seedWeeklyFeedback(client: AdminClient, plan: SeedPlan): Promise<SubmissionIds> {
  const ids: SubmissionIds = new Map();
  let inserted = 0;
  let updated = 0;
  for (const weekly of plan.weekly) {
    const { data: existing } = await client
      .from("submissions")
      .select("id")
      .eq("template_key", "weekly_feedback")
      .eq("user_id", weekly.user_id)
      .eq("target_user_id", weekly.target_user_id)
      .eq("week_start", weekly.week_start)
      .is("deleted_at", null)
      .maybeSingle()
      .throwOnError();

    if (existing) {
      await client
        .from("submissions")
        .update({
          form_version_id: weekly.form_version_id,
          answers: toJson(weekly.answers),
          submitted_at: weekly.submitted_at,
          updated_at: weekly.submitted_at,
        })
        .eq("id", existing.id)
        .throwOnError();
      ids.set(weekly.seq, existing.id);
      updated += 1;
    } else {
      const row: TablesInsert<"submissions"> = {
        template_key: "weekly_feedback",
        form_version_id: weekly.form_version_id,
        user_id: weekly.user_id,
        target_user_id: weekly.target_user_id,
        week_start: weekly.week_start,
        answers: toJson(weekly.answers),
        source: "app",
        submitted_at: weekly.submitted_at,
        updated_at: weekly.submitted_at,
      };
      const { data } = await client
        .from("submissions")
        .insert(row)
        .select("id")
        .single()
        .throwOnError();
      ids.set(weekly.seq, data.id);
      inserted += 1;
    }
  }
  log(`submissions（weekly_feedback）：新增 ${inserted}、既有 ${updated}`);
  return ids;
}

function isoOf(value: string | null): string | null {
  return value === null ? null : toInstant(value).toISOString();
}

/**
 * Compare the alerts the database holds for the fixture logs with the plan
 * (rule_key, status, created_at, responded_at, response_submission_id,
 * detail). Every difference is one problem line; the caller aborts on any.
 */
async function verifyAlerts(
  plan: SeedPlan,
  logIds: SubmissionIds,
  responseIds: SubmissionIds,
): Promise<{ problems: string[]; summary: string[] }> {
  const problems: string[] = [];
  const summary: string[] = [];
  const describe = (a: PlannedAlert) => `${a.username} ${a.rule_key}（日誌 seq ${a.log_seq}）`;

  for (const planned of plan.logs) {
    const id = logIds.get(planned.seq);
    if (!id) {
      problems.push(`日誌 seq ${planned.seq} 沒有寫入`);
      continue;
    }
    const actual = await listAlertsForSubmission(id);
    const expected = plan.alerts.filter((a) => a.log_seq === planned.seq);
    if (actual.length !== expected.length) {
      problems.push(
        `日誌 seq ${planned.seq}（${planned.username} ${planned.log_date}）：alerts 實際 ${actual.length} 筆、預期 ${expected.length} 筆（${actual.map((a) => `${a.rule_key}:${a.status}`).join("、") || "無"}）`,
      );
    }
    for (const exp of expected) {
      const row = actual.find((a) => a.rule_key === exp.rule_key);
      if (!row) {
        problems.push(`${describe(exp)}：資料庫沒有這筆 alert`);
        continue;
      }
      const expectedResponseId = exp.response_seq === null ? null : (responseIds.get(exp.response_seq) ?? null);
      const diffs: string[] = [];
      if (row.status !== exp.status) diffs.push(`status ${row.status}≠${exp.status}`);
      if (isoOf(row.created_at) !== exp.created_at) diffs.push(`created_at ${row.created_at}≠${exp.created_at}`);
      if (isoOf(row.responded_at) !== exp.responded_at) {
        diffs.push(`responded_at ${row.responded_at}≠${exp.responded_at}`);
      }
      if (row.response_submission_id !== expectedResponseId) {
        diffs.push(`response_submission_id ${row.response_submission_id}≠${expectedResponseId}`);
      }
      if (!detailEquals(row.detail, exp.detail)) {
        diffs.push(`detail ${JSON.stringify(row.detail)}≠${JSON.stringify(exp.detail)}`);
      }
      if (diffs.length > 0) problems.push(`${describe(exp)}：${diffs.join("；")}`);
      else summary.push(`${describe(exp)} ${row.status}`);
    }
  }
  return { problems, summary };
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

type Counts = Record<SeededTable, number>;

async function countRows(client: AdminClient): Promise<Counts> {
  const counts = {} as Counts;
  for (const table of SEEDED_TABLES) {
    const { count } = await client
      .from(table as TableName)
      .select("*", { count: "exact", head: true })
      .throwOnError();
    counts[table] = count ?? 0;
  }
  return counts;
}

async function checkInvariants(client: AdminClient, mode: Mode): Promise<string[]> {
  const problems: string[] = [];
  const { data: templates } = await client
    .from("form_templates")
    .select("key, active_version_id")
    .throwOnError();
  for (const t of FORM_TEMPLATES) {
    const row = templates.find((x) => x.key === t.key);
    if (!row) problems.push(`form_templates 缺 ${t.key}`);
    else if (row.active_version_id !== t.v1.id) {
      problems.push(`form_templates.${t.key}.active_version_id ≠ v1（${row.active_version_id}）`);
    }
  }
  if (mode === "full") {
    const { data: fresh } = await client
      .from("profiles")
      .select("status, must_change_password")
      .eq("id", E2E_FRESH_PROFILE.id)
      .maybeSingle()
      .throwOnError();
    if (!fresh) problems.push("profiles 缺 e2e_fresh");
    else if (fresh.status !== "sample" || fresh.must_change_password !== true) {
      problems.push(
        `e2e_fresh 應為 status=sample、must_change_password=true，實際 ${fresh.status}/${fresh.must_change_password}`,
      );
    }
  }
  return problems;
}

function verifyCounts(first: Counts, second: Counts, mode: "base" | "full"): string[] {
  const expected = EXPECTED_ROW_COUNTS[mode];
  const problems: string[] = [];
  for (const table of SEEDED_TABLES) {
    if (first[table] !== second[table]) {
      problems.push(`${table}：第一次 ${first[table]}、第二次 ${second[table]}（不 idempotent）`);
    }
    if (second[table] !== expected[table]) {
      problems.push(`${table}：實際 ${second[table]}、預期 ${expected[table]}`);
    }
  }
  return problems;
}

function printCounts(label: string, counts: Counts): void {
  log(`${label}：` + SEEDED_TABLES.map((t) => `${t}=${counts[t]}`).join("  "));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function runSeed(client: AdminClient, opts: Options, password: string, shiftDays: number) {
  await seedSettings(client);
  const departmentIds = await seedDepartments(client);
  const ctx = { password, resetPasswords: opts.resetPasswords, shiftDays };
  await seedProfiles(client, BASE_PROFILES, departmentIds, ctx);
  await seedForms(client);
  if (opts.mode === "full") {
    await seedProfiles(client, FIXTURE_PROFILES, departmentIds, ctx);
    await seedMilestones(client, FIXTURE_PROFILES, shiftDays);
    // PLAN 4.9.2 order: submissions (by log_date) → alerts → responses → weekly.
    const plan = buildSeedPlan({ shiftDays });
    const logIds = await seedDailyLogs(plan);
    const responseIds = await seedResponses(client, plan, logIds);
    await seedWeeklyFeedback(client, plan);
    const { problems, summary } = await verifyAlerts(plan, logIds, responseIds);
    if (problems.length > 0) {
      for (const p of problems) console.error(`  ✗ ${p}`);
      abort(`alerts 與 EXPECTED_ALERTS 不符（${problems.length} 項）：seed 與規則分岐，請先修規則或 fixture`);
    }
    log(`alerts 與預期一致：${summary.join("、")}`);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const password = requireSeedPassword();
  const ref = requireAllowedProject();
  if (opts.mode === "full" && process.env.NODE_ENV === "production") {
    abort("完整模式（含 fixture）拒絕在 NODE_ENV=production 執行；production 只准 --base");
  }
  if (opts.anchor !== null && opts.mode !== "full") {
    abort("--anchor 只能與完整模式（無 --base／--milestones-only）並用");
  }
  if (opts.anchor !== null && isCI()) {
    abort("--anchor 在 CI=true 時拒絕執行（CI 永遠用固定日期，PLAN 4.9.6）");
  }
  const shiftDays = opts.anchor === null ? 0 : parseAnchor(opts.anchor);

  const client = getAdminClient();
  log(`專案 ref=${ref}，模式=${opts.mode}${opts.verify ? "，verify" : ""}${
    opts.anchor ? `，anchor=${opts.anchor}（平移 ${shiftDays} 天）` : ""
  }`);

  if (opts.mode === "milestones-only") {
    await addMissingMilestones(client);
    log("完成");
    return;
  }

  await runSeed(client, opts, password, shiftDays);
  if (!opts.verify) {
    log("完成");
    return;
  }

  const first = await countRows(client);
  printCounts("第一次筆數", first);
  log("verify：再跑一次…");
  await runSeed(client, opts, password, shiftDays);
  const second = await countRows(client);
  printCounts("第二次筆數", second);
  const problems = [
    ...verifyCounts(first, second, opts.mode),
    ...(await checkInvariants(client, opts.mode)),
  ];
  if (problems.length > 0) {
    for (const p of problems) console.error(`  ✗ ${p}`);
    abort(`verify 失敗（${problems.length} 項）`);
  }
  log("verify 通過：兩次筆數相同且等於預期");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  abort(message);
});
