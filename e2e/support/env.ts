// Ports, addresses, databases and secrets of the Playwright run (docs/testing.md). Shared by
// playwright.config.ts and the tests, so both always agree.
import { randomBytes } from "node:crypto";

export const MOCK_PORT = 3101;
export const DEMO_PORT = 3100;
export const FRESH_PORT = 3102;

/** The mock binds to IPv4 loopback only: explicit address, no firewall prompt, no localhost ambiguity. */
export const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
export const DEMO_URL = `http://localhost:${DEMO_PORT}`;
export const FRESH_URL = `http://localhost:${FRESH_PORT}`;

/** Demo install: migrations + demo seed, prepared before the build (e2e/support/prepare-databases.mjs). */
export const DEMO_DATABASE_URL = "file:./data/e2e.db";
/** Empty install (migrations only) for the setup wizard. */
export const FRESH_DATABASE_URL = "file:./data/e2e-fresh.db";

/**
 * Generated once per run and kept in process.env, so the runner, its workers (which inherit the environment)
 * and both app servers share the same values. Never real secrets: they only exist for this run.
 */
function runValue(name: string, make: () => string): string {
  const existing = process.env[name];
  if (existing) return existing;
  const value = make();
  process.env[name] = value;
  return value;
}

export const RUN_ID = runValue("E2E_RUN_ID", () => randomBytes(4).toString("hex"));

export const TEST_SECRETS = {
  BETTER_AUTH_SECRET: runValue("E2E_BETTER_AUTH_SECRET", () => `e2e-only-${randomBytes(32).toString("hex")}`),
  APP_ENCRYPTION_KEY: runValue("E2E_APP_ENCRYPTION_KEY", () => randomBytes(32).toString("base64")),
  CRON_SECRET: runValue("E2E_CRON_SECRET", () => `e2e-only-${randomBytes(24).toString("hex")}`),
  /** The installation code that `next start` (production) asks for in step 1 of the setup wizard ([ASI-02]). */
  SETUP_TOKEN: runValue("E2E_SETUP_TOKEN", () => `e2e-only-${randomBytes(24).toString("hex")}`),
} as const;

/** Every external service answered by e2e/mocks/server.mjs (paths keep the real API shape after the prefix). */
export const EXTERNAL_SERVICE_ENV = {
  OPENROUTER_BASE_URL: `${MOCK_URL}/openrouter/api/v1`,
  META_GRAPH_BASE_URL: `${MOCK_URL}/meta`,
  GOOGLE_OAUTH_BASE_URL: `${MOCK_URL}/google-oauth`,
  GOOGLE_API_BASE_URL: `${MOCK_URL}/google`,
  MS_LOGIN_BASE_URL: `${MOCK_URL}/ms-login`,
  MS_GRAPH_BASE_URL: `${MOCK_URL}/ms-graph`,
  MISTRAL_BASE_URL: `${MOCK_URL}/mistral`,
  TELEGRAM_API_BASE_URL: `${MOCK_URL}/telegram`,
} as const;

/**
 * Next.js also reads the developer's .env.local, but a variable already present in the process (even empty)
 * wins. Blanking these keeps real keys, Turso and Vercel Blob out of the test servers.
 */
const BLANKED_ENV = {
  OPENROUTER_API_KEY: "",
  DATABASE_AUTH_TOKEN: "",
  BLOB_READ_WRITE_TOKEN: "",
  BLOB_STORE_ID: "",
  VERCEL_PROJECT_PRODUCTION_URL: "",
} as const;

export type AppServerKind = "demo" | "fresh";

/** Environment of one app server. The demo keeps DEMO_MODE on; the fresh install behaves like a real business. */
export function appServerEnv(kind: AppServerKind): Record<string, string> {
  const url = kind === "demo" ? DEMO_URL : FRESH_URL;
  return {
    ...BLANKED_ENV,
    ...EXTERNAL_SERVICE_ENV,
    ...TEST_SECRETS,
    DATABASE_URL: kind === "demo" ? DEMO_DATABASE_URL : FRESH_DATABASE_URL,
    APP_URL: url,
    BETTER_AUTH_URL: url,
    DEMO_MODE: kind === "demo" ? "true" : "false",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
