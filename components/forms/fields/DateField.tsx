"use client";

import { Input } from "@/components/ui/input";

import { describedBy, type FieldProps } from "@/components/forms/FieldError";

/**
 * `date`: the native picker (`<input type="date">`, PLAN T13). The value is
 * always `YYYY-MM-DD`, exactly what `validateAnswers` / `isDateString` expect.
 */
export function DateField({
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
      type="date"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={question.placeholder}
      disabled={disabled}
      required={question.required}
      aria-invalid={errorId ? true : undefined}
      aria-describedby={describedBy(helpId, errorId)}
      className="h-11"
    />
  );
}
