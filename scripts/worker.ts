// `pnpm worker`: runs the background work in a loop, for an own server (VPS) without the cron route
// (docs/decisions/0008). Ctrl+C or SIGTERM lets the current job finish; a second one stops at once.
import { closeDb } from "../src/db";
import { tick } from "../src/server/jobs";
import { loadLocalEnv } from "./lib/cli";
import { runWorkerLoop } from "./lib/worker-loop";

/** Time a single job may use (its handler sees it as remainingMs()). */
const JOB_BUDGET_MS = 60_000;
/** Rest when the queue is empty. */
const IDLE_SLEEP_MS = 5_000;

async function main(): Promise<void> {
  loadLocalEnv();
  const workerId = `worker-${crypto.randomUUID()}`;
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (controller.signal.aborted) {
        console.log("[worker] Parado sin esperar.");
        process.exit(1);
      }
      console.log("[worker] Parando: termina el trabajo en curso…");
      controller.abort();
    });
  }
  console.log("[worker] En marcha. Ctrl+C para parar.");
  try {
    await runWorkerLoop({
      runTick: () => tick({ budgetMs: JOB_BUDGET_MS, workerId, maxJobs: 1 }),
      signal: controller.signal,
      idleSleepMs: IDLE_SLEEP_MS,
    });
    console.log("[worker] Parado.");
  } finally {
    closeDb();
  }
}

void main();
