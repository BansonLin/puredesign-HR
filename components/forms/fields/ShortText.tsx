"use client";

import { Input } from "@/components/ui/input";

import { describedBy, type FieldProps } from "@/components/forms/FieldError";

/** `short_text`: one-line input, 44px tall for phones (CLAUDE.md §8). */
export function ShortText({
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
