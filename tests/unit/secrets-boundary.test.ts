import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PLAN 5.5 / K8: the service role key must never leak past lib/db/admin.ts.
 *
 * 1. The string SUPABASE_SERVICE_ROLE_KEY may only appear in the allow-listed
 *    files (code and config; docs are not scanned).
 * 2. supabase/seed/** must not read the variable — seed imports lib/db/admin.ts.
 * 3. A file marked 'use client' must not import lib/db (service role client).
 *
 * Static scan only; robust to directories that do not exist yet (lib/db and
 * supabase/seed are produced by other tasks).
 */
const ROOT = join(__dirname, "..", "..");
const SELF = join("tests", "unit", "secrets-boundary.test.ts");

const SECRET_NAME = "SUPABASE_SERVICE_ROLE_KEY";
const ALLOWED_SECRET_FILES = new Set([
  join("lib", "db", "admin.ts"),
  // The only e2e file that may read the key: it exports
  // `createServiceRoleClient()` for the specs (T27, DECISIONS D-04).
  join("tests", "e2e", "global-setup.ts"),
  ".env.example",
  join(".github", "workflows", "ci.yml"),
]);

const SKIPPED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "out",
  "build",
  "dist",
  "coverage",
  "test-results",
  "playwright-report",
  "blob-report",
  ".temp",
  ".branches",
]);
const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".sql",
]);
const CLIENT_DIRS = ["app", "components", "lib"];
const SEED_DIR = join("supabase", "seed");

function isScannable(name: string): boolean {
  // Dotenv files: only the committed template is scanned. `.env.local` (and
  // any other `.env*`) is the developer's local secret store — CLAUDE.md §3
  // ("本機開發連 staging"), `.env.example` line 1 and `pnpm db:seed`
  // (`--env-file-if-exists=.env.local`) all require it to hold the real service role
  // key — and it is git-ignored (`.env`, `.env.*`), so it is out of scope.
  if (name.startsWith(".env")) return name === ".env.example";
  return [...SCANNED_EXTENSIONS].some((ext) => name.endsWith(ext));
}

function listFiles(dir: string, filter: (name: string) => boolean): string[] {
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
    if (isDir) {
      if (!SKIPPED_DIRS.has(entry)) files.push(...listFiles(full, filter));
    } else if (filter(entry)) {
      files.push(full);
    }
  }
  return files;
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

function isUnder(rel: string, dir: string): boolean {
  return rel === dir || rel.startsWith(dir + sep);
}

/** 'use client' directive in the leading statements of a module. */
function isClientModule(source: string): boolean {
  const head = source
    .replace(/^\uFEFF/, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .trimStart();
  return /^(['"])use client\1;?/.test(head);
}

/** import/export/require/dynamic-import sources of a module. */
function importSources(source: string): string[] {
  const sources: string[] = [];
  const patterns = [
    /\b(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])([^'"]+)\1/g,
    /\bimport\s*(['"])([^'"]+)\1/g,
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
    /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      sources.push(match[2]);
    }
  }
  return sources;
}

function importsLibDb(file: string, sources: string[]): boolean {
  const fileDir = join(file, "..");
  return sources.some((spec) => {
    if (spec === "@/lib/db" || spec.startsWith("@/lib/db/")) return true;
    if (spec.startsWith(".")) {
      const resolved = relative(ROOT, join(fileDir, spec));
      return isUnder(resolved, join("lib", "db"));
    }
    return false;
  });
}

describe("secrets boundary", () => {
  it(`${SECRET_NAME} appears only in the allow-listed files`, () => {
    const offenders: string[] = [];
    for (const file of listFiles(ROOT, isScannable)) {
      const rel = relative(ROOT, file);
      if (rel === SELF || ALLOWED_SECRET_FILES.has(rel)) continue;
      if (read(file).includes(SECRET_NAME)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("supabase/seed/** never reads the service role key directly", () => {
    const offenders: string[] = [];
    for (const file of listFiles(join(ROOT, SEED_DIR), isScannable)) {
      const source = read(file);
      if (
        source.includes(SECRET_NAME) ||
        /\bSERVICE_ROLE_KEY\b/.test(source)
      ) {
        offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("'use client' files never import lib/db", () => {
    const offenders: string[] = [];
    const isSource = (name: string) =>
      [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].some((ext) =>
        name.endsWith(ext),
      );
    for (const dir of CLIENT_DIRS) {
      for (const file of listFiles(join(ROOT, dir), isSource)) {
        const source = read(file);
        if (!isClientModule(source)) continue;
        if (importsLibDb(file, importSources(source))) {
          offenders.push(relative(ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
