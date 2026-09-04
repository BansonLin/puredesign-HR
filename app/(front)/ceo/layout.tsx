import { AppNav, type AppNavItem } from "@/components/dashboard/AppNav";

/**
 * /ceo/* shell (CLAUDE.md §8, PLAN T26): section tabs under the app header,
 * mirroring /hr's layout. No guard here — the page calls
 * requireRole(['ceo']) itself (tests/unit/guard-coverage.test.ts).
 *
 * The CEO view is read-only: this row holds links only (no button / form),
 * and Phase 1 has a single destination, the dashboard itself.
 */
const CEO_NAV: readonly AppNavItem[] = [{ href: "/ceo", label: "儀表板" }];

export default function CeoLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex flex-col gap-4">
      <AppNav items={CEO_NAV} label="經營選單" />
      {children}
    </div>
  );
}
