import { Badge } from "@/components/ui/badge";
import type { AlertState } from "@/lib/rules/derived";

/**
 * One alert as a badge (CLAUDE.md §8 /manager timeline, PLAN T17):
 * 「{kind}預警｜{state}」 — R1 → 進度, R2 → 卡點 (§8 / A13 wording); the state
 * is the derived A1 state from lib/rules/derived.ts: 待回應 / 逾時 / 已回應 /
 * 已關閉. `responded_late` reads 「已回應」 like `responded` — lateness only
 * affects statistics (§7 A1). Pure presentation; the caller derives `state`
 * with its own `now`.
 */
export const ALERT_KIND_LABELS: Readonly<Record<string, string>> = {
  R1: "進度",
  R2: "卡點",
};

export const ALERT_STATE_LABELS: Readonly<Record<AlertState, string>> = {
  open: "待回應",
  overdue: "逾時",
  responded: "已回應",
  responded_late: "已回應",
  closed: "已關閉",
};

/** 「進度」 for R1, 「卡點」 for R2; an unknown rule key is shown as is. */
export function alertKindLabel(ruleKey: string): string {
  return ALERT_KIND_LABELS[ruleKey] ?? ruleKey;
}

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
