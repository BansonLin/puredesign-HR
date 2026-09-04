"use client";

import { Input } from "@/components/ui/input";

import { describedBy, type FieldProps } from "@/components/forms/FieldError";

/**
 * `number`: a text input with `inputmode="numeric"` (PLAN T13) so phones show
 * the number pad; the value stays a string and `validateAnswers` checks it.
 */
export function NumberField({
  question,
  id,
  value,
  onChange,
  disabled,
  errorId,
  helpId,
}: FieldProps) {
  return (
    <Input
      id={id}
      name={question.key}
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={question.placeholder}
      disabled={disabled}
      required={question.required}
      autoComplete="off"
      aria-invalid={errorId ? true : undefined}
      aria-describedby={describedBy(helpId, errorId)}
      className="h-11"
    />
  );
}
