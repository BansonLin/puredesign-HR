"use client";

/**
 * Form engine renderer (CLAUDE.md §6 / §8, PLAN T13).
 *
 * Renders one published version's questions for the person filling it in.
 * Pure client component: no data access (secrets boundary), no date math.
 * - `useState` holds the raw answers; visibility is recomputed on every
 *   change with `resolveVisibility` (chained `show_if`, A11 / D-15).
 * - `useActionState` wraps the Server Action the page passes in; the action
 *   receives the FormData of the visible questions (hidden ones are absent
 *   → `null` after `validateAnswers`) and returns a `FormActionState`.
 * - Before the action runs, `validateAnswers` runs client-side; errors show
 *   under their question and the first one is scrolled into view. Errors the
 *   action returns are shown the same way.
 * - While the action is pending every control and the submit button are
 *   disabled (no double submit).
 * - `beforeQuestion(q)` lets /me/today put yesterday's plan text above the
 *   `r{i}_status` questions without a second renderer.
 */
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  FieldError,
  fieldErrorId,
  type FieldProps,
  type UserOption,
} from "@/components/forms/FieldError";
import { DateField } from "@/components/forms/fields/DateField";
import { LongText } from "@/components/forms/fields/LongText";
import { NumberField } from "@/components/forms/fields/NumberField";
import { ShortText } from "@/components/forms/fields/ShortText";
import { SingleSelect } from "@/components/forms/fields/SingleSelect";
import { UserSelect } from "@/components/forms/fields/UserSelect";
import { resolveVisibility } from "@/lib/forms/resolve";
import type { Answers, Question } from "@/lib/forms/schema";
import { validateAnswers } from "@/lib/forms/validate";

/**
 * What the Server Action returns (and what `useActionState` keeps between
 * submits). `errors` is keyed by question key, like `validateAnswers`;
 * `message` is a form-level notice (shown as an alert, destructive when
 * `ok` is false).
 */
export interface FormActionState {
  ok: boolean;
  errors?: Record<string, string>;
  message?: string;
}

export type FormAction = (
  previousState: FormActionState,
  formData: FormData,
) => Promise<FormActionState>;

export const INITIAL_FORM_STATE: FormActionState = { ok: true };

export interface FormRendererProps {
  /** Questions of the version, already parsed (`parseQuestions`). */
  questions: readonly Question[];
  /** Existing answers to edit (today's log, PLAN §8); `null` = empty form. */
  initialAnswers?: Answers | null;
  /** Rows offered by `user_select` questions (server-filtered by role, A12). */
  userOptions?: readonly UserOption[];
  action: FormAction;
  submitLabel: string;
  /**
   * Rendered above a question (between its label block and the previous one).
   * Context the action needs beyond the answers (target log, date) is bound by
   * the page with `action.bind(null, …)`, not passed through here.
   */
  beforeQuestion?: (question: Question) => ReactNode;
  className?: string;
}

/** DOM id of a question's control / group; used for scrolling to errors. */
export function questionFieldId(key: string): string {
  return `q-${key}`;
}

function toRawAnswers(questions: readonly Question[], initial: Answers | null | undefined) {
  const raw: Record<string, string> = {};
  for (const q of questions) raw[q.key] = initial?.[q.key] ?? "";
  return raw;
}

function scrollToQuestion(key: string) {
  if (typeof document === "undefined") return;
  const element = document.getElementById(questionFieldId(key));
  if (!element) return;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  if (element instanceof HTMLElement && element.tagName !== "DIV") element.focus();
}

function FieldControl({
  question,
  userOptions,
  ...props
}: FieldProps & { userOptions: readonly UserOption[] }) {
  switch (question.type) {
    case "single_select":
      return <SingleSelect question={question} {...props} />;
    case "short_text":
      return <ShortText question={question} {...props} />;
    case "long_text":
      return <LongText question={question} {...props} />;
    case "date":
      return <DateField question={question} {...props} />;
    case "number":
      return <NumberField question={question} {...props} />;
    case "user_select":
      return <UserSelect question={question} userOptions={userOptions} {...props} />;
  }
}

export function FormRenderer({
  questions,
  initialAnswers,
  userOptions = [],
  action,
  submitLabel,
  beforeQuestion,
  className,
}: FormRendererProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    toRawAnswers(questions, initialAnswers),
  );
  const [clientErrors, setClientErrors] = useState<Record<string, string> | null>(null);
  const [state, formAction, isPending] = useActionState(action, INITIAL_FORM_STATE);
  const lastServerState = useRef(state);

  const { visible } = resolveVisibility(questions, answers);
  const errors = clientErrors ?? state.errors ?? {};

  // Errors returned by the Server Action: scroll to the first one, in
  // display order, once per new state object.
  useEffect(() => {
    if (lastServerState.current === state) return;
    lastServerState.current = state;
    if (!state.errors) return;
    const first = visible.find((q) => state.errors?.[q.key]);
    if (first) scrollToQuestion(first.key);
  }, [state, visible]);

  function setAnswer(key: string, value: string) {
    setAnswers((previous) => ({ ...previous, [key]: value }));
    if (clientErrors?.[key]) {
      setClientErrors((previous) => {
        if (!previous) return previous;
        const next = { ...previous };
        delete next[key];
        return Object.keys(next).length === 0 ? null : next;
      });
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (isPending) {
      event.preventDefault();
      return;
    }
    const result = validateAnswers(questions, answers);
    if (result.ok) {
      setClientErrors(null);
      return; // let the form action run
    }
    event.preventDefault();
    setClientErrors(result.errors);
    const first = visible.find((q) => result.errors[q.key]);
    if (first) scrollToQuestion(first.key);
  }

  return (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      noValidate
      aria-busy={isPending || undefined}
      className={className ?? "flex flex-col gap-6"}
    >
      {state.message ? (
        <Alert variant={state.ok ? "default" : "destructive"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {visible.map((question) => {
        const id = questionFieldId(question.key);
        const error = errors[question.key];
        const errorId = error ? fieldErrorId(id) : undefined;
        const helpId = question.help ? `${id}-help` : undefined;
        const value = answers[question.key] ?? "";
        const isGroup = question.type === "single_select";
        return (
          <div key={question.key} className="flex flex-col gap-2" data-question={question.key}>
            {beforeQuestion?.(question)}
            {isGroup ? (
              <span id={`${id}-label`} className="text-sm font-medium leading-none">
                {question.label}
                {question.required ? <RequiredMark /> : null}
              </span>
            ) : (
              <Label htmlFor={id}>
                {question.label}
                {question.required ? <RequiredMark /> : null}
              </Label>
            )}
            {question.help ? (
              <p id={helpId} className="text-sm text-muted-foreground">
                {question.help}
              </p>
            ) : null}
            {isGroup ? <input type="hidden" name={question.key} value={value} /> : null}
            <FieldControl
              question={question}
              id={id}
              value={value}
              onChange={(next) => setAnswer(question.key, next)}
              disabled={isPending}
              errorId={errorId}
              helpId={helpId}
              userOptions={userOptions}
            />
            <FieldError id={errorId ?? fieldErrorId(id)} message={error} />
          </div>
        );
      })}
      <Button type="submit" data-primary className="w-full" disabled={isPending}>
        {isPending ? "送出中…" : submitLabel}
      </Button>
    </form>
  );
}

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden="true">
      *
    </span>
  );
}

export type { UserOption };
