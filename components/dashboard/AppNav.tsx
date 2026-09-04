"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/components/ui/utils";

/**
 * Section navigation under the app header (CLAUDE.md §8, PLAN T15): one
 * row of equally sized tab links, each at least 44px tall for the 375px /
 * LINE in-app browser case. The current item is derived from the pathname
 * (exact match or a sub-path), which is why this is a client component; it
 * touches no data and no dates.
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

function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav({ items, label = "主選單" }: AppNavProps) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="-mx-4 border-b bg-background">
      <ul className="flex">
        {items.map((item) => {
          const current = isCurrent(pathname, item.href);
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
