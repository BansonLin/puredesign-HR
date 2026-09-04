import { defineConfig, devices } from "@playwright/test";

// CLAUDE.md §8: mobile-first, 375px; run everything at a phone viewport.
// PLAN K6: workers=1 so e2e runs never overlap on a shared database.
const port = 3000;
const baseURL = process.env.APP_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
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
    // probes a URL, and `/` redirects to `/login`, which does not exist until
    // T06/T07 (a 404 would keep the probe waiting until timeout).
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
