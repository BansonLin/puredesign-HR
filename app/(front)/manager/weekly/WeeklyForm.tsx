"use client";

/**
 * /manager/weekly client wrapper (PLAN T22; CLAUDE.md §8): the newcomer
 * dropdown plus the `weekly_feedback` form rendered by `FormRenderer`.
 *
 * The dropdown is not part of the form's FormData: choosing a newcomer
 * navigates to `/manager/weekly?newcomer={id}` and the page re-renders with
 * that newcomer's existing feedback (edit mode) or a fresh form whose
 * `weekly.start_date` question is pre-filled with this week's Monday; the
 * selected id is bound into the Server Action by the page
 * (`submitWeeklyFeedback.bind(null, { newcomerId })`, D-25), so the action
 * never trusts a client-supplied target. Without a selection the submit
 * button is disabled.
 *
 * `WeeklyFormView` is the presentational part (no router) so tests can
 * render it through react-dom/server; `WeeklyForm` wires `useRouter`.
 *
 * On success the wrapper swallows the renderer's message and shows its own
 * 「已送出週回饋」 card (same pattern as TodayForm, D-27); the form stays
 * below, still editable.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormRenderer, type FormAction, type FormActionState } from "@/components/forms/FormRenderer";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { cn } from "@/components/ui/utils";
import type { Answers, Question } from "@/lib/forms/schema";

export const WEEKLY_PATH = "/manager/weekly";
export const NEWCOMER_SELECT_LABEL = "對象新人";
export const NEWCOMER_SELECT_PLACEHOLDER = "請選擇新人";
export const SUBMIT_WEEKLY_LABEL = "送出週回饋";
export const UPDATE_WEEKLY_LABEL = "更新週回饋";
export const WEEKLY_SAVED_TITLE = "已送出週回饋";
export const WEEKLY_SAVED_TEXT = "同一週再送出會覆蓋這筆內容。";
export const EDITING_HINT = "本週已填過，送出會更新原本的內容。";
export const ON_BEHALF_BADGE = "HR 代填";

export interface WeeklyNewcomerOption {
  id: string;
  display_name: string;
}

export interface WeeklyFormViewProps {
  /** Newcomers the actor may pick (already filtered by §10). */
  newcomers: readonly WeeklyNewcomerOption[];
  /** The selected newcomer (`?newcomer=`), or null. */
  selectedId: string | null;
  /** `weekly_feedback` active version, parsed. */
  questions: readonly Question[];
  /** Existing answers for (actor, selected newcomer, this week) or the pre-filled fresh form. */
  initialAnswers: Answers | null;
  /** The actor already has feedback for the selected newcomer this week. */
  editing: boolean;
  /** hr / admin acting in place of the manager (§10 on_behalf, shown as a badge). */
  onBehalf: boolean;
  /** `submitWeeklyFeedback` bound to `{ newcomerId: selectedId }`. */
  action: FormAction;
  /** Called with the newly chosen newcomer id (`''` for the placeholder). */
  onSelect: (id: string) => void;
}

export function WeeklyFormView({
  newcomers,
  selectedId,
  questions,
  initialAnswers,
  editing,
  onBehalf,
  action,
  onSelect,
}: WeeklyFormViewProps) {
  const [saved, setSaved] = useState(false);

  const wrappedAction: FormAction = async (previous: FormActionState, formData: FormData) => {
    const result = await action(previous, formData);
    if (!result.ok) {
      setSaved(false);
      return result;
    }
    setSaved(true);
    return { ok: true };
  };

  const selectId = "weekly-newcomer";
  const hasSelection = selectedId !== null && newcomers.some((n) => n.id === selectedId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor={selectId} className="flex items-center gap-2">
          {NEWCOMER_SELECT_LABEL}
          {onBehalf ? <Badge variant="outline">{ON_BEHALF_BADGE}</Badge> : null}
        </Label>
        <select
          id={selectId}
          name="newcomer"
          value={hasSelection ? selectedId : ""}
          onChange={(event) => onSelect(event.target.value)}
          data-testid="newcomer-select"
          className={cn(
            "border-input h-11 w-full min-w-0 rounded-md border bg-transparent px-3 text-base shadow-xs outline-none",
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          )}
        >
          <option value="">{NEWCOMER_SELECT_PLACEHOLDER}</option>
          {newcomers.map((newcomer) => (
            <option key={newcomer.id} value={newcomer.id}>
              {newcomer.display_name}
            </option>
          ))}
        </select>
        {editing && hasSelection ? (
          <p className="text-sm text-muted-foreground" data-testid="editing-hint">
            {EDITING_HINT}
          </p>
        ) : null}
      </div>

      {saved ? (
        <div
          role="status"
          className="rounded-xl border border-primary bg-card p-4"
          data-testid="weekly-saved-card"
        >
          <p className="text-base font-semibold">{WEEKLY_SAVED_TITLE}</p>
          <p className="mt-1 text-sm text-muted-foreground">{WEEKLY_SAVED_TEXT}</p>
        </div>
      ) : null}

      <FormRenderer
        key={selectedId ?? ""}
        questions={questions}
        initialAnswers={initialAnswers}
        action={wrappedAction}
        submitLabel={editing ? UPDATE_WEEKLY_LABEL : SUBMIT_WEEKLY_LABEL}
        submitDisabled={!hasSelection}
      />
    </div>
  );
}

export type WeeklyFormProps = Omit<WeeklyFormViewProps, "onSelect">;

export function WeeklyForm(props: WeeklyFormProps) {
  const router = useRouter();
  return (
    <WeeklyFormView
      {...props}
      onSelect={(id) => {
        router.push(id === "" ? WEEKLY_PATH : `${WEEKLY_PATH}?newcomer=${encodeURIComponent(id)}`);
      }}
    />
  );
}
