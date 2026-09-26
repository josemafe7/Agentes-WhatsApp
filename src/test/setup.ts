// Vitest setup, loaded before every test file (vitest.config.mts › setupFiles):
// - fixed test-only secrets, and no real keys or external services inherited from the shell;
// - a fresh, migrated database for this test file (copy of the template made by src/test/global-setup.ts),
//   set as DATABASE_URL before the test imports anything that uses the database.
import fs from "node:fs";
import path from "node:path";
import { afterAll, inject } from "vitest";
import { closeDb } from "@/db";
import { enableWalForUrl } from "@/db/migrate";
import { TEST_ENV, UNSET_IN_TESTS } from "./env";
import { removeWithRetry } from "./remove-with-retry";

for (const [key, value] of Object.entries(TEST_ENV)) process.env[key] = value;
for (const key of UNSET_IN_TESTS) delete process.env[key];

const testDbPath = path.join(inject("testRunDir"), `${crypto.randomUUID()}.db`);
fs.copyFileSync(inject("templateDbPath"), testDbPath);
process.env.DATABASE_URL = `file:${testDbPath.split(path.sep).join("/")}`;
// Same journal mode as a real installation: concurrent writers wait instead of dead-locking.
await enableWalForUrl(process.env.DATABASE_URL);

afterAll(async () => {
  closeDb();
  // Anything still locked is removed with the whole run folder by the global teardown.
  await removeWithRetry(testDbPath);
});
