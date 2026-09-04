/**
 * Pre-auth pages (/login, /login/change-password): a single centred column,
 * mobile-first at 375px (CLAUDE.md §8). No navigation, no logout button.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-8">
      <header className="space-y-1 text-center">
        <h1 className="text-xl font-semibold">璞石新人支持系統</h1>
      </header>
      {children}
    </main>
  );
}
