import type { AlertRates, Ratio } from "@/lib/metrics/rates";

/**
 * /hr 「三指標」 block (CLAUDE.md §7 指標定義, §8; PLAN T24): 誤報率,
 * 主管回應率 and 24h 內回應率 as three tiles. Pure presentation — the numbers
 * come from `alertRates()` (lib/metrics/rates.ts), which the page calls once
 * with the injected `now`; nothing here reads a clock or the database, so
 * the unit test renders it through react-dom/server.
 *
 * Denominators are lib/metrics' (PLAN A08(e)) and are printed next to each
 * percentage (`1 / 2`) so HR can see the population behind the number; a
 * ratio with denominator 0 shows 「—」, never `NaN` (`Ratio.rate === null`).
 * `late` (responded after `response_threshold_hours`, §7 A1) is a statistic
 * only and rides along in the footnote.
 *
 * Layout: three tiles side by side, no table — nothing to scroll at 375px.
 */
export const METRICS_TITLE = "三指標";
export const NO_RATE_LABEL = "—";
export const NO_ALERTS_LABEL = "目前沒有預警，三指標尚無母體";

export const METRIC_LABELS = {
  falsePositive: "誤報率",
  response: "主管回應率",
  within24h: "24h 內回應率",
} as const;

/** Percentage of a `Ratio`, at most one decimal (`50%`, `33.3%`); 「—」 when undefined. */
export function formatPercent(value: Ratio): string {
  if (value.rate === null) return NO_RATE_LABEL;
  return `${Math.round(value.rate * 1000) / 10}%`;
}

/** 「1 / 2」: the numerator and denominator behind a percentage. */
export function ratioLabel(value: Ratio): string {
  return `${value.numerator} / ${value.denominator}`;
}

/** 「預警母體 2 筆・逾時回應 0 筆」 — the population footnote under the tiles. */
export function metricsFootnote(rates: AlertRates): string {
  return `預警母體 ${rates.total} 筆・逾時回應 ${rates.late} 筆`;
}

export interface MetricsTilesProps {
  rates: AlertRates;
}

function Tile({ label, value }: { label: string; value: Ratio }) {
  return (
    <div
      className="flex flex-col items-center rounded-lg border bg-card px-2 py-3 text-card-foreground"
      data-testid="metric-tile"
      data-metric={label}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold" data-testid="metric-value">
        {formatPercent(value)}
      </span>
      <span className="text-xs text-muted-foreground">{ratioLabel(value)}</span>
    </div>
  );
}

export function MetricsTiles({ rates }: MetricsTilesProps) {
  return (
    <section aria-labelledby="metrics-title" data-testid="metrics" className="flex flex-col gap-3">
      <h2 id="metrics-title" className="text-lg font-semibold">
        {METRICS_TITLE}
      </h2>
      <div className="grid grid-cols-3 gap-2">
        <Tile label={METRIC_LABELS.falsePositive} value={rates.falsePositive} />
        <Tile label={METRIC_LABELS.response} value={rates.response} />
        <Tile label={METRIC_LABELS.within24h} value={rates.within24h} />
      </div>
      {rates.total === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="metrics-empty">
          {NO_ALERTS_LABEL}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{metricsFootnote(rates)}</p>
      )}
    </section>
  );
}
