import { defineConfig, devices } from "@playwright/test";

// Load tests/e2e/.env when present (local runs). CI sets vars directly via
// the workflow env block, so the absence of the file is fine there.
try {
  process.loadEnvFile(".env");
} catch {
  /* no .env locally is fine if vars are exported in the shell */
}

// Phase 6 (cores): chromium-only via --project=chromium in CI; the other
// browser projects stay declared so the follow-up PR that adds them only
// has to enable them in the workflow.

const PORT_FRONTEND = 5173;
const PORT_BACKEND = 8000;

export default defineConfig({
  testDir: ".",
  testIgnore: ["fixtures/**", "smoke/**"],
  fullyParallel: false, // sequential; multi-context specs share the preview project
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["html"], ["github"]] : "html",
  use: {
    baseURL: process.env.BASE_URL ?? `http://localhost:${PORT_FRONTEND}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: `uvicorn app.main:app --port ${PORT_BACKEND}`,
      cwd: "../../backend",
      port: PORT_BACKEND,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `npm run dev -- --port ${PORT_FRONTEND} --strictPort`,
      cwd: "../../frontend",
      port: PORT_FRONTEND,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile", use: { ...devices["iPhone SE"] } },
  ],
});
