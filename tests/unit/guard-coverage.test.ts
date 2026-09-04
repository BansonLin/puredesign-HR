import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PLAN T08 / CLAUDE.md §3: every page, Server Action module and Route
 * Handler must go through lib/auth/guard.ts. Static scan of
 *   app/**\/page.tsx, app/**\/actions.ts, app/api/**\/route.ts
 * for a call to requireRole( / requireNewcomerAccess( / can(.
 *
 * Whitelist: app/page.tsx (role-based redirect, A13), app/(auth)/** (login
 * and change-password are pre-auth by definition), app/forbidden.tsx
 * (403 page; not a page.tsx anyway, listed for clarity).
 *
 * Passes on an empty set: the scan is robust to app/ subtrees that other
 * tasks have not created yet.
 */
const ROOT = join(__dirname, "..", "..");
const APP_DIR = join(ROOT, "app");

const WHITELIST_FILES = new Set([
  join("app", "page.tsx"),
  join("app", "forbidden.tsx"),
]);
const WHITELIST_DIRS = [join("app", "(auth)")];

const GUARD_CALL = /\b(?:requireRole|requireNewcomerAccess|can)\(/;

function isUnder(rel: string, dir: string): boolean {
  return rel === dir || rel.startsWith(dir + sep);
}

function listFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) files.push(...listFiles(full));
    else files.push(full);
  }
  return files;
}

/** Files that must call the guard, as repo-relative paths. */
function guardedFiles(): string[] {
  return listFiles(APP_DIR)
    .map((file) => relative(ROOT, file))
    .filter((rel) => {
      const base = rel.slice(rel.lastIndexOf(sep) + 1);
      if (base === "page.tsx" || base === "actions.ts") return true;
      if (base === "route.ts" && isUnder(rel, join("app", "api"))) return true;
      return false;
    })
    .filter((rel) => !WHITELIST_FILES.has(rel))
    .filter((rel) => !WHITELIST_DIRS.some((dir) => isUnder(rel, dir)))
    .sort();
}

describe("guard coverage (app/**/page.tsx, actions.ts, app/api/**/route.ts)", () => {
  it("every guarded file calls requireRole( / requireNewcomerAccess( / can(", () => {
    const offenders: string[] = [];
    for (const rel of guardedFiles()) {
      const source = readFileSync(join(ROOT, rel), "utf8");
      if (!GUARD_CALL.test(source)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("whitelisted files are excluded from the scan", () => {
    const files = guardedFiles();
    expect(files).not.toContain(join("app", "page.tsx"));
    expect(files.some((rel) => isUnder(rel, join("app", "(auth)")))).toBe(false);
  });
});
