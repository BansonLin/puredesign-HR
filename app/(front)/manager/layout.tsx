import { AppNav, type AppNavItem } from "@/components/dashboard/AppNav";

/**
 * /manager/* shell (CLAUDE.md §8, PLAN T17): section tabs under the app
 * header. No guard here — every page under it calls requireRole() /
 * requireNewcomerAccess() itself (tests/unit/guard-coverage.test.ts).
 * /manager/weekly is PLAN T22; the link is in place so the tab row does not
 * change shape later.
 */
const MANAGER_NAV: readonly AppNavItem[] = [
  { href: "/manager", label: "我的新人" },
  { href: "/manager/weekly", label: "週回饋" },
];

export default function ManagerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex flex-col gap-4">
      <AppNav items={MANAGER_NAV} label="主管選單" />
      {children}
    </div>
  );
}
