// Vitest global setup (runs once, before the workers): migrates a template database in a temporary folder.
// Each test file then starts from its own empty copy (src/test/setup.ts). Never touches data/local.db.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";
import { migrateDatabase } from "../db/migrate";
import { removeStaleTestRuns, removeWithRetry, TEST_RUN_PREFIX } from "./remove-with-retry";

declare module "vitest" {
  export interface ProvidedContext {
    testRunDir: string;
    templateDbPath: string;
  }
}

export async function setup(project: TestProject): Promise<() => Promise<void>> {
  await removeStaleTestRuns();
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), TEST_RUN_PREFIX));
  const template = path.join(runDir, "template.db");
  // Rollback journal (no WAL) so the template is one complete file that can be copied.
  await migrateDatabase({ url: `file:${template.split(path.sep).join("/")}`, wal: false });
  project.provide("testRunDir", runDir);
  project.provide("templateDbPath", template);
  return async () => {
    // This process may keep the template open until it exits; the next run removes what is left.
    await removeWithRetry(runDir, 5);
  };
}
