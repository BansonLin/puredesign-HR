import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PLAN K4: every date computation must go through lib/time (Asia/Taipei via
 * APP_TIMEZONE). The local-time Date accessors below silently depend on the
 * runtime's TZ (Vercel and CI are UTC), so they are banned outside lib/time.
 */
const ROOT = join(__dirname, "..", "..");
const SCANNED_DIRS = ["lib", "app"];
const EXEMPT_DIR = join("lib", "time");
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const BANNED = [
  { pattern: /\.getDate\(\)/, label: "getDate()" },
  { pattern: /\.getHours\(\)/, label: "getHours()" },
  { pattern: /\.getDay\(\)/, label: "getDay()" },
  { pattern: /\.toLocaleDateString\(/, label: "toLocaleDateString(" },
];

function listSourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if ([...EXTENSIONS].some((ext) => entry.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

describe("timezone lint (lib/, app/)", () => {
  it("does not use local-time Date accessors outside lib/time", () => {
    const violations: string[] = [];
    for (const dir of SCANNED_DIRS) {
      for (const file of listSourceFiles(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        if (rel === EXEMPT_DIR || rel.startsWith(EXEMPT_DIR + sep)) continue;
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, index) => {
          for (const { pattern, label } of BANNED) {
            if (pattern.test(line)) {
              violations.push(`${rel}:${index + 1} uses ${label}`);
            }
          }
        });
      }
    }
    expect(violations).toEqual([]);
  });
});
