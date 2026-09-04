import { describe, expect, it } from "vitest";

import { homeFor, safeNextPath, type UserRole } from "@/lib/auth/home";
import { meetsPasswordRule } from "@/lib/auth/password";

/**
 * PLAN T07 pure helpers (DECISIONS D-16): the landing page per role
 * (homeFor), the `?next=` sanitiser (safeNextPath — every open-redirect
 * shape is dropped, so is anything under /login) and the password rule
 * (meetsPasswordRule — at least 8 characters with a letter and a digit).
 */
describe("homeFor (CLAUDE.md §8 landing per role)", () => {
  it.each<[UserRole, string]>([
    ["newcomer", "/me/today"],
    ["manager", "/manager"],
    ["hr", "/hr"],
    ["admin", "/hr"],
    ["ceo", "/ceo"],
  ])("%s → %s", (role, home) => {
    expect(homeFor(role)).toBe(home);
  });
});

describe("safeNextPath (open-redirect guard)", () => {
  it.each<[string | null, string | null]>([
    [null, null],
    ["", null],
    ["/me/today?d=1", "/me/today?d=1"],
    ["//evil", null],
    ["/\\evil", null],
    ["https://evil", null],
    ["/login", null],
    ["/login/change-password", null],
  ])("%j → %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe("meetsPasswordRule (≥ 8 characters, letter + digit)", () => {
  it.each<[string, boolean]>([
    ["abc12345", true],
    ["abcdefgh", false],
    ["12345678", false],
    ["ab12", false],
  ])("%j → %s", (password, ok) => {
    expect(meetsPasswordRule(password)).toBe(ok);
  });
});
