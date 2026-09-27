// Test-only environment values: never real secrets. Applied by src/test/setup.ts before every test file.
export const TEST_ENV = {
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  BETTER_AUTH_SECRET: "test-only-better-auth-secret-0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:3000",
  APP_URL: "http://localhost:3000",
  CRON_SECRET: "test-only-cron-secret-0123456789",
} as const;

/**
 * Real credentials and remote services the tests must never inherit from the shell: the database (Supabase or any
 * server), Supabase Storage and OpenRouter. src/test/setup.ts then points DATABASE_URL at the test file's own database.
 * VERCEL too: with it the app refuses the embedded database (src/db/index.ts); tests that need it stub it.
 */
export const UNSET_IN_TESTS = [
  "OPENROUTER_API_KEY",
  "DATABASE_URL",
  "DATABASE_AUTH_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "DEMO_MODE",
  "VERCEL",
];
