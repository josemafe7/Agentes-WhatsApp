// tick(): runs due jobs until its time budget is spent (docs/decisions/0008). Idempotent and safe to run in
// parallel (atomic claims); it never throws, so callers (after(), the cron route, the worker) need no guard.
import "server-only";
import { getJobQueue, type Job, type JobQueue } from "@/server/adapters/job-queue";
import { safeErrorMessage } from "@/server/redact";
import { setKv } from "@/server/kv";
import "./handlers";
import { getJobRegistration, PermanentJobError, type JobContext } from "./registry";

export type TickOptions = {
  /** Time this tick may use, in ms (derived from the maxDuration of the route that runs it). */
  budgetMs: number;
  workerId?: string;
  /** Stop after this many jobs (default: no limit besides the budget). */
  maxJobs?: number;
  queue?: JobQueue;
  /** Milliseconds clock for the budget (tests). */
  clock?: () => number;
};

export type TickSummary = {
  workerId: string;
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
  rescheduled: number;
  lost: number;
  durationMs: number;
  stoppedBy: "idle" | "budget" | "max_jobs" | "error";
  error?: string;
};

/** No new job starts with less time than this left. */
export const MIN_JOB_BUDGET_MS = 1_000;
/** A claimed job stays locked for the budget plus this margin before another tick may take it over. */
export const LOCK_MARGIN_MS = 30_000;
export const LAST_TICK_KV_KEY = "jobs.last_tick";

export async function tick(options: TickOptions): Promise<TickSummary> {
  const clock = options.clock ?? Date.now;
  const started = clock();
  const deadline = started + options.budgetMs;
  const queue = options.queue ?? getJobQueue();
  const workerId = options.workerId ?? `tick-${crypto.randomUUID()}`;
  const maxJobs = options.maxJobs ?? Number.POSITIVE_INFINITY;
  const lockMs = options.budgetMs + LOCK_MARGIN_MS;
  const summary: TickSummary = {
    workerId,
    claimed: 0,
    completed: 0,
    retried: 0,
    failed: 0,
    rescheduled: 0,
    lost: 0,
    durationMs: 0,
    stoppedBy: "idle",
  };

  try {
    while (true) {
      if (summary.claimed >= maxJobs) {
        summary.stoppedBy = "max_jobs";
        break;
      }
      if (deadline - clock() < MIN_JOB_BUDGET_MS) {
        summary.stoppedBy = "budget";
        break;
      }
      // One at a time: never hold locks on jobs this tick may not have time to run.
      const [job] = await queue.claim(1, lockMs, workerId);
      if (!job) break;
      summary.claimed++;
      await runJob(job, { queue, workerId, deadline, clock, summary });
    }
  } catch (error) {
    summary.stoppedBy = "error";
    summary.error = safeErrorMessage(error);
    console.error(`[jobs] La ronda ${workerId} se detuvo: ${summary.error}`);
  }

  summary.durationMs = clock() - started;
  await recordLastTick(summary);
  return summary;
}

type RunState = { queue: JobQueue; workerId: string; deadline: number; clock: () => number; summary: TickSummary };

async function runJob(job: Job, state: RunState): Promise<void> {
  const { queue, workerId, summary } = state;
  const registration = getJobRegistration(job.type);
  if (!registration) {
    await queue.fail(job.id, workerId, `Tipo de trabajo desconocido: ${job.type}`, { retryable: false });
    summary.failed++;
    return;
  }
  const control: { rescheduleAt: Date | null } = { rescheduleAt: null };
  const context: JobContext = {
    job,
    workerId,
    queue,
    remainingMs: () => Math.max(0, state.deadline - state.clock()),
    rescheduleAt: (runAt) => {
      control.rescheduleAt = runAt;
    },
  };
  try {
    const payload = registration.payload ? registration.payload.parse(job.payload) : job.payload;
    await registration.handler(payload, context);
  } catch (error) {
    const permanent = error instanceof PermanentJobError || isZodError(error);
    const message = isZodError(error) ? "Los datos del trabajo no son válidos." : safeErrorMessage(error);
    const outcome = await queue.fail(job.id, workerId, message, { retryable: !permanent });
    if (outcome === "failed") summary.failed++;
    else if (outcome === "lost") summary.lost++;
    else summary.retried++;
    return;
  }
  if (control.rescheduleAt) {
    await queue.reschedule(job.id, workerId, control.rescheduleAt);
    summary.rescheduled++;
  } else if (await queue.complete(job.id, workerId)) {
    summary.completed++;
  } else {
    summary.lost++;
  }
}

function isZodError(error: unknown): boolean {
  return error instanceof Error && error.name === "ZodError";
}

async function recordLastTick(summary: TickSummary): Promise<void> {
  try {
    await setKv(LAST_TICK_KV_KEY, { ...summary, at: new Date().toISOString() });
  } catch (error) {
    // Diagnóstico loses the time of the last tick, but the work itself is already done.
    console.warn(`[jobs] No se pudo guardar la última ronda: ${safeErrorMessage(error)}`);
  }
}
