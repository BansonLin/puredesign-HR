import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import {
  AppNav,
  currentNavHref,
  currentNavIndex,
  type AppNavItem,
} from "@/components/dashboard/AppNav";

/**
 * `AppNav` marks exactly one item `aria-current="page"` (CLAUDE.md §8 mobile
 * navigation). The nav sets nest — `/manager` is a prefix of
 * `/manager/weekly` — so the current item is the LONGEST matching href, not
 * every matching one. `currentNavHref` resolves that href, `currentNavIndex`
 * turns it into the index the component actually renders from (D-53), and the
 * rendered case below counts `aria-current="page"` in the markup so the
 * duplicate-href behaviour is pinned end to end. `usePathname()` is mocked
 * because the react-dom/server harness (no jsdom, no extra dependency) has no
 * app-router context.
 */

/** Render `AppNav` at `pathname` and return the static markup. */
function render(pathname: string, items: readonly AppNavItem[]): string {
  nav.pathname = pathname;
  return renderToStaticMarkup(<AppNav items={items} />);
}

/** How many items the rendered nav marks as the current page. */
function currentCount(html: string): number {
  return html.match(/aria-current="page"/g)?.length ?? 0;
}

const MANAGER_NAV: readonly AppNavItem[] = [
  { href: "/manager", label: "我的新人" },
  { href: "/manager/weekly", label: "週回饋" },
];

const NEWCOMER_NAV: readonly AppNavItem[] = [
  { href: "/me/today", label: "今日日誌" },
  { href: "/me/history", label: "歷史" },
];

/** A nav that lists the same href twice — the case index resolution exists for. */
const DUPLICATED_NAV: readonly AppNavItem[] = [
  { href: "/manager", label: "我的新人" },
  { href: "/manager", label: "我的新人（重複）" },
  { href: "/manager/weekly", label: "週回饋" },
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

  it("a nav that lists the same href twice resolves to that href (AppNav then marks the FIRST of them, by index)", () => {
    expect(currentNavHref("/manager", DUPLICATED_NAV)).toBe("/manager");
    expect(currentNavHref("/manager/newcomer/abc", DUPLICATED_NAV)).toBe("/manager");
  });

  it("flat navs keep exact matching; an unrelated path has no current item", () => {
    expect(currentNavHref("/me/today", NEWCOMER_NAV)).toBe("/me/today");
    expect(currentNavHref("/me/history", NEWCOMER_NAV)).toBe("/me/history");
    expect(currentNavHref("/hr", NEWCOMER_NAV)).toBeNull();
    expect(currentNavHref("/me/today", [])).toBeNull();
  });
});

describe("currentNavIndex", () => {
  it("is the index the longest match sits at, and null when nothing matches", () => {
    expect(currentNavIndex("/manager/weekly", MANAGER_NAV)).toBe(1);
    expect(currentNavIndex("/manager/newcomer/abc", MANAGER_NAV)).toBe(0);
    expect(currentNavIndex("/managerial", MANAGER_NAV)).toBeNull();
    expect(currentNavIndex("/me/today", [])).toBeNull();
  });

  // The href alone cannot tell the two `/manager` entries apart, which is why
  // the component renders from the index instead of the href (D-53).
  it("picks the FIRST of two identical hrefs, and stays null for a sibling prefix", () => {
    expect(currentNavIndex("/manager", DUPLICATED_NAV)).toBe(0);
    expect(currentNavIndex("/managerial", DUPLICATED_NAV)).toBeNull();
  });
});

describe("AppNav rendering", () => {
  it("marks exactly one item aria-current, even when an href is listed twice", () => {
    expect(currentCount(render("/manager", DUPLICATED_NAV))).toBe(1);
    expect(currentCount(render("/manager/newcomer/abc", DUPLICATED_NAV))).toBe(1);
    expect(currentCount(render("/manager/weekly", DUPLICATED_NAV))).toBe(1);
  });

  it("marks the longest match in a nested nav, and nothing on an unrelated path", () => {
    expect(render("/manager/weekly", MANAGER_NAV)).toMatch(
      /aria-current="page"[^>]*href="\/manager\/weekly"/,
    );
    expect(currentCount(render("/manager/weekly", MANAGER_NAV))).toBe(1);
    expect(currentCount(render("/managerial", MANAGER_NAV))).toBe(0);
  });
});
