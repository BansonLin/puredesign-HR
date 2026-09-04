"use client";

import { cn } from "@/components/ui/utils";

import { describedBy, type FieldProps, type UserOption } from "@/components/forms/FieldError";

/** Label shown when the stored id is no longer in the offered list (PLAN A12). */
export const REMOVED_USER_LABEL = "（已移除）";

/**
 * `user_select`: a native `<select>` (PLAN T13) whose options are the
 * `profiles` rows the server passed in (`userOptions`, PLAN A12); the answer
 * is the profile id. A stored id that is no longer offered is kept as a
 * selectable「（已移除）」row so an old answer is not silently dropped.
 */
export function UserSelect({
  question,
  id,
  value,
  onChange,
  disabled,
  errorId,
  helpId,
  userOptions,
}: FieldProps & { userOptions: readonly UserOption[] }) {
  const missing = value !== "" && !userOptions.some((option) => option.id === value);
  return (
    <select
      id={id}
      name={question.key}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      required={question.required}
      aria-invalid={errorId ? true : undefined}
      aria-describedby={describedBy(helpId, errorId)}
      className={cn(
        "border-input h-11 w-full min-w-0 rounded-md border bg-transparent px-3 text-base shadow-xs outline-none",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <option value="">{question.placeholder ?? "請選擇"}</option>
      {userOptions.map((option) => (
        <option key={option.id} value={option.id}>
          {option.display_name}
        </option>
      ))}
      {missing ? <option value={value}>{REMOVED_USER_LABEL}</option> : null}
    </select>
  );
}
