import { defineConfig, devices } from "@playwright/test";

// CLAUDE.md §8: mobile-first, 375px; run everything at a phone viewport.
// PLAN K6: workers=1 so e2e runs never overlap on a shared database.
const port = 3000;
const baseURL = process.env.APP_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  // Resets the Taipei-today logs of the four seed newcomers and re-runs
  // `pnpm db:seed`, so every run starts from the §11 fixture (PLAN T27).
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // CI gets the GitHub annotations plus an HTML report on disk, so the
  // `playwright-report/` directory the CI workflow uploads on failure really
  // exists next to the traces in `test-results/`.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  use: {
    baseURL,
    ...devices["Pixel 5"],
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm start",
    // Wait on the port, not on a URL: Playwright follows redirects when it
    // probes a URL, and `/` redirects to `/login`, whose own response depends
    // on the session — the port is the only signal that means "server up".
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
