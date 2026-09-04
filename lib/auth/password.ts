/**
 * Password rule for the change-password page (PLAN T07 / DECISIONS):
 * at least 8 characters, containing both a letter and a digit. Pure module
 * (no server-only) so the page, the action and unit tests share it.
 */
export const PASSWORD_MIN_LENGTH = 8;

export function meetsPasswordRule(password: string): boolean {
  return (
    password.length >= PASSWORD_MIN_LENGTH &&
    /[A-Za-z]/.test(password) &&
    /[0-9]/.test(password)
  );
}
