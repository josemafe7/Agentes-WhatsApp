// Background work (docs/decisions/0008): enqueue jobs, register handlers and run tick().
import "server-only";
import { getJobQueue, type EnqueueInput, type EnqueueResult } from "@/server/adapters/job-queue";

export { PermanentJobError, registerJobHandler, registeredJobTypes, type JobContext, type JobHandler } from "./registry";
export { LAST_TICK_KV_KEY, tick, type TickOptions, type TickSummary } from "./tick";

/** Adds a job to the queue (see JobQueue.enqueue for dedupe keys). */
export function enqueueJob(input: EnqueueInput): Promise<EnqueueResult> {
  return getJobQueue().enqueue(input);
}

/**
 * Ensures a recurring job exists (one pending or running job per key): it runs every `intervalMs` after it
 * finishes, and a job that keeps failing is re-scheduled instead of dying. Idempotent: call it on start-up
 * or when the feature is turned on (e.g. email polling when a mailbox connects).
 */
export function scheduleRecurring(
  type: string,
  key: string,
  intervalMs: number,
  options: { payload?: unknown; firstRunAt?: Date } = {},
): Promise<EnqueueResult> {
  return getJobQueue().ensureRecurring({ type, key, intervalMs, ...options });
}
