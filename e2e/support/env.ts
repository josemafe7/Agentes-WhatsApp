// Ports, addresses, databases and secrets of the Playwright run (docs/testing.md). Shared by
// playwright.config.ts and the tests, so both always agree.
import { randomBytes } from "node:crypto";
import testKeys from "../mocks/test-keys.json";

export const MOCK_PORT = 3101;
export const DEMO_PORT = 3100;
export const FRESH_PORT = 3102;
export const RESTAURANT_PORT = 3103;

/** The mock binds to IPv4 loopback only: explicit address, no firewall prompt, no localhost ambiguity. */
export const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
export const DEMO_URL = `http://localhost:${DEMO_PORT}`;
export const FRESH_URL = `http://localhost:${FRESH_PORT}`;
export const RESTAURANT_URL = `http://localhost:${RESTAURANT_PORT}`;

// Each app server has its own embedded database (PGlite): a folder under data/ that only that server opens.
/** Demo install: migrations + demo seed, prepared before the build (e2e/support/prepare-databases.mjs). */
export const DEMO_DATABASE_URL = "pglite:./data/e2e-pglite";
/** Empty install (migrations only) for the setup wizard. */
export const FRESH_DATABASE_URL = "pglite:./data/e2e-fresh-pglite";
/** The restaurant demo (`pnpm seed --sector=restaurante`): the agenda by capacity ([AGD-06], [AGD-11]). */
export const RESTAURANT_DATABASE_URL = "pglite:./data/e2e-restaurante-pglite";

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
 * Next.js and the scripts that prepare the databases also read the developer's .env.local, but a variable already
 * present in the process (even empty) wins. Blanking these keeps real keys and the real Supabase Storage out of the
 * test servers (DATABASE_URL is always set, to each server's own database).
 */
const BLANKED_ENV = {
  OPENROUTER_API_KEY: "",
  SUPABASE_URL: "",
  SUPABASE_SECRET_KEY: "",
  DATABASE_AUTH_TOKEN: "",
  VERCEL_PROJECT_PRODUCTION_URL: "",
} as const;

export type AppServerKind = "demo" | "fresh" | "restaurant";

const SERVER_URLS: Record<AppServerKind, string> = { demo: DEMO_URL, fresh: FRESH_URL, restaurant: RESTAURANT_URL };
const SERVER_DATABASES: Record<AppServerKind, string> = { demo: DEMO_DATABASE_URL, fresh: FRESH_DATABASE_URL, restaurant: RESTAURANT_DATABASE_URL };

/**
 * The wait before the AI answers a customer, fixed for the e2e run instead of the real 4–8 s ([MOT-01],
 * src/server/engine/schedule.ts reads REPLY_DEBOUNCE_MS). Short enough for quick tests, long enough for three messages
 * typed one after another in the web chat to land inside the same wait and get a single reply.
 */
export const REPLY_DEBOUNCE_MS = 2_000;

/**
 * Environment of one app server. The demos keep DEMO_MODE on; the fresh install behaves like a real business. The
 * restaurant demo, used only by the agenda's capacity specs, has the simulated OpenRouter's test key in its environment
 * ([ARR-15]), so its agents answer from the start.
 */
export function appServerEnv(kind: AppServerKind): Record<string, string> {
  const url = SERVER_URLS[kind];
  return {
    ...BLANKED_ENV,
    ...EXTERNAL_SERVICE_ENV,
    ...TEST_SECRETS,
    ...(kind === "restaurant" ? { OPENROUTER_API_KEY: testKeys.openrouter.valid } : {}),
    DATABASE_URL: SERVER_DATABASES[kind],
    APP_URL: url,
    BETTER_AUTH_URL: url,
    DEMO_MODE: kind === "fresh" ? "false" : "true",
    REPLY_DEBOUNCE_MS: String(REPLY_DEBOUNCE_MS),
    // The custom HTTP tools of the specs call the mock on this machine over http ([HER-14] allows it only in local runs).
    ALLOW_LOCAL_HTTP_TOOLS: "true",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
