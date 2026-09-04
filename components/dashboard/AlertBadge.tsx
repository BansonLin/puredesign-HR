import { Badge } from "@/components/ui/badge";
import { ALERT_RULE_LABELS, alertRuleLabel } from "@/lib/metrics/summary";
import type { AlertState } from "@/lib/rules/derived";

/**
 * One alert as a badge (CLAUDE.md §8 /manager timeline, PLAN T17):
 * 「{kind}預警｜{state}」 — R1 → 進度, R2 → 卡點 (§8 / A13 wording); the state
 * is the derived A1 state from lib/rules/derived.ts: 待回應 / 逾時 / 已回應 /
 * 已關閉. `responded_late` reads 「已回應」 like `responded` — lateness only
 * affects statistics (§7 A1). Pure presentation; the caller derives `state`
 * with its own `now`.
 *
 * The rule → 進度 / 卡點 mapping is NOT restated here: it lives once in
 * lib/metrics/summary.ts (`ALERT_RULE_LABELS`, A13), which the one-line
 * summary and the /hr lists already use, and is re-exported under this
 * module's historical names so the badge and the summary can never drift.
 */
export const ALERT_KIND_LABELS = ALERT_RULE_LABELS;

export const ALERT_STATE_LABELS: Readonly<Record<AlertState, string>> = {
  open: "待回應",
  overdue: "逾時",
  responded: "已回應",
  responded_late: "已回應",
  closed: "已關閉",
};

/** 「進度」 for R1, 「卡點」 for R2; an unknown rule key is shown as is. */
export const alertKindLabel = alertRuleLabel;

export function alertStateLabel(state: AlertState): string {
  return ALERT_STATE_LABELS[state];
}

/** The badge text: `進度預警｜待回應`. */
export function alertBadgeText(ruleKey: string, state: AlertState): string {
  return `${alertKindLabel(ruleKey)}預警｜${alertStateLabel(state)}`;
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

function variantOf(state: AlertState): BadgeVariant {
  switch (state) {
    case "overdue":
      return "destructive";
    case "open":
      return "default";
    case "responded":
    case "responded_late":
      return "secondary";
    case "closed":
      return "outline";
  }
}

export interface AlertBadgeProps {
  ruleKey: string;
  state: AlertState;
  className?: string;
}

export function AlertBadge({ ruleKey, state, className }: AlertBadgeProps) {
  return (
    <Badge
      variant={variantOf(state)}
      className={className}
      data-testid="alert-badge"
      data-rule={ruleKey}
      data-state={state}
    >
      {alertBadgeText(ruleKey, state)}
    </Badge>
  );
}
