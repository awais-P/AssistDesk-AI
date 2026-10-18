import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Demo/test settings from .env.demo (see .env.demo.example), if the file exists. Values already
// set in the shell (e.g. by scripts/tests-env.ps1) win.
if (existsSync(".env.demo")) {
  process.loadEnvFile(".env.demo");
}
if (!process.env.E2E_BASE_URL && process.env.DEMO_PORT) {
  process.env.E2E_BASE_URL = `http://localhost:${process.env.DEMO_PORT}`;
}

/**
 * Browser UI tests (system level). They drive a running AssistDesk server in
 * Chrome, the way a user would, and check the screen-level requirements of the
 * SRS (FR-1 … FR-17).
 *
 *   npm run demo        (once, in its own window: starts the demo/test server)
 *   npm run test:ui     (settings come from .env.demo)
 *
 * Use a throwaway database: the tests create (and clean up) agents, chatbots,
 * prompts, tickets and accounts. See tests/ui/README.md.
 */
export default defineConfig({
  testDir: "./tests/ui",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/ui/global-setup.ts",
  // One worker: the tests share the demo workspace, and dev mode compiles routes on first use.
  workers: 1,
  fullyParallel: false,
  retries: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["json", { outputFile: "test-results/ui-results.json" }], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 900 },
    navigationTimeout: 90_000,
    actionTimeout: 20_000,
    storageState: "tests/ui/.auth/admin.json",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
