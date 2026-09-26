// The loop of `pnpm worker` (VPS): runs tick() round after round, rests when there is nothing to do and stops
// between jobs when asked to (docs/decisions/0008). tick() never throws, so the loop needs no guard.
import { setTimeout as delay } from "node:timers/promises";
import type { TickSummary } from "../../src/server/jobs/tick";

export type WorkerLoopOptions = {
  /** One round of tick(); the worker runs one job per round so it can stop between jobs. */
  runTick: () => Promise<TickSummary>;
  /** Aborted by SIGINT/SIGTERM: the current job finishes and the loop ends. */
  signal: AbortSignal;
  /** Rest after a round that found nothing to do (or stopped on an error). */
  idleSleepMs: number;
  log?: (line: string) => void;
};

export async function runWorkerLoop(options: WorkerLoopOptions): Promise<{ rounds: number }> {
  const { runTick, signal, idleSleepMs, log = (line: string) => console.log(line) } = options;
  let rounds = 0;
  while (!signal.aborted) {
    const summary = await runTick();
    rounds++;
    if (summary.claimed > 0) log(describe(summary));
    const moreWaiting = summary.stoppedBy === "budget" || summary.stoppedBy === "max_jobs";
    if (!moreWaiting) await rest(idleSleepMs, signal);
  }
  return { rounds };
}

async function rest(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, { signal });
  } catch {
    // Aborted while resting: the loop checks the signal and ends.
  }
}

function describe(s: TickSummary): string {
  const parts = [`${s.completed} hechos`];
  if (s.retried) parts.push(`${s.retried} para reintentar`);
  if (s.failed) parts.push(`${s.failed} fallidos`);
  if (s.rescheduled) parts.push(`${s.rescheduled} reprogramados`);
  return `[worker] Trabajos: ${parts.join(", ")} (${s.durationMs} ms).`;
}
