import Link from "next/link";

/**
 * Rendered by Next when a Server Component / Route Handler / Server Action
 * calls `forbidden()` (lib/auth/guard.ts) — HTTP 403. Requires
 * `experimental.authInterrupts` in next.config.ts (DECISIONS D-13).
 */
export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">沒有權限</h1>
      <p className="text-sm text-muted-foreground">
        您的帳號無法檢視這個頁面。若您認為這是錯誤，請聯絡 HR。
      </p>
      <Link href="/" className="text-sm underline underline-offset-4">
        回到首頁
      </Link>
    </main>
  );
}
