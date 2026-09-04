import { describe, expect, it } from "vitest";

import {
  buildNewcomerCsvRows,
  CSV_ALERTS_HEADER,
  CSV_BOM,
  CSV_CONTENT_TYPE,
  CSV_LOG_DATE_HEADER,
  CSV_RESPONSE_COMMENT_HEADER,
  CSV_RESPONSE_STATUS_HEADER,
  CSV_SUBMITTED_AT_HEADER,
  csvCell,
  csvFilename,
  csvHttpHeaders,
  newcomerCsv,
  toCsv,
  unescapeCsvFormulaGuard,
  type CsvAlert,
  type CsvLog,
  type CsvResponse,
  type CsvVersion,
} from "@/lib/db/csv";
import type { Question } from "@/lib/forms/schema";
import { FIXTURE_NEWCOMERS, NEWCOMER_DAILY_QUESTIONS } from "@seed/fixtures";
import { buildSeedPlan } from "@seed/plan";

/**
 * T25 CSV export: the escaping primitives (comma, double quote, line break,
 * null) and the pure row assembly on the §11 seed fixture — 嚴雅齡 has two
 * daily logs, and the 9/3 one carries `R1:responded` plus her 採購主管's
 * 「已處理」 response.
 *
 * Every assertion is timezone-independent by construction: `submitted_at` is
 * rendered through `formatTaipei`, so `TZ=UTC` and `TZ=Asia/Taipei` produce
 * the same cell.
 */

const PLAN = buildSeedPlan();
const YEN_USERNAME = "yen_yaling";
const YEN = FIXTURE_NEWCOMERS.find((newcomer) => newcomer.username === YEN_USERNAME)!;

const DAILY_V1: CsvVersion = {
  id: "daily-v1",
  version_no: 1,
  questions: NEWCOMER_DAILY_QUESTIONS as readonly Question[],
};

const submissionId = (seq: number) => `seq-${seq}`;

const YEN_LOGS: CsvLog[] = PLAN.logs
  .filter((log) => log.username === YEN_USERNAME)
  .map((log) => ({
    id: submissionId(log.seq),
    log_date: log.log_date,
    submitted_at: log.submitted_at,
    form_version_id: DAILY_V1.id,
    answers: log.answers,
  }));

const YEN_ALERTS: CsvAlert[] = PLAN.alerts
  .filter((alert) => alert.username === YEN_USERNAME)
  .map((alert) => ({
    submission_id: submissionId(alert.log_seq),
    rule_key: alert.rule_key,
    status: alert.status,
  }));

const YEN_RESPONSES: CsvResponse[] = PLAN.responses
  .filter((response) => response.target_username === YEN_USERNAME)
  .map((response) => ({
    target_submission_id: submissionId(response.target_log_seq),
    submitted_at: response.submitted_at,
    status: response.answers.status ?? null,
    comment: response.answers.comment ?? null,
  }));

const yenTable = () =>
  buildNewcomerCsvRows({
    logs: YEN_LOGS,
    versions: [DAILY_V1],
    alerts: YEN_ALERTS,
    responses: YEN_RESPONSES,
  });

// ---------------------------------------------------------------------------
// escaping (PLAN T25: 逗號、雙引號、換行、null)
// ---------------------------------------------------------------------------

describe("csvCell", () => {
  it("leaves a plain value untouched", () => {
    expect(csvCell("完成")).toBe("完成");
    expect(csvCell("")).toBe("");
  });

  it("quotes a value containing a comma", () => {
    expect(csvCell("宏偉,裕福")).toBe('"宏偉,裕福"');
  });

  it("quotes and doubles an inner double quote", () => {
    expect(csvCell('他說 "沒問題"')).toBe('"他說 ""沒問題"""');
    expect(csvCell('"')).toBe('""""');
  });

  it("quotes a value containing a line break (LF and CRLF)", () => {
    expect(csvCell("第一行\n第二行")).toBe('"第一行\n第二行"');
    expect(csvCell("第一行\r\n第二行")).toBe('"第一行\r\n第二行"');
  });

  it("renders null and undefined as an empty cell", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("guards a value a spreadsheet would run as a formula (D-49)", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+886912345678")).toBe("'+886912345678");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@here")).toBe("'@here");
    // the guard goes inside the RFC 4180 quotes, not outside
    expect(csvCell("=SUM(A1,A2)")).toBe(`"'=SUM(A1,A2)"`);
    expect(csvCell("\t=1+1")).toBe("'\t=1+1");
    expect(csvCell("\r=1+1")).toBe(`"'\r=1+1"`);
  });

  it("leaves a value that only contains those characters later alone", () => {
    expect(csvCell("宏偉 - 裕福")).toBe("宏偉 - 裕福");
    expect(csvCell("2026-09-04")).toBe("2026-09-04");
    expect(csvCell("a@pure.internal")).toBe("a@pure.internal");
  });
});

describe("unescapeCsvFormulaGuard (Phase 2 CSV import, D-49)", () => {
  it("round-trips every guarded value back to what the newcomer wrote", () => {
    for (const value of ["=1+1", "+886912345678", "-5", "@here", "\t=1+1", "\r=1+1", "=SUM(A1,A2)"]) {
      const cell = csvCell(value);
      // strip the RFC 4180 quoting a real parser would remove first
      const parsed =
        cell.startsWith('"') && cell.endsWith('"')
          ? cell.slice(1, -1).replace(/""/g, '"')
          : cell;
      expect(parsed).not.toBe(value);
      expect(unescapeCsvFormulaGuard(parsed)).toBe(value);
    }
  });

  it("does not strip a quote from a value that really starts with one", () => {
    expect(unescapeCsvFormulaGuard("'今天很順")).toBe("'今天很順");
    expect(unescapeCsvFormulaGuard("'")).toBe("'");
    expect(unescapeCsvFormulaGuard("''")).toBe("''");
  });

  it("leaves an unguarded value untouched", () => {
    expect(unescapeCsvFormulaGuard("完成")).toBe("完成");
    expect(unescapeCsvFormulaGuard("")).toBe("");
    expect(unescapeCsvFormulaGuard("=1+1")).toBe("=1+1");
  });
});

describe("toCsv", () => {
  it("starts with the UTF-8 BOM and separates rows with CRLF", () => {
    const csv = toCsv([
      ["a", "b"],
      ["c", null],
    ]);
    expect(csv).toBe(`${CSV_BOM}a,b\r\nc,\r\n`);
    expect(csv.split("\r\n")).toHaveLength(3); // two rows + trailing CRLF
  });

  it("escapes cells while serializing", () => {
    expect(toCsv([["x,y", 'a"b', "l1\nl2"]])).toBe(`${CSV_BOM}"x,y","a""b","l1\nl2"\r\n`);
  });

  it("returns just the BOM for no rows", () => {
    expect(toCsv([])).toBe(CSV_BOM);
  });
});

describe("csvFilename / csvHttpHeaders", () => {
  it("names the file {username}-daily.csv", () => {
    expect(csvFilename(YEN_USERNAME)).toBe("yen_yaling-daily.csv");
  });

  it("replaces characters that would break the header", () => {
    expect(csvFilename('a"b c')).toBe("a_b_c-daily.csv");
    expect(csvFilename("嚴雅齡")).toBe("___-daily.csv");
  });

  it("sets the CSV content type and an attachment disposition", () => {
    expect(csvHttpHeaders(csvFilename(YEN_USERNAME))).toEqual({
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": "attachment; filename=yen_yaling-daily.csv",
    });
    expect(CSV_CONTENT_TYPE).toBe("text/csv; charset=utf-8");
  });
});

// ---------------------------------------------------------------------------
// row assembly on the §11 fixture
// ---------------------------------------------------------------------------

describe("buildNewcomerCsvRows (§11 嚴雅齡)", () => {
  it("has the fixed columns around one column per v1 question key", () => {
    const { header, questionKeys } = yenTable();
    expect(questionKeys).toEqual(NEWCOMER_DAILY_QUESTIONS.map((question) => question.key));
    expect(header.slice(0, 2)).toEqual([CSV_LOG_DATE_HEADER, CSV_SUBMITTED_AT_HEADER]);
    expect(header.slice(-3)).toEqual([
      CSV_ALERTS_HEADER,
      CSV_RESPONSE_STATUS_HEADER,
      CSV_RESPONSE_COMMENT_HEADER,
    ]);
    expect(header[2]).toBe("昨日項目一狀態 (r1_status)");
    expect(header).toHaveLength(2 + NEWCOMER_DAILY_QUESTIONS.length + 3);
  });

  it("exports her two logs, oldest first, with Taipei submission times", () => {
    const { rows } = yenTable();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row[0])).toEqual(["2026-09-02", "2026-09-03"]);
    expect(rows.map((row) => row[1])).toEqual(["2026-09-02 17:12", "2026-09-03 17:03"]);
  });

  it("puts the 9/3 alert as `R1:responded` and her 主管's 已處理 response", () => {
    const { header, rows } = yenTable();
    const alerts = header.indexOf(CSV_ALERTS_HEADER);
    const status = header.indexOf(CSV_RESPONSE_STATUS_HEADER);
    const comment = header.indexOf(CSV_RESPONSE_COMMENT_HEADER);

    const [sep2, sep3] = rows;
    expect(sep3[alerts]).toBe("R1:responded");
    expect(sep3[status]).toBe("已處理");
    expect(sep3[comment]).toBe("已請 Patty 給工項對照表；宏偉訂金明早追");

    // 9/2 has no previous log, so no alert and no response.
    expect(sep2[alerts]).toBeNull();
    expect(sep2[status]).toBeNull();
    expect(sep2[comment]).toBeNull();
  });

  it("writes the answers of each log under their own key, empty ones as null", () => {
    const { header, rows } = yenTable();
    const cell = (row: (string | null)[], key: string) =>
      row[header.findIndex((column) => column.endsWith(`(${key})`))];

    const [sep2, sep3] = rows;
    expect(cell(sep3, "r1_status")).toBe("持續中");
    expect(cell(sep3, "r1_reason")).toBe("案件利潤表工項明細不確定，已問 Patty");
    expect(cell(sep3, "p3_text")).toBe("宏偉訂金確認");
    expect(cell(sep3, "top")).toBe("項目三");
    expect(cell(sep2, "r1_reason")).toBeNull();
  });

  it("joins several alerts of one log with `;`, sorted by rule_key", () => {
    const { header, rows } = buildNewcomerCsvRows({
      logs: YEN_LOGS,
      versions: [DAILY_V1],
      alerts: [
        { submission_id: submissionId(6), rule_key: "R2", status: "open" },
        ...YEN_ALERTS,
      ],
      responses: YEN_RESPONSES,
    });
    expect(rows[1][header.indexOf(CSV_ALERTS_HEADER)]).toBe("R1:responded;R2:open");
  });

  it("keeps the latest response of a log when there is more than one", () => {
    const { header, rows } = buildNewcomerCsvRows({
      logs: YEN_LOGS,
      versions: [DAILY_V1],
      alerts: YEN_ALERTS,
      responses: [
        ...YEN_RESPONSES,
        {
          // Taipei offset form of a later instant: the pick must not be a
          // string comparison (`+08:00` sorts before the `Z` form).
          target_submission_id: submissionId(6),
          submitted_at: "2026-09-04T18:00:00+08:00",
          status: "需 HR 協助",
          comment: null,
        },
      ],
    });
    expect(rows[1][header.indexOf(CSV_RESPONSE_STATUS_HEADER)]).toBe("需 HR 協助");
    expect(rows[1][header.indexOf(CSV_RESPONSE_COMMENT_HEADER)]).toBeNull();
  });

  it("takes the label from the latest version and appends that version's new keys", () => {
    const v2: CsvVersion = {
      id: "daily-v2",
      version_no: 2,
      questions: [
        ...NEWCOMER_DAILY_QUESTIONS.map((question) =>
          question.key === "p1_text"
            ? { ...(question as Question), label: "明日第一件事" }
            : (question as Question),
        ),
        {
          key: "mood",
          label: "今日心情",
          type: "short_text",
          required: false,
          slot: null,
          order: 99,
          disabled: false,
        } satisfies Question,
      ],
    };
    const { header, questionKeys } = buildNewcomerCsvRows({
      logs: YEN_LOGS,
      versions: [v2, DAILY_V1],
      alerts: YEN_ALERTS,
      responses: YEN_RESPONSES,
    });
    expect(header).toContain("明日第一件事 (p1_text)");
    expect(header).not.toContain("明日項目一 (p1_text)");
    // the new key is appended after the v1 keys, before the fixed tail
    expect(questionKeys.at(-1)).toBe("mood");
    expect(header.at(-4)).toBe("今日心情 (mood)");
  });
});

describe("newcomerCsv", () => {
  it("serializes header + rows with BOM, CRLF and quoted cells", () => {
    const csv = newcomerCsv({
      logs: YEN_LOGS,
      versions: [DAILY_V1],
      alerts: YEN_ALERTS,
      responses: YEN_RESPONSES,
    });
    const lines = csv.split("\r\n");
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(lines).toHaveLength(4); // header + two logs + trailing CRLF
    expect(lines[0].startsWith(`${CSV_BOM}${CSV_LOG_DATE_HEADER},${CSV_SUBMITTED_AT_HEADER},`)).toBe(
      true,
    );
    expect(lines[2].startsWith("2026-09-03,2026-09-03 17:03,")).toBe(true);
    expect(lines[2].endsWith("R1:responded,已處理,已請 Patty 給工項對照表；宏偉訂金明早追")).toBe(
      true,
    );
  });

  it("quotes an answer that contains a comma", () => {
    const csv = newcomerCsv({
      logs: [
        {
          ...YEN_LOGS[0],
          answers: { ...(YEN_LOGS[0].answers as Record<string, unknown>), p1_text: "宏偉,裕福 報價" },
        },
      ],
      versions: [DAILY_V1],
      alerts: [],
      responses: [],
    });
    expect(csv).toContain('"宏偉,裕福 報價"');
  });

  it("is about 嚴雅齡 (fixture guard)", () => {
    expect(YEN.display_name).toBe("嚴雅齡");
  });
});
