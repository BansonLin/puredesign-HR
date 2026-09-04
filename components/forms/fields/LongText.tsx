"use client";

import { Textarea } from "@/components/ui/textarea";

import { describedBy, type FieldProps } from "@/components/forms/FieldError";

/** `long_text`: multi-line textarea that grows with its content. */
export function LongText({
  question,
  id,
  value,
  onChange,
  disabled,
  errorId,
  helpId,
}: FieldProps) {
  return (
    <Textarea
      id={id}
      name={question.key}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={question.placeholder}
      disabled={disabled}
      required={question.required}
      rows={3}
      aria-invalid={errorId ? true : undefined}
      aria-describedby={describedBy(helpId, errorId)}
      className="min-h-24 text-base"
    />
  );
}
