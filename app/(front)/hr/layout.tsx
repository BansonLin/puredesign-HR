import { AppNav, type AppNavItem } from "@/components/dashboard/AppNav";

/**
 * /hr/* shell (CLAUDE.md §8, PLAN T20): section tabs under the app header.
 * No guard here — every page under it calls requireRole(['hr','admin']) /
 * requireNewcomerAccess() itself (tests/unit/guard-coverage.test.ts).
 * Phase 1 has a single tab; /hr/newcomer/[id] (T25) is reached from the
 * dashboard lists, not from the tab row.
 */
const HR_NAV: readonly AppNavItem[] = [{ href: "/hr", label: "儀表板" }];

export default function HrLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex flex-col gap-4">
      <AppNav items={HR_NAV} label="人資選單" />
      {children}
    </div>
  );
}
