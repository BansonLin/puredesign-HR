import { describe, expect, it } from "vitest";

import { currentNavHref, type AppNavItem } from "@/components/dashboard/AppNav";

/**
 * `AppNav` marks exactly one item `aria-current="page"` (CLAUDE.md §8 mobile
 * navigation). The nav sets nest — `/manager` is a prefix of
 * `/manager/weekly` — so the current item is the LONGEST matching href, not
 * every matching one. Only the pure `currentNavHref` is exercised here:
 * `AppNav` itself reads `usePathname()` and needs the app-router context,
 * which the react-dom/server harness (no jsdom, no extra dependency) does not
 * provide.
 */

const MANAGER_NAV: readonly AppNavItem[] = [
  { href: "/manager", label: "我的新人" },
  { href: "/manager/weekly", label: "週回饋" },
];

const NEWCOMER_NAV: readonly AppNavItem[] = [
  { href: "/me/today", label: "今日日誌" },
  { href: "/me/history", label: "歷史" },
];

describe("currentNavHref", () => {
  it("on /manager/weekly only 週回饋 is current (not the /manager prefix)", () => {
    expect(currentNavHref("/manager/weekly", MANAGER_NAV)).toBe("/manager/weekly");
  });

  it("on /manager and its other sub-paths 我的新人 is current", () => {
    expect(currentNavHref("/manager", MANAGER_NAV)).toBe("/manager");
    expect(currentNavHref("/manager/newcomer/abc", MANAGER_NAV)).toBe("/manager");
  });

  it("matches a sub-path of the longer item too, and a sibling prefix does not steal it", () => {
    expect(currentNavHref("/manager/weekly/2026-08-31", MANAGER_NAV)).toBe("/manager/weekly");
    expect(currentNavHref("/managerial", MANAGER_NAV)).toBeNull();
  });

  it("flat navs keep exact matching; an unrelated path has no current item", () => {
    expect(currentNavHref("/me/today", NEWCOMER_NAV)).toBe("/me/today");
    expect(currentNavHref("/me/history", NEWCOMER_NAV)).toBe("/me/history");
    expect(currentNavHref("/hr", NEWCOMER_NAV)).toBeNull();
    expect(currentNavHref("/me/today", [])).toBeNull();
  });
});
