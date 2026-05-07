// Smoke-only Playwright config.
//
// Differs from tests/e2e/playwright.config.ts by omitting the `webServer`
// block; smoke specs hit a live deployment, not a locally-spun stack.
//
// Lives under tests/e2e/ rather than tests/smoke/ because @playwright/test
// is installed in tests/e2e/node_modules and Node's module resolution
// can't reach across siblings.
//
// Run from tests/e2e:
//   cd tests/e2e
//   BASE_URL=https://soundclash.org npx playwright test --config smoke/playwright.smoke.config.ts

import { defineConfig, devices } from "@playwright/test";

const DEFAULT_BASE_URL = "https://soundclash.org";

export default defineConfig({
  testDir: ".",
  testIgnore: ["**/playwright.smoke.config.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["html"], ["github"]] : "html",
  use: {
    baseURL: process.env.BASE_URL ?? DEFAULT_BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
