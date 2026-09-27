// Vitest setup, loaded before every test file (vitest.config.mts › setupFiles):
// - fixed test-only secrets, and no real keys or external services inherited from the shell;
// - a fresh, migrated database for this test file: the template of src/test/global-setup.ts loaded into an in-memory
//   Postgres (PGlite), set as DATABASE_URL before the test imports anything that uses the database.
import fs from "node:fs";
import { afterAll, inject } from "vitest";
import { closeDb, createPglite, useTestDatabase } from "@/db";
import { TEST_ENV, UNSET_IN_TESTS } from "./env";

for (const [key, value] of Object.entries(TEST_ENV)) process.env[key] = value;
for (const key of UNSET_IN_TESTS) delete process.env[key];

// Tests never reach a real service (docs/testing.md): code that forgot its fake fetch fails here, loudly, instead of
// calling OpenRouter or Meta. Only this machine can be reached (tests that start a local server).
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!LOCAL_HOSTS.has(url.hostname)) return Promise.reject(new Error(`Prueba sin fetch simulado: se ha intentado llamar a ${url.origin}`));
  return realFetch(input, init);
}) as typeof fetch;

// The id keeps each file's database apart in the connection cache of src/db/index.ts.
process.env.DATABASE_URL = `pglite:memory#${crypto.randomUUID()}`;
const template = new Blob([new Uint8Array(fs.readFileSync(inject("templateDumpPath")))]);
// eslint-disable-next-line react-hooks/rules-of-hooks -- not a React hook: it registers this file's database
await useTestDatabase(createPglite(undefined, { loadDataDir: template }));

afterAll(async () => {
  await closeDb();
});
