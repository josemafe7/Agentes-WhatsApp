import { defineConfig, devices } from "@playwright/test";
import {
  appServerEnv,
  DEMO_PORT,
  DEMO_URL,
  FRESH_DATABASE_URL,
  FRESH_PORT,
  FRESH_URL,
  MOCK_PORT,
  MOCK_URL,
  RESTAURANT_DATABASE_URL,
  RESTAURANT_PORT,
  RESTAURANT_URL,
} from "./e2e/support/env";

// docs/testing.md: one build of the app started three times — the demo (data/e2e-pglite), an empty installation for
// the setup wizard (data/e2e-fresh-pglite) and the restaurant demo for the agenda by capacity
// (data/e2e-restaurante-pglite), each with its own embedded database (PGlite) that only that server opens — with every
// external service answered by e2e/mocks/server.mjs.
// Playwright starts webServers before globalSetup, so the databases are prepared at the head of the demo
// server's command (e2e/support/prepare-databases.mjs), before the build.
const BUILD_AND_START_TIMEOUT_MS = 600_000;
const START_TIMEOUT_MS = 120_000;
const desktop = devices["Desktop Chrome"];
// `next start` runs with NODE_ENV=production, which refuses changed service addresses and ALLOW_LOCAL_HTTP_TOOLS
// (src/server/app-url.ts): the test servers use the mock server and call it from the HTTP tools, so they say so.
const E2E_START_FLAGS = { E2E_ALLOW_BASE_URL_OVERRIDES: "true" } as const;

export default defineConfig({
  testDir: "e2e",
  // The servers share their databases with every test: one test at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "demo-sessions",
      testDir: "e2e/demo",
      testMatch: /auth\.setup\.ts$/,
      use: { ...desktop, baseURL: DEMO_URL },
    },
    {
      name: "demo",
      testDir: "e2e/demo",
      dependencies: ["demo-sessions"],
      use: { ...desktop, baseURL: DEMO_URL },
    },
    {
      name: "fresh",
      testDir: "e2e/fresh",
      // The empty installation can be set up only once per run: a retry would find it finished.
      retries: 0,
      use: { ...desktop, baseURL: FRESH_URL },
    },
    {
      // The restaurant demo: the agenda by capacity ([AGD-06], [AGD-11]). Its tests sign in on their own.
      name: "restaurant",
      testDir: "e2e/restaurant",
      use: { ...desktop, baseURL: RESTAURANT_URL },
    },
  ],
  webServer: [
    {
      name: "mocks",
      command: "node e2e/mocks/server.mjs",
      url: `${MOCK_URL}/health`,
      reuseExistingServer: false,
      env: { MOCK_PORT: String(MOCK_PORT) },
    },
    {
      name: "demo",
      command: `node e2e/support/prepare-databases.mjs && pnpm build && pnpm start -p ${DEMO_PORT}`,
      // /api/health answers 503 until the database works, so "ready" also means "migrated".
      url: `${DEMO_URL}/api/health`,
      timeout: BUILD_AND_START_TIMEOUT_MS,
      reuseExistingServer: false,
      env: {
        ...appServerEnv("demo"),
        ...E2E_START_FLAGS,
        E2E_FRESH_DATABASE_URL: FRESH_DATABASE_URL,
        E2E_RESTAURANT_DATABASE_URL: RESTAURANT_DATABASE_URL,
      },
    },
    {
      name: "fresh",
      // Same build as the demo (webServers start one after another).
      command: `pnpm start -p ${FRESH_PORT}`,
      url: `${FRESH_URL}/api/health`,
      timeout: START_TIMEOUT_MS,
      reuseExistingServer: false,
      env: { ...appServerEnv("fresh"), ...E2E_START_FLAGS },
    },
    {
      name: "restaurant",
      command: `pnpm start -p ${RESTAURANT_PORT}`,
      url: `${RESTAURANT_URL}/api/health`,
      timeout: START_TIMEOUT_MS,
      reuseExistingServer: false,
      env: { ...appServerEnv("restaurant"), ...E2E_START_FLAGS },
    },
  ],
});
