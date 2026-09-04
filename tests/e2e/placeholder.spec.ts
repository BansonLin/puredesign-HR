import { test } from "@playwright/test";

/**
 * Obsolete since T27: the real smoke paths live in flow.spec.ts (newcomer →
 * manager → hr), authz.spec.ts (the four roles and their 403s) and
 * first-login.spec.ts. Kept as a skipped test rather than deleted
 * (CLAUDE.md §0: deleting a file needs a decision), so the T01 acceptance
 * (「`pnpm test:e2e` 本機 exit 0」) still has something to point at.
 */
test.skip("T01 placeholder — 已由 flow / authz / first-login 取代（T27）", async () => {});
