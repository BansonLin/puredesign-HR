import { AppNav, type AppNavItem } from "@/components/dashboard/AppNav";

/**
 * /me/* (newcomer) shell: section tabs under the app header (PLAN T15).
 * No guard here — every page under it calls requireRole(['newcomer'])
 * itself (tests/unit/guard-coverage.test.ts). /me/history is PLAN T21; the
 * link is already in place so the tab row does not change shape later.
 */
const NEWCOMER_NAV: readonly AppNavItem[] = [
  { href: "/me/today", label: "今日日誌" },
  { href: "/me/history", label: "歷史" },
];

export default function MeLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex flex-col gap-4">
      <AppNav items={NEWCOMER_NAV} label="新人選單" />
      {children}
    </div>
  );
}
