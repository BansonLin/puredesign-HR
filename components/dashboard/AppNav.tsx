"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/components/ui/utils";

/**
 * Section navigation under the app header (CLAUDE.md §8, PLAN T15): one
 * row of equally sized tab links, each at least 44px tall for the 375px /
 * LINE in-app browser case. The current item is derived from the pathname,
 * which is why this is a client component; it touches no data and no dates.
 *
 * Exactly ONE item may be current: nav sets nest (`/manager` is a prefix of
 * `/manager/weekly`), so a plain prefix test would mark both as
 * `aria-current="page"` on /manager/weekly. `currentNavHref` therefore keeps
 * the LONGEST matching href and only that one is marked.
 */
export interface AppNavItem {
  href: string;
  label: string;
}

export interface AppNavProps {
  items: readonly AppNavItem[];
  /** Accessible name of the `<nav>`; defaults to 「主選單」. */
  label?: string;
}

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The href of the single current item: the longest of the items that match
 * `pathname` exactly or as a parent path, or null when none does. Ties (the
 * same href listed twice) keep the first occurrence.
 */
export function currentNavHref(pathname: string, items: readonly AppNavItem[]): string | null {
  let current: string | null = null;
  for (const item of items) {
    if (!matches(pathname, item.href)) continue;
    if (current === null || item.href.length > current.length) current = item.href;
  }
  return current;
}

export function AppNav({ items, label = "主選單" }: AppNavProps) {
  const pathname = usePathname();
  const currentHref = currentNavHref(pathname, items);
  return (
    <nav aria-label={label} className="-mx-4 border-b bg-background">
      <ul className="flex">
        {items.map((item) => {
          const current = item.href === currentHref;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center justify-center border-b-2 px-2 text-sm font-medium",
                  current
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
