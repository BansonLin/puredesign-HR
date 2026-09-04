"use client";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/components/ui/utils";

import { describedBy, type FieldProps } from "@/components/forms/FieldError";

/**
 * `single_select` as a radio group (PLAN T13): every option is one full-width
 * row of at least 44px, and the whole row is the `<label>` of its radio, so a
 * tap anywhere on the text selects it. The value is not carried by Radix's
 * own hidden input — FormRenderer emits `<input type="hidden">` per question —
 * so the group deliberately has no `name`. The group is always controlled
 * (`value={value}`): `''` matches no option, so clearing the value unchecks
 * every item instead of flipping Radix into uncontrolled mode.
 */
export function SingleSelect({
  question,
  id,
  value,
  onChange,
  disabled,
  errorId,
  helpId,
}: FieldProps) {
  const options = question.options ?? [];
  return (
    <RadioGroup
      id={id}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      required={question.required}
      aria-labelledby={`${id}-label`}
      aria-invalid={errorId ? true : undefined}
      aria-describedby={describedBy(helpId, errorId)}
      className="gap-2"
    >
      {options.map((option, index) => {
        const itemId = `${id}-opt-${index}`;
        const checked = value === option;
        return (
          <label
            key={option}
            htmlFor={itemId}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-base",
              "has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-accent",
              disabled && "cursor-not-allowed opacity-70",
            )}
            data-checked={checked ? "true" : undefined}
          >
            <RadioGroupItem id={itemId} value={option} />
            <span className="flex-1 leading-snug">{option}</span>
          </label>
        );
      })}
    </RadioGroup>
  );
}
