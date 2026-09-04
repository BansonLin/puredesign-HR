import { Badge } from "@/components/ui/badge";
import type {
  DashboardNewcomer,
  TodaySubmissions as TodaySubmissionsData,
} from "@/lib/metrics/dashboard";
import { formatDate } from "@/lib/time";

/**
 * /hr 「今日交件」 block (CLAUDE.md §8, PLAN T20): 應交／已交／缺交／未到時
 * counters plus the 缺交名單 (and the 未到時名單 while the cutoff has not
 * passed). Pure presentation: the numbers and lists come from
 * `buildHrDashboard(...).today` (lib/metrics/dashboard.ts), which the page
 * computes with one injected `now`; nothing here reads a clock or the
 * database, so the unit test renders it with react-dom/server.
 *
 * Layout: a 4-column counter grid and name chips that wrap, so the block
 * never scrolls horizontally at 375px.
 */
export const TODAY_TITLE = "今日交件";
export const MISSING_LIST_TITLE = "缺交名單";
export const PENDING_LIST_TITLE = "未到時名單";
export const NO_EXPECTED_LABEL = "今天沒有應交日誌的新人";
export const NO_MISSING_LABEL = "目前沒有缺交";

export const TODAY_COUNTER_LABELS = {
  expected: "應交",
  submitted: "已交",
  missing: "缺交",
  pending: "未到時",
} as const;

export interface TodaySubmissionsProps<N extends DashboardNewcomer> {
  today: TodaySubmissionsData<N>;
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: "destructive" }) {
  return (
    <div
      className="flex flex-col items-center rounded-lg border bg-card px-2 py-2 text-card-foreground"
      data-testid="today-counter"
      data-counter={label}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={
          tone === "destructive" && value > 0
            ? "text-2xl font-semibold text-destructive"
            : "text-2xl font-semibold"
        }
      >
        {value}
      </span>
    </div>
  );
}

function NameChips<N extends DashboardNewcomer>({
  names,
  variant,
  testId,
}: {
  names: readonly N[];
  variant: "destructive" | "outline";
  testId: string;
}) {
  return (
    <ul className="flex flex-wrap gap-2" data-testid={testId}>
      {names.map((newcomer) => (
        <li key={newcomer.id}>
          <Badge variant={variant} data-user-id={newcomer.id}>
            {newcomer.display_name}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export function TodaySubmissions<N extends DashboardNewcomer>({ today }: TodaySubmissionsProps<N>) {
  return (
    <section aria-labelledby="today-submissions-title" data-testid="today-submissions" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="today-submissions-title" className="text-lg font-semibold">
          {TODAY_TITLE}
        </h2>
        <span className="text-sm text-muted-foreground">{formatDate(today.date)}</span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Counter label={TODAY_COUNTER_LABELS.expected} value={today.expected} />
        <Counter label={TODAY_COUNTER_LABELS.submitted} value={today.submitted} />
        <Counter label={TODAY_COUNTER_LABELS.missing} value={today.missing} tone="destructive" />
        <Counter label={TODAY_COUNTER_LABELS.pending} value={today.pending} />
      </div>

      {today.expected === 0 ? (
        <p className="text-sm text-muted-foreground">{NO_EXPECTED_LABEL}</p>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">{MISSING_LIST_TITLE}</p>
            {today.missingList.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="missing-list-empty">
                {NO_MISSING_LABEL}
              </p>
            ) : (
              <NameChips names={today.missingList} variant="destructive" testId="missing-list" />
            )}
          </div>
          {today.pendingList.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">{PENDING_LIST_TITLE}</p>
              <NameChips names={today.pendingList} variant="outline" testId="pending-list" />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
