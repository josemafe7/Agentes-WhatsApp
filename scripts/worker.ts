// `pnpm worker`: runs the background work in a loop, for an own server (VPS) without the cron route
// (docs/decisions/0008). Ctrl+C or SIGTERM lets the current job finish; a second one stops at once. It makes the same
// start-up checks as the web server (src/server/startup-checks.ts), and those of a published app always, whatever
// NODE_ENV says (a server may not set it): with an unsafe configuration it does not start.
import { closeDb, isServerDatabase } from "../src/db";
import { pingDatabase } from "../src/server/adapters/database-health";
import { assertProductionConfig, productionConfigWarnings } from "../src/server/app-url";
import { runImapIdleWatchers } from "../src/server/channels/email/imap/idle";
import { ensureEmailPollingForAll } from "../src/server/channels/email/jobs";
import { tick } from "../src/server/jobs";
import { safeErrorMessage } from "../src/server/redact";
import { checkStartupConfig, isStartupConfigError } from "../src/server/startup-checks";
import { loadLocalEnv } from "./lib/cli";
import { runWorkerLoop } from "./lib/worker-loop";

/** The web server's start-up checks plus the rules of a published app, always; what to say when it starts. */
function checkWorkerConfig(): string[] {
  const warnings = checkStartupConfig();
  assertProductionConfig(process.env, { worker: true });
  return [...new Set([...warnings, ...productionConfigWarnings(process.env, { worker: true })])];
}

/** Time a single job may use (its handler sees it as remainingMs()). */
const JOB_BUDGET_MS = 60_000;
/** Rest when the queue is empty. */
const IDLE_SLEEP_MS = 5_000;

async function main(): Promise<void> {
  loadLocalEnv();
  try {
    for (const warning of checkWorkerConfig()) console.warn(`[worker] ${warning}`);
  } catch (error) {
    // Only the explanation: never the value of a key or an address.
    console.error(`[worker] No puede arrancar. ${isStartupConfigError(error) ? error.message : safeErrorMessage(error)}`);
    process.exitCode = 1;
    return;
  }
  // The embedded database (data/pglite) opens in one process at a time: with pnpm dev running (which already runs this
  // work every 15 s), say so now instead of failing every round without a word.
  if (!isServerDatabase()) {
    try {
      await pingDatabase();
    } catch (error) {
      console.error(`[worker] No puede abrir la base de datos. ${safeErrorMessage(error)}`);
      process.exitCode = 1;
      await closeDb();
      return;
    }
  }
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
  // Mailboxes: each connected one keeps its read every minute, and with EMAIL_IMAP_IDLE=true the IMAP ones with «Leer
  // al momento» read new mail as it arrives (docs/integracion-correo.md §3.2). Neither stops the worker if it fails.
  await ensureEmailPollingForAll().catch((error: unknown) => console.warn(`[worker] No se han podido revisar las lecturas de los buzones: ${safeErrorMessage(error)}`));
  const idle = runImapIdleWatchers({ signal: controller.signal }).catch((error: unknown) => console.warn(`[worker] IMAP IDLE parado: ${safeErrorMessage(error)}`));
  try {
    await runWorkerLoop({
      runTick: () => tick({ budgetMs: JOB_BUDGET_MS, workerId, maxJobs: 1 }),
      signal: controller.signal,
      idleSleepMs: IDLE_SLEEP_MS,
    });
    await idle;
    console.log("[worker] Parado.");
  } finally {
    await closeDb();
  }
}

void main();
