import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/session";

/**
 * Signed-in pages (/me, /manager, /hr, /ceo): app header with the logout
 * button (PLAN T07; §12 exception file, DECISIONS D-02). Role checks are
 * not done here — every page under this layout calls requireRole() itself
 * (tests/unit/guard-coverage.test.ts).
 */
async function logout(): Promise<void> {
  "use server";
  await signOut();
  redirect("/login");
}

export default function FrontLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex h-12 w-full max-w-screen-md items-center justify-between gap-2 px-4">
          <span className="truncate text-sm font-semibold">璞石新人支持系統</span>
          <form action={logout}>
            <Button type="submit" variant="outline" size="sm">
              登出
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-screen-md flex-1 px-4 py-4">
        {children}
      </main>
    </div>
  );
}
