// Deletes test files. libSQL may keep a file handle until its process exits and Windows refuses to delete an
// open file, so this retries while letting the event loop run, and reports whether it managed to.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RETRY_MS = 50;
export const TEST_RUN_PREFIX = "dominia-vitest-";
/** Leftover run folders older than this belong to finished runs and are removed at the next start. */
const STALE_RUN_MS = 10 * 60_000;

export async function removeWithRetry(target: string, attempts = 40): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return true;
    } catch {
      // Still locked: wait a moment and try again.
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
  return false;
}

/** Removes run folders of earlier test runs (their processes have exited, so nothing holds them any more). */
export async function removeStaleTestRuns(now = Date.now()): Promise<void> {
  const tmp = os.tmpdir();
  for (const entry of fs.readdirSync(tmp)) {
    if (!entry.startsWith(TEST_RUN_PREFIX)) continue;
    const folder = path.join(tmp, entry);
    const { mtimeMs } = fs.statSync(folder);
    if (now - mtimeMs > STALE_RUN_MS) await removeWithRetry(folder, 1);
  }
}
