// Test-only environment values: never real secrets. Applied by src/test/setup.ts before every test file.
export const TEST_ENV = {
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  BETTER_AUTH_SECRET: "test-only-better-auth-secret-0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:3000",
  APP_URL: "http://localhost:3000",
  CRON_SECRET: "test-only-cron-secret-0123456789",
} as const;

/** Real credentials and remote services the tests must never inherit from the shell. */
export const UNSET_IN_TESTS = ["OPENROUTER_API_KEY", "DATABASE_AUTH_TOKEN", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID", "DEMO_MODE"];
