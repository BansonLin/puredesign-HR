/**
 * Field plumbing shared by FormRenderer and the six field components
 * (CLAUDE.md §8 / PLAN T13): the per-question error line, the props every
 * field receives, and the `aria-describedby` helper that ties help text and
 * error line to the control. Pure presentational; no data access.
 */
import type { Question } from "@/lib/forms/schema";

/** One `profiles` row offered by a `user_select` question (PLAN A12). */
export interface UserOption {
  id: string;
  display_name: string;
}

/**
 * Props of the six field components. They are pure: the value lives in
 * FormRenderer's state and `onChange` reports the raw string the user typed
 * (never trimmed here; `validateAnswers` normalizes on submit).
 */
export interface FieldProps {
  question: Question;
  /** DOM id of the control (or of the radio group). */
  id: string;
  /** Current raw value; `''` = empty. */
  value: string;
  onChange: (value: string) => void;
  /** Whole form is submitting: block edits so nothing changes mid-flight. */
  disabled?: boolean;
  /** Set when the question currently has an error (`aria-invalid` + describedby). */
  errorId?: string;
  /** Id of the help text paragraph, when the question has `help`. */
  helpId?: string;
}

/** `aria-describedby` built from the optional help / error ids. */
export function describedBy(helpId?: string, errorId?: string): string | undefined {
  const ids = [helpId, errorId].filter((v): v is string => Boolean(v));
  return ids.length === 0 ? undefined : ids.join(" ");
}

export function fieldErrorId(fieldId: string): string {
  return `${fieldId}-error`;
}

/** Error line rendered right under its field; announced to screen readers. */
export function FieldError({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
