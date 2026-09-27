// Runs once when a Next.js server starts, before it answers any request (node_modules/next/dist/docs:
// instrumentation.md). The start-up checks of src/server/startup-checks.ts ([SEG-03], [SEG-11]), the same as
// `pnpm worker`: without a usable APP_ENCRYPTION_KEY, or with an unsafe configuration of a compiled app, it does not
// start and says why.
// Then, in the background so the start is never slower nor stopped by it, the start-up upkeep of
// src/server/startup-maintenance.ts.
// This file is also built for the Edge runtime: everything of the server is imported after the Node.js check.

/** `next build` also loads this file: nothing to resume while building, and the address is checked when it starts. */
const BUILD_PHASE = "phase-production-build";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkStartupConfig, isStartupConfigError } = await import("./server/startup-checks");
  const building = process.env.NEXT_PHASE === BUILD_PHASE;
  let warnings: string[];
  try {
    warnings = checkStartupConfig({ building });
  } catch (error) {
    // Only the explanation: never the value of a key or an address.
    if (isStartupConfigError(error)) console.error(`[arranque] La app no puede arrancar. ${error.message}`);
    throw error;
  }
  for (const warning of warnings) console.warn(`[arranque] ${warning}`);
  if (building) return;
  // On Vercel a function is frozen as soon as its response is sent, and work that no request waits for stays frozen
  // halfway (holding the write lock or a half-open connection): there the first cron tick of each instance runs it,
  // inside its after() (src/app/api/cron/tick/route.ts).
  if (process.env.VERCEL) return;
  const { runStartupMaintenance } = await import("./server/startup-maintenance");
  void runStartupMaintenance();
}
