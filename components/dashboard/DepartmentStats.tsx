import { formatPercent } from "@/components/dashboard/MetricsTiles";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Json } from "@/lib/db/types";
import type { DepartmentRow, DepartmentStats7d } from "@/lib/metrics/department";
import { formatDate, type Workweek } from "@/lib/time";

/**
 * /hr 「近 7 日各部門統計」 block (CLAUDE.md §8, PLAN T24, A08(d)): one row per
 * department over the last seven Taipei days. Pure presentation — every
 * number comes from `departmentStats7d()` (lib/metrics/department.ts), which
 * the page calls once with the injected `now`.
 *
 * The table lives in shadcn `Table`'s own `overflow-x-auto` container, so the
 * eight columns scroll inside the block and the page body never scrolls
 * horizontally at 375px.
 */
export const DEPARTMENT_STATS_TITLE = "近 7 日各部門統計";
export const NO_DEPARTMENTS_LABEL = "尚未建立部門";

export const DEPARTMENT_COLUMNS = [
  "部門",
  "新人",
  "應交",
  "已交",
  "缺交",
  "預警",
  "已回應",
  "回應率",
] as const;

/**
 * `settings.workweek` validated (PLAN 4.8: no silent defaults) — the third
 * settings row the /hr dashboard needs, next to `parseDashboardSettings`
 * (NewcomerCard.tsx, which covers the two that /manager also needs).
 * Both 缺交率 and 應交 depend on it, so a broken row must throw rather than
 * quietly turn Saturdays into workdays.
 */
export function parseWorkweekSetting(raw: Json): Workweek {
  if (raw !== "mon_fri" && raw !== "mon_sat") {
    throw new Error("settings.workweek 必須是 mon_fri 或 mon_sat");
  }
  return raw;
}

/** 「8/29–9/4」: the window the table covers. */
export function windowLabel(stats: DepartmentStats7d<DepartmentRow>): string {
  return `${formatDate(stats.windowStart, "M/d")}–${formatDate(stats.windowEnd, "M/d")}`;
}

export interface DepartmentStatsProps<D extends DepartmentRow> {
  stats: DepartmentStats7d<D>;
}

export function DepartmentStats<D extends DepartmentRow>({ stats }: DepartmentStatsProps<D>) {
  return (
    <section
      aria-labelledby="department-stats-title"
      data-testid="department-stats"
      className="flex flex-col gap-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="department-stats-title" className="text-lg font-semibold">
          {DEPARTMENT_STATS_TITLE}
        </h2>
        <span className="text-sm text-muted-foreground">{windowLabel(stats)}</span>
      </div>
      {stats.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="department-stats-empty">
          {NO_DEPARTMENTS_LABEL}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {DEPARTMENT_COLUMNS.map((column) => (
                <TableHead key={column}>{column}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.rows.map((row) => (
              <TableRow
                key={row.department.id}
                data-testid="department-row"
                data-department-id={row.department.id}
              >
                <TableCell className="font-medium">{row.department.name}</TableCell>
                <TableCell>{row.newcomers}</TableCell>
                <TableCell>{row.expected}</TableCell>
                <TableCell>{row.submitted}</TableCell>
                <TableCell className={row.missing > 0 ? "text-destructive" : undefined}>
                  {row.missing}
                </TableCell>
                <TableCell>{row.alerts}</TableCell>
                <TableCell>{row.responded}</TableCell>
                <TableCell>{formatPercent(row.responseRate)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
