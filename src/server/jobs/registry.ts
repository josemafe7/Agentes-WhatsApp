// Job handlers by type. Each handler is idempotent: running it twice never duplicates anything (decision 0008).
import "server-only";
import type { z } from "zod";
import type { Job, JobQueue } from "@/server/adapters/job-queue";

export type JobContext = {
  job: Job;
  workerId: string;
  queue: JobQueue;
  /** Milliseconds left in this tick's budget: long work stops early and continues in a new job. */
  remainingMs(): number;
  /** Run this job again at `runAt` instead of marking it done (chunked work, waiting for something). */
  rescheduleAt(runAt: Date): void;
};

export type JobHandler<P> = (payload: P, context: JobContext) => Promise<void>;

/** Throw it for failures that will not improve with a retry (bad data, missing configuration). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

type Registration = { handler: JobHandler<unknown>; payload?: z.ZodType<unknown> };
const registry = new Map<string, Registration>();

/**
 * Registers the handler of a job type. With `payload`, the stored payload is validated before running it and
 * an invalid one fails the job for good. Registering the same type again replaces it (dev hot reload).
 */
export function registerJobHandler<P>(type: string, handler: JobHandler<P>, options: { payload?: z.ZodType<P> } = {}): void {
  registry.set(type, { handler: handler as JobHandler<unknown>, payload: options.payload });
}

export function getJobRegistration(type: string): Registration | undefined {
  return registry.get(type);
}

export function registeredJobTypes(): string[] {
  return [...registry.keys()].sort();
}

/** Tests only: forget a registration. */
export function unregisterJobHandler(type: string): void {
  registry.delete(type);
}
