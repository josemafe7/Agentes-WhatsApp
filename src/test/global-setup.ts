// Vitest global setup (runs once, before the workers): migrates a template database in memory and saves it to a
// temporary file. Each test file then loads its own copy into memory (src/test/setup.ts). Never touches data/pglite.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { TestProject } from "vitest/node";
import { createPglite } from "../db";
import { MIGRATIONS_FOLDER } from "../db/migrate";
import { removeStaleTestRuns, removeWithRetry, TEST_RUN_PREFIX } from "./remove-with-retry";

declare module "vitest" {
  export interface ProvidedContext {
    /** Uncompressed dump of the migrated template (PGlite dumpDataDir). */
    templateDumpPath: string;
  }
}

export async function setup(project: TestProject): Promise<() => Promise<void>> {
  await removeStaleTestRuns();
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), TEST_RUN_PREFIX));
  const template = path.join(runDir, "template.tar");
  const client = createPglite();
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    // Uncompressed: loading it is what every test file pays for.
    const dump = await client.dumpDataDir("none");
    fs.writeFileSync(template, new Uint8Array(await dump.arrayBuffer()));
  } finally {
    await client.close();
  }
  project.provide("templateDumpPath", template);
  return async () => {
    await removeWithRetry(runDir, 5);
  };
}
