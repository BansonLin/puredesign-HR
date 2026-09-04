import type { Metadata } from "next";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireRole } from "@/lib/auth/guard";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password";

import { changePassword } from "./actions";

export const metadata: Metadata = { title: "設定新密碼" };

type SearchParams = Record<string, string | string[] | undefined>;

const ALL_ROLES = ["newcomer", "manager", "hr", "ceo", "admin"] as const;

const ERROR_MESSAGES: Record<string, string> = {
  weak: `密碼長度至少 ${PASSWORD_MIN_LENGTH} 個字元，且必須同時包含英文字母與數字。`,
  mismatch: "兩次輸入的密碼不一致，請重新輸入。",
  same: "新密碼不可與舊密碼相同。",
  failed: "密碼更新失敗，請稍後再試；若持續發生請聯絡 HR。",
  flag_failed: "密碼可能已更新，請重新登入後再試。",
};

/**
 * /login/change-password (PLAN T07): forced on first login
 * (profiles.must_change_password). requireRole() with
 * allowPasswordChangePending handles no-session / no-profile / disabled
 * (DECISIONS D-13); every role may reach this page.
 */
export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const profile = await requireRole(ALL_ROLES, {
    allowPasswordChangePending: true,
  });
  const params = await searchParams;
  const errorParam = params.error;
  const error = Array.isArray(errorParam) ? errorParam[0] : errorParam;
  const message = error ? (ERROR_MESSAGES[error] ?? null) : null;

  return (
    <form action={changePassword} className="flex flex-col gap-5" noValidate>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">設定新密碼</h2>
        <p className="text-sm text-muted-foreground">
          {profile.display_name}，
          {profile.must_change_password
            ? "第一次登入請先設定您自己的密碼。"
            : "請輸入您的新密碼。"}
          密碼長度至少 {PASSWORD_MIN_LENGTH} 個字元，且需同時包含英文字母與數字。
        </p>
      </div>
      {message ? (
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">新密碼</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
          className="h-11"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">確認新密碼</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
          className="h-11"
        />
      </div>
      <Button type="submit" data-primary className="w-full">
        儲存並繼續
      </Button>
    </form>
  );
}
