import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session middleware (PLAN 5.5 / T07; §12 exception file, DECISIONS D-02).
 *
 * Responsibilities — and nothing more:
 *   1. Refresh the Supabase session cookie on every matched request so the
 *      30-day session (cookie maxAge + refresh-token rotation) stays alive.
 *   2. Send anonymous visitors of the signed-in areas to /login?next=…,
 *      and anonymous visitors of `/` to /login (no `next`: the root has
 *      nothing to return to, app/page.tsx only routes signed-in users, A13).
 *
 * It does NOT look at the role, profile status or must_change_password:
 * those checks need a profiles lookup (service role) and live in
 * lib/auth/guard.ts, which every page/action calls. Signed-in visitors of
 * /login are redirected by the login page itself (it knows the role).
 *
 * lib/auth/session.ts cannot be imported here (it imports next/headers and
 * server-only), so the ssr client and the 30-day constant are duplicated.
 */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Path prefixes that require a session (CLAUDE.md §8 / §9). */
const PROTECTED_PREFIXES = ["/me", "/manager", "/hr", "/ceo", "/admin"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isRoot(pathname: string): boolean {
  return pathname === "/";
}

/** Paths an anonymous visitor is redirected away from. */
function needsSession(pathname: string): boolean {
  return isRoot(pathname) || isProtected(pathname);
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    // Misconfigured deployment: fail closed on protected paths, let public
    // paths through (the pages will throw a clear "Missing environment
    // variable" error from lib/auth/session.ts).
    return needsSession(request.nextUrl.pathname)
      ? NextResponse.redirect(loginRedirect(request), 302)
      : response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
    cookieOptions: { maxAge: SESSION_MAX_AGE_SECONDS },
  });

  // getUser() (never getSession()) verifies the token with Supabase and, when
  // the access token has expired, rotates the refresh token and writes the
  // new cookies through setAll above.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && needsSession(request.nextUrl.pathname)) {
    // 302 (PLAN T07 acceptance) rather than Next's default 307.
    const redirect = NextResponse.redirect(loginRedirect(request), 302);
    // Keep any cookie changes (e.g. clearing an invalid session) on the redirect.
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }

  return response;
}

function loginRedirect(request: NextRequest): URL {
  const url = request.nextUrl.clone();
  const { pathname, search } = request.nextUrl;
  url.pathname = "/login";
  url.search = "";
  if (!isRoot(pathname)) url.searchParams.set("next", `${pathname}${search}`);
  return url;
}

export const config = {
  matcher: [
    /*
     * Everything except Next.js internals and static assets; /api is
     * included so Route Handlers also get a refreshed session cookie.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff2?)$).*)",
  ],
};
