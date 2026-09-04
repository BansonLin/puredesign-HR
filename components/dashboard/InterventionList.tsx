import Link from "next/link";

import { defaultNewcomerHref, openHoursLabel } from "@/components/dashboard/AlertList";
import { Badge } from "@/components/ui/badge";
import type { Enums, Tables } from "@/lib/db/types";
import { alertRuleLabel } from "@/lib/metrics/summary";
import type {
  HrInterventionList,
  InterventionAlertLike,
  NewcomerLike,
  ResponseLike,
} from "@/lib/rules/derived";
import { formatDate, formatTaipei } from "@/lib/time";

/**
 * /hr 「HR 介入清單」 block (CLAUDE.md §8, PLAN T20 / A04), two segments
 * straight from `buildHrDashboard(...).intervention`
 * (`hrInterventionList` in lib/rules/derived.ts):
 *   - 逾時未回: `open` alerts past `response_threshold_hours`, oldest first —
 *     newcomer, rule label (`alertRuleLabel`), log date, 「已 N 小時未回」;
 *   - 需 HR 協助: manager responses with `response.status = 需 HR 協助` in the
 *     last 7 Taipei days, newest first — newcomer, response time and, when
 *     the page resolved it, the manager's one-line comment
 *     (`response_comment`, slot `response.comment`). The response may have
 *     been written by HR / admin on the manager's behalf (D-35), so the time
 *     line reads 「HR 代填於 …」 whenever the page passes a `responder_role`
 *     of `hr` / `admin`, and 「主管回應於 …」 otherwise.
 * Pure presentation; both lists were derived upstream with the page's `now`.
 * Newcomer names link to the timeline (`hrefFor`, see AlertList);
 * `hrefFor={null}` renders them as plain text for the read-only /ceo (T26).
 */
export const INTERVENTION_TITLE = "HR 介入清單";
export const OVERDUE_TITLE = "逾時未回";
export const NEED_HR_TITLE = "需 HR 協助";
export const NO_OVERDUE_LABEL = "沒有逾時未回的預警";
export const NO_NEED_HR_LABEL = "近 7 日沒有需 HR 協助的回應";
export const RESPONDED_AT_PREFIX = "主管回應於";
export const ON_BEHALF_AT_PREFIX = "HR 代填於";

/** Roles whose response is an HR stand-in (§10 「可代填（標註 on_behalf）」, D-35). */
const ON_BEHALF_ROLES: readonly Enums<"user_role">[] = ["hr", "admin"];

/**
 * 「HR 代填於 …」 when the responder is hr / admin, else 「主管回應於 …」.
 * `null` / `undefined` (the page did not resolve the role) reads as a manager,
 * which is what every Phase 1 response is unless HR filled it in.
 */
export function responderPrefix(role: Enums<"user_role"> | null | undefined): string {
  return role && ON_BEHALF_ROLES.includes(role) ? ON_BEHALF_AT_PREFIX : RESPONDED_AT_PREFIX;
}

/** The alert columns this list shows on top of what `hrInterventionList` needs. */
export type InterventionAlertRow = InterventionAlertLike &
  Pick<Tables<"alerts">, "id" | "rule_key"> & {
    submission: Pick<Tables<"submissions">, "log_date">;
  };

/**
 * A response row, optionally with the manager's comment and the responder's
 * role resolved by the page (`profiles.role` of `response.user_id`, D-35).
 */
export type InterventionResponseRow = ResponseLike &
  Pick<Tables<"submissions">, "id"> & {
    response_comment?: string | null;
    responder_role?: Enums<"user_role"> | null;
  };

export interface InterventionListProps<
  N extends NewcomerLike & Pick<Tables<"profiles">, "display_name">,
  A extends InterventionAlertRow,
  R extends InterventionResponseRow,
> {
  intervention: HrInterventionList<N, A, R>;
  /**
   * Link of the newcomer name; defaults to `defaultNewcomerHref` (AlertList).
   * `null` renders plain text (/ceo is read-only, §8 / PLAN T26).
   */
  hrefFor?: ((newcomerId: string) => string) | null;
}

function NameLink({ href, name }: { href: string | null; name: string }) {
  if (href === null) return <span className="text-base font-semibold">{name}</span>;
  return (
    <Link href={href} className="flex min-h-11 items-center text-base font-semibold underline-offset-4 hover:underline">
      {name}
    </Link>
  );
}

export function InterventionList<
  N extends NewcomerLike & Pick<Tables<"profiles">, "display_name">,
  A extends InterventionAlertRow,
  R extends InterventionResponseRow,
>({ intervention, hrefFor = defaultNewcomerHref }: InterventionListProps<N, A, R>) {
  const { overdue, needHr } = intervention;
  const nameHref = (newcomerId: string): string | null =>
    hrefFor === null ? null : hrefFor(newcomerId);
  return (
    <section aria-labelledby="intervention-title" data-testid="intervention" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="intervention-title" className="text-lg font-semibold">
          {INTERVENTION_TITLE}
        </h2>
        <span className="text-sm text-muted-foreground">{overdue.length + needHr.length} 筆</span>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">
          {OVERDUE_TITLE}（{overdue.length}）
        </h3>
        {overdue.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="overdue-empty">
            {NO_OVERDUE_LABEL}
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="overdue-list">
            {overdue.map((entry) => (
              <li
                key={entry.alert.id}
                className="flex flex-col gap-1 rounded-lg border bg-card p-3 text-card-foreground"
                data-testid="overdue-entry"
                data-alert-id={entry.alert.id}
                data-user-id={entry.newcomer.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <NameLink href={nameHref(entry.newcomer.id)} name={entry.newcomer.display_name} />
                  <Badge variant="destructive" data-rule={entry.alert.rule_key}>
                    {alertRuleLabel(entry.alert.rule_key)}預警
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {entry.alert.submission.log_date
                    ? `${formatDate(entry.alert.submission.log_date, "M/d")} 日誌`
                    : "日誌日期不明"}
                  <span className="mx-1">·</span>
                  {openHoursLabel(entry.openHours)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">
          {NEED_HR_TITLE}（{needHr.length}）
        </h3>
        {needHr.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="need-hr-empty">
            {NO_NEED_HR_LABEL}
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="need-hr-list">
            {needHr.map((entry) => (
              <li
                key={entry.response.id}
                className="flex flex-col gap-1 rounded-lg border bg-card p-3 text-card-foreground"
                data-testid="need-hr-entry"
                data-response-id={entry.response.id}
                data-user-id={entry.newcomer.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <NameLink href={nameHref(entry.newcomer.id)} name={entry.newcomer.display_name} />
                  <Badge variant="default">{NEED_HR_TITLE}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {responderPrefix(entry.response.responder_role)}{" "}
                  {formatTaipei(entry.response.submitted_at)}
                </p>
                {entry.response.response_comment ? (
                  <p className="break-words text-sm">{entry.response.response_comment}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
