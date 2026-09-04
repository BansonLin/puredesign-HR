/**
 * Per-newcomer CSV export (CLAUDE.md §8 /hr/newcomer/[id]「匯出該員 CSV」,
 * PLAN T25). Pure module: rows in, text out, no `lib/db/admin`, no clock and
 * no `server-only`, so `tests/unit/csv.test.ts` can import it directly.
 *
 * Format (PLAN T25): UTF-8 BOM + CRLF line endings, `text/csv; charset=utf-8`,
 * `Content-Disposition: attachment; filename={username}-daily.csv`. A cell is
 * quoted only when it contains a comma, a double quote or a line break; the
 * quote inside is doubled; `null` becomes an empty cell. A cell whose text
 * would be read as a formula by Excel / Numbers is prefixed with a single
 * quote first (`csvCell`, D-49); `unescapeCsvFormulaGuard` reverses that for
 * the Phase 2 CSV import.
 *
 * Columns:
 *   `log_date`, `submitted_at` (Taipei),
 *   one per question key of every form version this newcomer's logs use —
 *   header 「label (key)」, the label taken from the LATEST version that
 *   still carries the key (a key never changes after publication, §6, so the
 *   column is stable across versions; two keys bound to the same slot stay
 *   two columns),
 *   `alerts` (`rule_key:status`, joined with `;`),
 *   `response_status`, `response_comment`.
 *
 * Only non-deleted daily logs are exported (the caller's `listLogs()` already
 * excludes soft-deleted rows); rows are oldest first.
 */
import { getAnswer, type RawAnswers } from "@/lib/forms/resolve";
import { sortByOrder, type Question } from "@/lib/forms/schema";
import { formatTaipei, toInstant } from "@/lib/time";

// ---------------------------------------------------------------------------
// CSV primitives
// ---------------------------------------------------------------------------

/** Byte order mark, so Excel opens the UTF-8 file without mojibake. */
export const CSV_BOM = "\uFEFF";
/** RFC 4180 line ending. */
export const CSV_NEWLINE = "\r\n";
export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

/**
 * The single quote Excel / Numbers / LibreOffice read as "this cell is text".
 * It is not part of the value; `unescapeCsvFormulaGuard` removes it again.
 */
export const CSV_FORMULA_GUARD = "'";

/**
 * Leading characters that make a spreadsheet evaluate the cell instead of
 * showing it: `=` `+` `-` `@` and the whitespace `\t` / `\r` some apps strip
 * before parsing, which would expose the character behind them.
 */
const CSV_FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * One cell: guard against CSV formula injection first, then quote when the
 * result holds `,` `"` CR or LF; `null` / `undefined` → empty.
 *
 * Guard (D-49): a newcomer may write "-5", "+886...", "@name" or even "=1+1"
 * in a free-text answer, and HR opens the export in Excel, where a cell
 * starting with `=` `+` `-` `@` (or with a tab / CR before them) is a
 * formula. Prefixing `CSV_FORMULA_GUARD` keeps the cell text.
 * `unescapeCsvFormulaGuard` is the inverse and MUST be applied by the Phase 2
 * CSV import before the value reaches `answers`.
 */
export function csvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const guarded = CSV_FORMULA_LEAD.test(value) ? CSV_FORMULA_GUARD + value : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * The inverse of the `csvCell` guard, for the Phase 2 CSV import (D-49):
 * drop ONE leading single quote, and only when what follows still starts
 * with a formula character - so a value that really begins with a quote
 * ("'today went well") comes back untouched.
 *
 * Round-trips every value except the one ambiguous shape: a value that itself
 * begins with a quote followed by a formula character ("'=1+1") is
 * indistinguishable from a guarded "=1+1" and comes back without its quote.
 * No seed or CLAUDE.md §11 answer has that shape, and escaping the quote as
 * well would put a stray character in front of every quoted answer in the
 * file Excel shows HR, which is the export's only consumer.
 */
export function unescapeCsvFormulaGuard(value: string): string {
  if (!value.startsWith(CSV_FORMULA_GUARD)) return value;
  const rest = value.slice(CSV_FORMULA_GUARD.length);
  return CSV_FORMULA_LEAD.test(rest) ? rest : value;
}

/** Rows (header included) → the file body: BOM, CRLF between and after rows. */
export function toCsv(rows: readonly (readonly (string | null)[])[]): string {
  if (rows.length === 0) return CSV_BOM;
  return (
    CSV_BOM +
    rows.map((row) => row.map(csvCell).join(",")).join(CSV_NEWLINE) +
    CSV_NEWLINE
  );
}

/** `{username}-daily.csv`; characters outside `[A-Za-z0-9._-]` become `_`. */
export function csvFilename(username: string): string {
  const safe = username.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${safe === "" ? "newcomer" : safe}-daily.csv`;
}

/** Response headers of a CSV download. */
export function csvHttpHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": CSV_CONTENT_TYPE,
    "Content-Disposition": `attachment; filename=${filename}`,
  };
}

// ---------------------------------------------------------------------------
// Row assembly (PLAN T25: pure, unit-tested)
// ---------------------------------------------------------------------------

export const CSV_LOG_DATE_HEADER = "log_date";
export const CSV_SUBMITTED_AT_HEADER = "submitted_at";
export const CSV_ALERTS_HEADER = "alerts";
export const CSV_RESPONSE_STATUS_HEADER = "response_status";
export const CSV_RESPONSE_COMMENT_HEADER = "response_comment";
/** `submitted_at` rendered in Taipei (CLAUDE.md §0: all display is Taipei). */
export const CSV_DATETIME_FORMAT = "yyyy-MM-dd HH:mm";

/** A form version used by one of the logs (`getVersionById` + `parseQuestions`). */
export interface CsvVersion {
  id: string;
  /** `form_versions.version_no`; decides which label wins for a shared key. */
  version_no: number;
  questions: readonly Question[];
}

/** A daily log row (`listLogs()`; soft-deleted rows must be excluded by the caller). */
export interface CsvLog {
  id: string;
  log_date: string | null;
  /** timestamptz ISO. */
  submitted_at: string;
  form_version_id: string;
  /** `submissions.answers` jsonb. */
  answers: unknown;
}

/** An alert of one of those logs (`listAlertsWithSubmission()`, any status). */
export interface CsvAlert {
  submission_id: string;
  rule_key: string;
  status: string;
}

/**
 * A manager response targeting one of those logs, with `response.status` /
 * `response.comment` already resolved by slot through the response's own
 * version (same contract as the /hr dashboard, D-31).
 */
export interface CsvResponse {
  target_submission_id: string | null;
  /** timestamptz ISO; the latest response of a log wins the two columns. */
  submitted_at: string;
  status: string | null;
  comment: string | null;
}

export interface BuildNewcomerCsvInput {
  logs: readonly CsvLog[];
  versions: readonly CsvVersion[];
  alerts: readonly CsvAlert[];
  responses: readonly CsvResponse[];
}

export interface NewcomerCsvTable {
  /** Column headers, in file order. */
  header: string[];
  /** Question keys behind the middle columns, in file order. */
  questionKeys: string[];
  /** One row per log, oldest first; `null` = empty cell. */
  rows: (string | null)[][];
}

/** `submissions.answers` jsonb → the shape `getAnswer` reads. */
function answersOf(json: unknown): RawAnswers {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  return json as Record<string, unknown>;
}

/** Lexicographic order — for `YYYY-MM-DD` dates and rule keys only, never for timestamps. */
function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Chronological order of two timestamptz values. String comparison would be
 * wrong here: the same instant can arrive as `...T09:10:00+08:00` or
 * `...T01:10:00Z`, so the offsets are resolved through lib/time first.
 */
function compareInstant(a: string, b: string): number {
  return toInstant(a).getTime() - toInstant(b).getTime();
}

/**
 * The question columns: every key of every version the logs use, in the
 * order they first appear (ascending `version_no`, then question `order`), so
 * a later version only appends columns and the file stays comparable between
 * exports. The label is the one of the LATEST version carrying the key.
 * Disabled questions keep their column (their answers are `null`, A07) so a
 * question retired in the newest version still shows its historical answers.
 */
function questionColumns(versions: readonly CsvVersion[]): {
  keys: string[];
  labels: Map<string, string>;
} {
  const ordered = [...versions].sort((a, b) => a.version_no - b.version_no);
  const keys: string[] = [];
  const labels = new Map<string, string>();
  for (const version of ordered) {
    for (const question of sortByOrder(version.questions)) {
      if (!labels.has(question.key)) keys.push(question.key);
      labels.set(question.key, question.label);
    }
  }
  return { keys, labels };
}

/**
 * The whole table for one newcomer. Logs without a `log_date` (not possible
 * for `newcomer_daily`, defensive) and logs whose version is missing still
 * produce a row: the fixed columns are always readable.
 */
export function buildNewcomerCsvRows(input: BuildNewcomerCsvInput): NewcomerCsvTable {
  const { keys, labels } = questionColumns(input.versions);
  const header = [
    CSV_LOG_DATE_HEADER,
    CSV_SUBMITTED_AT_HEADER,
    ...keys.map((key) => `${labels.get(key) ?? key} (${key})`),
    CSV_ALERTS_HEADER,
    CSV_RESPONSE_STATUS_HEADER,
    CSV_RESPONSE_COMMENT_HEADER,
  ];

  const logs = [...input.logs].sort(
    (a, b) =>
      compareIso(a.log_date ?? "", b.log_date ?? "") ||
      compareInstant(a.submitted_at, b.submitted_at),
  );

  const rows = logs.map((log) => {
    const answers = answersOf(log.answers);
    const alerts = input.alerts
      .filter((alert) => alert.submission_id === log.id)
      .sort((a, b) => compareIso(a.rule_key, b.rule_key))
      .map((alert) => `${alert.rule_key}:${alert.status}`);
    const latest = input.responses
      .filter((response) => response.target_submission_id === log.id)
      .sort((a, b) => compareInstant(a.submitted_at, b.submitted_at))
      .at(-1);
    return [
      log.log_date,
      formatTaipei(log.submitted_at, CSV_DATETIME_FORMAT),
      ...keys.map((key) => getAnswer(answers, key)),
      alerts.length === 0 ? null : alerts.join(";"),
      latest?.status ?? null,
      latest?.comment ?? null,
    ];
  });

  return { header, questionKeys: keys, rows };
}

/** `buildNewcomerCsvRows` + `toCsv` — the file body of one newcomer's export. */
export function newcomerCsv(input: BuildNewcomerCsvInput): string {
  const table = buildNewcomerCsvRows(input);
  return toCsv([table.header, ...table.rows]);
}
