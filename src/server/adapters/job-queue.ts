// JobQueue: background work queue (docs/decisions/0008). libSQL implementation on the `jobs` table.
// A future Postgres implementation claims with FOR UPDATE SKIP LOCKED behind the same interface.
import "server-only";
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db as defaultDb, type Executor } from "@/db";
import { jobs } from "@/db/schema";
import type { JobStatus } from "@/lib/enums";

export type Job = typeof jobs.$inferSelect;
export type Clock = () => Date;

export type EnqueueInput = {
  type: string;
  payload?: unknown;
  /** Default: now. */
  runAt?: Date;
  maxAttempts?: number;
  /** With a key, at most one pending job exists: enqueueing again returns the pending one. */
  dedupeKey?: string;
};
export type DebounceInput = {
  type: string;
  payload?: unknown;
  dedupeKey: string;
  /** Desired run time; a pending job is only moved forward, never beyond its first maxRunAt. */
  runAt: Date;
  maxRunAt: Date;
  maxAttempts?: number;
};
export type RecurringInput = {
  type: string;
  /** Stable name; the job's dedupe key is `recurring:<key>`. */
  key: string;
  intervalMs: number;
  payload?: unknown;
  firstRunAt?: Date;
};
export type EnqueueResult = { id: string; created: boolean; runAt: Date };
/** What happened to a failed job: retried later, failed for good, re-scheduled (recurring), replaced by a newer
 * pending job with the same key, or lost (the claim expired and another worker holds it). */
export type FailOutcome = "retry" | "failed" | "rescheduled" | "superseded" | "lost";
export type JobQueueStats = Record<JobStatus, number> & { due: number; oldestDueAt: Date | null };

export interface JobQueue {
  enqueue(input: EnqueueInput): Promise<EnqueueResult>;
  /** Groups bursts (e.g. several customer messages into one reply, [MOT-01]). */
  upsertDebounced(input: DebounceInput): Promise<EnqueueResult>;
  /** Ensures one pending or running job for a recurring task. */
  ensureRecurring(input: RecurringInput): Promise<EnqueueResult>;
  /** Atomically takes up to `limit` due jobs (or running ones whose lock expired) for `lockMs`. */
  claim(limit: number, lockMs: number, workerId: string): Promise<Job[]>;
  complete(jobId: string, workerId: string): Promise<boolean>;
  fail(jobId: string, workerId: string, error: string, options?: { retryable?: boolean }): Promise<FailOutcome>;
  /** Gives a claimed job back to run again at `runAt`, without counting it as a failure. */
  reschedule(jobId: string, workerId: string, runAt: Date): Promise<boolean>;
  /** Cancels pending jobs by id or dedupe key; running ones finish. */
  cancel(target: { id: string } | { dedupeKey: string }): Promise<number>;
  /** «Reintentar» from Diagnóstico: a failed job runs again now with its attempts reset. */
  retryFailed(jobId: string): Promise<boolean>;
  stats(): Promise<JobQueueStats>;
  /** Clean-up of finished (done or cancelled) jobs. */
  deleteFinishedBefore(date: Date): Promise<number>;
}

export const DEFAULT_MAX_ATTEMPTS = 5;
export const BACKOFF_BASE_MS = 15_000;
export const BACKOFF_MAX_MS = 60 * 60_000;
const MAX_ERROR_LENGTH = 1_000;
const STALE_EXHAUSTED_ERROR = "El trabajo se quedó a medias demasiadas veces y se ha dado por fallido.";
// Same predicate as the partial unique index jobs_dedupe_pending_uq (required for ON CONFLICT on it).
const PENDING_DEDUPE = sql`status = 'pending' AND dedupe_key IS NOT NULL`;

/** Exponential backoff after the n-th failed attempt: 15 s, 30 s, 1 min… up to 1 h. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);
}

function truncateError(message: string): string {
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message;
}

export class LibsqlJobQueue implements JobQueue {
  private readonly db: Executor;
  private readonly now: Clock;

  constructor(options: { db?: Executor; now?: Clock } = {}) {
    this.db = options.db ?? defaultDb;
    this.now = options.now ?? (() => new Date());
  }

  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    const id = crypto.randomUUID();
    const now = this.now();
    const insert = this.db.insert(jobs).values({
      id,
      type: input.type,
      payload: input.payload ?? {},
      runAt: input.runAt ?? now,
      maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      dedupeKey: input.dedupeKey ?? null,
      createdAt: now,
      updatedAt: now,
    });
    const [row] = input.dedupeKey
      ? await insert
          // A pending job with this key already exists: keep it as it is and return it.
          .onConflictDoUpdate({ target: jobs.dedupeKey, targetWhere: PENDING_DEDUPE, set: { dedupeKey: sql`excluded.dedupe_key` } })
          .returning({ id: jobs.id, runAt: jobs.runAt })
      : await insert.returning({ id: jobs.id, runAt: jobs.runAt });
    return { id: row.id, created: row.id === id, runAt: row.runAt };
  }

  async upsertDebounced(input: DebounceInput): Promise<EnqueueResult> {
    const id = crypto.randomUUID();
    const now = this.now();
    const firstRunAt = input.runAt.getTime() > input.maxRunAt.getTime() ? input.maxRunAt : input.runAt;
    const [row] = await this.db
      .insert(jobs)
      .values({
        id,
        type: input.type,
        payload: input.payload ?? {},
        runAt: firstRunAt,
        maxRunAt: input.maxRunAt,
        maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        dedupeKey: input.dedupeKey,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: jobs.dedupeKey,
        targetWhere: PENDING_DEDUPE,
        set: {
          // Later, never earlier, and never beyond the limit set by the first call.
          runAt: sql`min(max(${jobs.runAt}, excluded.run_at), coalesce(${jobs.maxRunAt}, excluded.max_run_at))`,
          payload: sql`excluded.payload`,
        },
      })
      .returning({ id: jobs.id, runAt: jobs.runAt });
    return { id: row.id, created: row.id === id, runAt: row.runAt };
  }

  async ensureRecurring(input: RecurringInput): Promise<EnqueueResult> {
    const dedupeKey = `recurring:${input.key}`;
    const [active] = await this.db
      .select({ id: jobs.id, runAt: jobs.runAt })
      .from(jobs)
      .where(and(eq(jobs.dedupeKey, dedupeKey), inArray(jobs.status, ["pending", "running"])))
      .limit(1);
    if (active) return { id: active.id, created: false, runAt: active.runAt };
    const now = this.now();
    const id = crypto.randomUUID();
    const [row] = await this.db
      .insert(jobs)
      .values({
        id,
        type: input.type,
        payload: input.payload ?? {},
        runAt: input.firstRunAt ?? now,
        dedupeKey,
        intervalMs: input.intervalMs,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({ target: jobs.dedupeKey, targetWhere: PENDING_DEDUPE, set: { dedupeKey: sql`excluded.dedupe_key` } })
      .returning({ id: jobs.id, runAt: jobs.runAt });
    return { id: row.id, created: row.id === id, runAt: row.runAt };
  }

  async claim(limit: number, lockMs: number, workerId: string): Promise<Job[]> {
    const now = this.now();
    // Running jobs whose lock expired after using every attempt are given up (the process died on them).
    await this.db
      .update(jobs)
      .set({ status: "failed", lastError: STALE_EXHAUSTED_ERROR, lockedUntil: null, lockedBy: null, finishedAt: now, updatedAt: now })
      .where(
        and(
          eq(jobs.status, "running"),
          lte(jobs.lockedUntil, now),
          gte(jobs.attempts, jobs.maxAttempts),
          isNull(jobs.intervalMs),
        ),
      );
    const claimable = or(
      and(eq(jobs.status, "pending"), lte(jobs.runAt, now)),
      and(eq(jobs.status, "running"), lte(jobs.lockedUntil, now)),
    );
    const candidates = this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(claimable)
      .orderBy(asc(jobs.runAt), asc(jobs.createdAt))
      .limit(limit);
    // One statement: two concurrent ticks can never take the same job.
    const claimed = await this.db
      .update(jobs)
      .set({
        status: "running",
        attempts: sql`${jobs.attempts} + 1`,
        lockedUntil: new Date(now.getTime() + lockMs),
        lockedBy: workerId,
        updatedAt: now,
      })
      .where(and(inArray(jobs.id, candidates), claimable))
      .returning();
    // RETURNING has no defined order: run the oldest first.
    return claimed.sort((a, b) => a.runAt.getTime() - b.runAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime());
  }

  async complete(jobId: string, workerId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const job = await findClaimed(tx, jobId, workerId);
      if (!job) return false;
      const now = this.now();
      if (job.intervalMs !== null) {
        const next = await nextPendingStatus(tx, job, "done");
        await tx
          .update(jobs)
          .set({
            status: next,
            runAt: new Date(now.getTime() + job.intervalMs),
            attempts: 0,
            lastError: null,
            lockedUntil: null,
            lockedBy: null,
            finishedAt: next === "done" ? now : null,
            updatedAt: now,
          })
          .where(eq(jobs.id, jobId));
        return true;
      }
      await tx
        .update(jobs)
        .set({ status: "done", lockedUntil: null, lockedBy: null, finishedAt: now, updatedAt: now })
        .where(eq(jobs.id, jobId));
      return true;
    });
  }

  async fail(jobId: string, workerId: string, error: string, options: { retryable?: boolean } = {}): Promise<FailOutcome> {
    const lastError = truncateError(error);
    return this.db.transaction(async (tx): Promise<FailOutcome> => {
      const job = await findClaimed(tx, jobId, workerId);
      if (!job) return "lost";
      const now = this.now();
      const exhausted = options.retryable === false || job.attempts >= job.maxAttempts;
      if (exhausted && job.intervalMs === null) {
        await tx
          .update(jobs)
          .set({ status: "failed", lastError, lockedUntil: null, lockedBy: null, finishedAt: now, updatedAt: now })
          .where(eq(jobs.id, jobId));
        return "failed";
      }
      const next = await nextPendingStatus(tx, job, "cancelled");
      const recurringRestart = exhausted && job.intervalMs !== null;
      await tx
        .update(jobs)
        .set({
          status: next,
          runAt: new Date(now.getTime() + (recurringRestart ? (job.intervalMs ?? 0) : backoffMs(job.attempts))),
          attempts: recurringRestart ? 0 : job.attempts,
          lastError,
          lockedUntil: null,
          lockedBy: null,
          finishedAt: next === "cancelled" ? now : null,
          updatedAt: now,
        })
        .where(eq(jobs.id, jobId));
      if (next === "cancelled") return "superseded";
      return recurringRestart ? "rescheduled" : "retry";
    });
  }

  async reschedule(jobId: string, workerId: string, runAt: Date): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const job = await findClaimed(tx, jobId, workerId);
      if (!job) return false;
      const now = this.now();
      const next = await nextPendingStatus(tx, job, "cancelled");
      await tx
        .update(jobs)
        .set({
          status: next,
          runAt,
          attempts: 0,
          lockedUntil: null,
          lockedBy: null,
          finishedAt: next === "cancelled" ? now : null,
          updatedAt: now,
        })
        .where(eq(jobs.id, jobId));
      return next === "pending";
    });
  }

  async cancel(target: { id: string } | { dedupeKey: string }): Promise<number> {
    const now = this.now();
    const match = "id" in target ? eq(jobs.id, target.id) : eq(jobs.dedupeKey, target.dedupeKey);
    const rows = await this.db
      .update(jobs)
      .set({ status: "cancelled", finishedAt: now, updatedAt: now })
      .where(and(match, eq(jobs.status, "pending")))
      .returning({ id: jobs.id });
    return rows.length;
  }

  async retryFailed(jobId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, jobId), eq(jobs.status, "failed")));
      if (!job) return false;
      if ((await nextPendingStatus(tx, job, "cancelled")) === "cancelled") return false;
      const now = this.now();
      await tx
        .update(jobs)
        .set({ status: "pending", runAt: now, attempts: 0, finishedAt: null, updatedAt: now })
        .where(eq(jobs.id, jobId));
      return true;
    });
  }

  async stats(): Promise<JobQueueStats> {
    const now = this.now();
    const byStatus = await this.db.select({ status: jobs.status, n: count() }).from(jobs).groupBy(jobs.status);
    const [due] = await this.db
      .select({ n: count(), oldest: sql<number | null>`min(${jobs.runAt})` })
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, now)));
    const stats: JobQueueStats = {
      pending: 0,
      running: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
      due: due?.n ?? 0,
      oldestDueAt: due?.oldest != null ? new Date(due.oldest) : null,
    };
    for (const row of byStatus) stats[row.status] = row.n;
    return stats;
  }

  async deleteFinishedBefore(date: Date): Promise<number> {
    const rows = await this.db
      .delete(jobs)
      .where(and(inArray(jobs.status, ["done", "cancelled"]), lte(jobs.updatedAt, date)))
      .returning({ id: jobs.id });
    return rows.length;
  }
}

async function findClaimed(tx: Executor, jobId: string, workerId: string): Promise<Job | undefined> {
  const [job] = await tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.lockedBy, workerId)));
  return job;
}

/** "pending", unless another pending job with the same key exists (then this one gives way). */
async function nextPendingStatus<T extends JobStatus>(tx: Executor, job: Job, whenSuperseded: T): Promise<"pending" | T> {
  if (!job.dedupeKey) return "pending";
  const [other] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.dedupeKey, job.dedupeKey), eq(jobs.status, "pending"), ne(jobs.id, job.id), isNotNull(jobs.dedupeKey)))
    .limit(1);
  return other ? whenSuperseded : "pending";
}

let sharedQueue: JobQueue | undefined;

/** The queue of this installation (libSQL today). */
export function getJobQueue(): JobQueue {
  sharedQueue ??= new LibsqlJobQueue();
  return sharedQueue;
}
