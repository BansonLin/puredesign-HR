import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { homeFor, safeNextPath } from "@/lib/auth/home";
import { getSessionUser } from "@/lib/auth/session";
import { getProfileByAuthId } from "@/lib/db/queries/profiles";

import { login } from "./actions";

export const metadata: Metadata = { title: "登入" };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Messages keyed by `?reason=` (guard.ts / actions.ts) and `?error=` (actions.ts). */
const REASON_MESSAGES: Record<string, string> = {
  disabled: "帳號已停用，請聯絡 HR。",
  no_profile: "此帳號尚未建立人員資料，請聯絡 HR。",
};
const ERROR_MESSAGES: Record<string, string> = {
  invalid: "帳號或密碼錯誤",
};

/**
 * /login (PLAN T07): 帳號 + 密碼 only — the Supabase address
 * `{username}@pure.internal` is an implementation detail that never appears
 * here. A visitor who is already signed in (valid session + usable profile)
 * is sent straight to `next` or homeFor(role); a stale session whose profile
 * is missing/disabled simply sees the form again (signing in replaces it).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  const reason = first(params.reason);
  const error = first(params.error);

  const user = await getSessionUser();
  if (user) {
    const profile = await getProfileByAuthId(user.id);
    if (profile && profile.status !== "left") {
      redirect(
        profile.must_change_password
          ? "/login/change-password"
          : (next ?? homeFor(profile.role)),
      );
    }
  }

  const message =
    (error && ERROR_MESSAGES[error]) ||
    (reason && REASON_MESSAGES[reason]) ||
    null;

  return (
    <form action={login} className="flex flex-col gap-5" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {message ? (
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="username">帳號</Label>
        <Input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          required
          className="h-11"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">密碼</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-11"
        />
      </div>
      <Button type="submit" data-primary className="w-full">
        登入
      </Button>
    </form>
  );
}
