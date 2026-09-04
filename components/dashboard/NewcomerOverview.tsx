import Link from "next/link";

import { formatPercent, NO_RATE_LABEL } from "@/components/dashboard/MetricsTiles";
import {
  ALL_MILESTONES_DONE_LABEL,
  NO_MILESTONES_LABEL,
  NO_START_DATE_LABEL,
} from "@/components/dashboard/NewcomerHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DepartmentRow } from "@/lib/metrics/department";
import type { NewcomerOverviewRow, OverviewNewcomer } from "@/lib/metrics/newcomer";
import { formatDate } from "@/lib/time";
import type { NextMilestone } from "@/lib/time/milestones";

/**
 * /hr 「新人總覽」 block (CLAUDE.md §8, PLAN T24, A08(a)/(c), A09): one row per
 * active newcomer — 姓名, 部門, 第 N 天, 階段, 下一節點, 累計預警, 回應率,
 * 缺交率, all 到職至今全期. Pure presentation: every value comes from
 * `newcomerOverview()` (lib/metrics/newcomer.ts), computed once by the page
 * with the injected `now`; the department name is looked up from the
 * `departments` rows the page loaded (profiles only carry `department_id`).
 *
 * The name links to `/hr/newcomer/[id]` (T25). `/ceo` is read-only (§8): pass
 * `hrefFor={null}` and the names render as plain text.
 *
 * The table sits in shadcn `Table`'s `overflow-x-auto` container, so the page
 * body never scrolls horizontally at 375px.
 */
export const NEWCOMER_OVERVIEW_TITLE = "新人總覽";
export const NO_NEWCOMERS_LABEL = "目前沒有 active 新人";
export const UNKNOWN_DEPARTMENT_LABEL = "未指派部門";

export const OVERVIEW_COLUMNS = [
  "姓名",
  "部門",
  "第 N 天",
  "階段",
  "下一節點",
  "累計預警",
  "回應率",
  "缺交率",
] as const;

/** T25 page; the 待處理預警 / 介入清單 lists keep their own `hrefFor` (AlertList). */
export const HR_NEWCOMER_PATH = "/hr/newcomer";

export function hrNewcomerHref(newcomerId: string): string {
  return `${HR_NEWCOMER_PATH}/${newcomerId}`;
}

/** 「第 4 天」; 「尚未設定到職日」 without a start date (A09). */
export function dayLabel(dayNumber: number | null): string {
  return dayNumber === null ? NO_START_DATE_LABEL : `第 ${dayNumber} 天`;
}

/**
 * 「D30 2026/10/01」, with 「（逾期 N 天）」 appended when the milestone is past
 * due (A09). `null` means either every milestone is done or none exist —
 * the two cases the header wording already distinguishes.
 */
export function nextMilestoneLabel(
  next: NextMilestone | null,
  hasMilestones: boolean,
): string {
  if (next === null) return hasMilestones ? ALL_MILESTONES_DONE_LABEL : NO_MILESTONES_LABEL;
  const overdue = next.overdueDays > 0 ? `（逾期 ${next.overdueDays} 天）` : "";
  return `${next.kind} ${formatDate(next.due)}${overdue}`;
}

export interface NewcomerOverviewProps<N extends OverviewNewcomer> {
  rows: readonly NewcomerOverviewRow<N>[];
  /** For the department name of `newcomer.department_id`. */
  departments: readonly DepartmentRow[];
  /** Link of the newcomer name; `null` renders plain text (/ceo, §8). */
  hrefFor?: ((newcomerId: string) => string) | null;
}

export function NewcomerOverview<N extends OverviewNewcomer>({
  rows,
  departments,
  hrefFor = hrNewcomerHref,
}: NewcomerOverviewProps<N>) {
  const departmentName = new Map(departments.map((d) => [d.id, d.name] as const));
  return (
    <section
      aria-labelledby="newcomer-overview-title"
      data-testid="newcomer-overview"
      className="flex flex-col gap-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="newcomer-overview-title" className="text-lg font-semibold">
          {NEWCOMER_OVERVIEW_TITLE}
        </h2>
        <span className="text-sm text-muted-foreground">{rows.length} 人</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="newcomer-overview-empty">
          {NO_NEWCOMERS_LABEL}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {OVERVIEW_COLUMNS.map((column) => (
                <TableHead key={column}>{column}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const href = hrefFor === null ? null : hrefFor(row.newcomer.id);
              const department =
                row.newcomer.department_id === null
                  ? UNKNOWN_DEPARTMENT_LABEL
                  : (departmentName.get(row.newcomer.department_id) ?? UNKNOWN_DEPARTMENT_LABEL);
              return (
                <TableRow
                  key={row.newcomer.id}
                  data-testid="overview-row"
                  data-user-id={row.newcomer.id}
                >
                  <TableCell className="font-medium">
                    {href === null ? (
                      row.newcomer.display_name
                    ) : (
                      <Link
                        href={href}
                        className="flex min-h-11 items-center underline-offset-4 hover:underline"
                      >
                        {row.newcomer.display_name}
                      </Link>
                    )}
                  </TableCell>
                  <TableCell>{department}</TableCell>
                  <TableCell>{dayLabel(row.dayNumber)}</TableCell>
                  <TableCell>{row.stage ? row.stage.label : NO_RATE_LABEL}</TableCell>
                  <TableCell>
                    {nextMilestoneLabel(row.nextMilestone, row.stage !== null)}
                  </TableCell>
                  <TableCell>{row.alertCount}</TableCell>
                  <TableCell>{formatPercent(row.responseRate)}</TableCell>
                  <TableCell>
                    {row.missingRate === null ? NO_RATE_LABEL : formatPercent(row.missingRate)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
