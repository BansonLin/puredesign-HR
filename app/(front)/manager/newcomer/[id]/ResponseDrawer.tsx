"use client";

/**
 * 「回應」 button + bottom sheet of one timeline day (PLAN T18; CLAUDE.md §8
 * /manager/newcomer/[id]). Every day gets the button, with or without
 * alerts (§11: 工務主任 responds to Darren 9/3 which has none). The sheet
 * renders the `manager_response` active version through `FormRenderer`;
 * the target log is bound into the Server Action by the page
 * (`submitManagerResponse.bind(null, { newcomerId, targetSubmissionId })`,
 * D-25), never read from the form. On success the sheet closes, a short
 * 「已送出回應」 status shows next to the button and the page — revalidated
 * by the action — re-reads the timeline with the new response and the
 * alerts now 已回應. Pure client component: no data access, no date math.
 */
import { useState } from "react";

import { FormRenderer, type FormAction, type FormActionState } from "@/components/forms/FormRenderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { Answers, Question } from "@/lib/forms/schema";

export const RESPOND_LABEL = "回應";
export const EDIT_RESPONSE_LABEL = "修改回應";
export const RESPONSE_SENT_LABEL = "已送出回應";
export const SUBMIT_RESPONSE_LABEL = "送出回應";
export const NO_ALERTS_HINT = "這天沒有預警，仍可留下一句話給新人。";
export const ON_BEHALF_BADGE = "HR 代填";

export interface ResponseDrawerAlert {
  id: string;
  /** 進度 / 卡點 (`alertKindLabel`). */
  kindLabel: string;
}

export interface ResponseDrawerProps {
  /** `M/d` of the log, for the sheet title. */
  dateLabel: string;
  /** Alerts of the day (any state), listed under the title. */
  alerts: readonly ResponseDrawerAlert[];
  /** `manager_response` active version, parsed. */
  questions: readonly Question[];
  /** The actor's existing response on this log (edit mode), or null. */
  initialAnswers: Answers | null;
  /** hr / admin acting in place of the manager (§10 on_behalf, shown as a badge). */
  onBehalf: boolean;
  /** `submitManagerResponse` bound to `{ newcomerId, targetSubmissionId }`. */
  action: FormAction;
}

export function ResponseDrawer({
  dateLabel,
  alerts,
  questions,
  initialAnswers,
  onBehalf,
  action,
}: ResponseDrawerProps) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);

  const wrappedAction: FormAction = async (previous: FormActionState, formData: FormData) => {
    const result = await action(previous, formData);
    if (!result.ok) return result;
    setSent(true);
    setOpen(false);
    return { ok: true };
  };

  const editing = initialAnswers !== null || sent;

  return (
    <div className="flex flex-col items-end gap-1">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            type="button"
            data-primary
            variant={editing ? "outline" : "default"}
            className="min-w-[44px] px-4"
            data-testid="respond-button"
          >
            {editing ? EDIT_RESPONSE_LABEL : RESPOND_LABEL}
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex flex-wrap items-center gap-2">
              回應 {dateLabel} 日誌
              {onBehalf ? <Badge variant="outline">{ON_BEHALF_BADGE}</Badge> : null}
            </SheetTitle>
            <SheetDescription asChild>
              <div>
                {alerts.length === 0 ? (
                  <p>{NO_ALERTS_HINT}</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {alerts.map((alert) => (
                      <li key={alert.id}>
                        <Badge variant="secondary">{alert.kindLabel}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <FormRenderer
              questions={questions}
              initialAnswers={initialAnswers}
              action={wrappedAction}
              submitLabel={SUBMIT_RESPONSE_LABEL}
            />
          </div>
        </SheetContent>
      </Sheet>
      {sent ? (
        <span role="status" className="text-xs text-muted-foreground" data-testid="response-sent">
          {RESPONSE_SENT_LABEL}
        </span>
      ) : null}
    </div>
  );
}
