import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { backoffMs, BACKOFF_BASE_MS, PgJobQueue } from "./job-queue";

const START = new Date("2026-09-26T10:00:00Z").getTime();
let nowMs = START;
const clock = () => new Date(nowMs);
const advance = (ms: number) => {
  nowMs += ms;
};
const at = (offsetMs: number) => new Date(START + offsetMs);

const queue = new PgJobQueue({ now: clock });
const LOCK_MS = 60_000;

async function getJob(id: string) {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row;
}

beforeEach(async () => {
  nowMs = START;
  await db.delete(jobs);
});

describe("enqueue", () => {
  it("creates a pending job due now by default", async () => {
    const result = await queue.enqueue({ type: "test.echo", payload: { a: 1 } });
    expect(result.created).toBe(true);
    const job = await getJob(result.id);
    expect(job).toMatchObject({ type: "test.echo", status: "pending", attempts: 0, maxAttempts: 5, payload: { a: 1 } });
    expect(job.runAt.getTime()).toBe(START);
  });

  it("with a dedupe key keeps a single pending job and returns it", async () => {
    const first = await queue.enqueue({ type: "t", dedupeKey: "k1", payload: { n: 1 } });
    const second = await queue.enqueue({ type: "t", dedupeKey: "k1", payload: { n: 2 } });
    expect(second).toMatchObject({ id: first.id, created: false });
    expect(await db.select().from(jobs)).toHaveLength(1);
    expect((await getJob(first.id)).payload).toEqual({ n: 1 });
  });
});

describe("upsertDebounced [MOT-01]", () => {
  it("moves run_at forward with each call but never beyond maxRunAt", async () => {
    const maxRunAt = at(20_000);
    const a = await queue.upsertDebounced({ type: "reply", dedupeKey: "conv:1", runAt: at(6_000), maxRunAt });
    expect(a.created).toBe(true);
    expect(a.runAt).toEqual(at(6_000));

    advance(5_000);
    const b = await queue.upsertDebounced({ type: "reply", dedupeKey: "conv:1", runAt: at(11_000), maxRunAt: at(25_000) });
    expect(b).toMatchObject({ id: a.id, created: false });
    expect(b.runAt).toEqual(at(11_000));

    advance(10_000);
    const c = await queue.upsertDebounced({ type: "reply", dedupeKey: "conv:1", runAt: at(21_000), maxRunAt: at(35_000) });
    // Capped by the maxRunAt of the first call: 20 s after the first message.
    expect(c.runAt).toEqual(maxRunAt);
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("never moves run_at backwards", async () => {
    const a = await queue.upsertDebounced({ type: "reply", dedupeKey: "conv:2", runAt: at(8_000), maxRunAt: at(20_000) });
    const b = await queue.upsertDebounced({ type: "reply", dedupeKey: "conv:2", runAt: at(4_000), maxRunAt: at(20_000) });
    expect(b.id).toBe(a.id);
    expect(b.runAt).toEqual(at(8_000));
  });

  it("caps the first run_at at maxRunAt", async () => {
    const a = await queue.upsertDebounced({ type: "reply", dedupeKey: "conv:3", runAt: at(30_000), maxRunAt: at(20_000) });
    expect(a.runAt).toEqual(at(20_000));
  });

  it("creates a new pending job while the previous one is running [MOT-02]", async () => {
    const a = await queue.upsertDebounced({ type: "reply", dedupeKey: "conv:4", runAt: at(0), maxRunAt: at(20_000) });
    const [claimed] = await queue.claim(1, LOCK_MS, "w1");
    expect(claimed.id).toBe(a.id);
    const b = await queue.upsertDebounced({ type: "reply", dedupeKey: "conv:4", runAt: at(5_000), maxRunAt: at(25_000) });
    expect(b.created).toBe(true);
    expect(b.id).not.toBe(a.id);
  });
});

describe("claim", () => {
  it("only takes due pending jobs, oldest first, and locks them", async () => {
    const later = await queue.enqueue({ type: "t", runAt: at(60_000) });
    const second = await queue.enqueue({ type: "t", runAt: at(-1_000) });
    const first = await queue.enqueue({ type: "t", runAt: at(-5_000) });
    const claimed = await queue.claim(10, LOCK_MS, "w1");
    expect(claimed.map((j) => j.id)).toEqual([first.id, second.id]);
    expect(claimed[0]).toMatchObject({ status: "running", attempts: 1, lockedBy: "w1" });
    expect(claimed[0].lockedUntil).toEqual(at(LOCK_MS));
    expect((await getJob(later.id)).status).toBe("pending");
  });

  it("two consecutive claims never return the same job, and each takes at most its limit", async () => {
    for (let i = 0; i < 3; i++) await queue.enqueue({ type: "t", runAt: at(-i * 1_000) });
    const first = await queue.claim(2, LOCK_MS, "w1");
    const second = await queue.claim(2, LOCK_MS, "w2");
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(1);
    expect(second[0].id).not.toBe(first[0].id);
    expect(second[0].id).not.toBe(first[1].id);
    expect(await queue.claim(2, LOCK_MS, "w3")).toHaveLength(0);
  });

  it("never gives the same job to two concurrent claims", async () => {
    for (let i = 0; i < 20; i++) await queue.enqueue({ type: "t" });
    const results = await Promise.all(["a", "b", "c", "d"].map((w) => queue.claim(10, LOCK_MS, w)));
    const ids = results.flat().map((j) => j.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  it("takes a running job again once its lock expires", async () => {
    const { id } = await queue.enqueue({ type: "t" });
    await queue.claim(1, LOCK_MS, "w1");
    expect(await queue.claim(1, LOCK_MS, "w2")).toHaveLength(0);
    advance(LOCK_MS + 1);
    const [again] = await queue.claim(1, LOCK_MS, "w2");
    expect(again).toMatchObject({ id, lockedBy: "w2", attempts: 2 });
    // The first worker lost it: its result is ignored.
    expect(await queue.complete(id, "w1")).toBe(false);
    expect(await queue.complete(id, "w2")).toBe(true);
  });

  it("gives up a stale job that already used all its attempts", async () => {
    const { id } = await queue.enqueue({ type: "t", maxAttempts: 1 });
    await queue.claim(1, LOCK_MS, "w1");
    advance(LOCK_MS + 1);
    expect(await queue.claim(1, LOCK_MS, "w2")).toHaveLength(0);
    expect((await getJob(id)).status).toBe("failed");
  });
});

describe("complete, fail and retries [MOT-16]", () => {
  it("complete marks the job done", async () => {
    const { id } = await queue.enqueue({ type: "t" });
    await queue.claim(1, LOCK_MS, "w1");
    expect(await queue.complete(id, "w1")).toBe(true);
    expect(await getJob(id)).toMatchObject({ status: "done", lockedBy: null, lockedUntil: null });
  });

  it("fail retries with growing waits and fails for good after max attempts", async () => {
    const { id } = await queue.enqueue({ type: "t", maxAttempts: 3 });
    const expectedDelays = [backoffMs(1), backoffMs(2)];
    expect(expectedDelays).toEqual([BACKOFF_BASE_MS, BACKOFF_BASE_MS * 2]);
    for (const delay of expectedDelays) {
      await queue.claim(1, LOCK_MS, "w1");
      expect(await queue.fail(id, "w1", "Error pasajero")).toBe("retry");
      const job = await getJob(id);
      expect(job.status).toBe("pending");
      expect(job.lastError).toBe("Error pasajero");
      expect(job.runAt.getTime()).toBe(nowMs + delay);
      // Not due before the backoff.
      expect(await queue.claim(1, LOCK_MS, "w1")).toHaveLength(0);
      advance(delay);
    }
    await queue.claim(1, LOCK_MS, "w1");
    expect(await queue.fail(id, "w1", "Error final")).toBe("failed");
    expect(await getJob(id)).toMatchObject({ status: "failed", attempts: 3, lastError: "Error final" });
  });

  it("a non-retryable failure fails at once", async () => {
    const { id } = await queue.enqueue({ type: "t" });
    await queue.claim(1, LOCK_MS, "w1");
    expect(await queue.fail(id, "w1", "Datos incorrectos", { retryable: false })).toBe("failed");
  });

  it("backoff is capped at one hour", () => {
    expect(backoffMs(30)).toBe(60 * 60_000);
  });

  it("a retry gives way to a newer pending job with the same key", async () => {
    const { id } = await queue.enqueue({ type: "reply", dedupeKey: "conv:9" });
    await queue.claim(1, LOCK_MS, "w1");
    const newer = await queue.enqueue({ type: "reply", dedupeKey: "conv:9" });
    expect(newer.created).toBe(true);
    expect(await queue.fail(id, "w1", "Error")).toBe("superseded");
    expect((await getJob(id)).status).toBe("cancelled");
    expect((await getJob(newer.id)).status).toBe("pending");
  });

  it("reschedule gives the job back without counting a failure", async () => {
    const { id } = await queue.enqueue({ type: "t" });
    await queue.claim(1, LOCK_MS, "w1");
    expect(await queue.reschedule(id, "w1", at(30_000))).toBe(true);
    expect(await getJob(id)).toMatchObject({ status: "pending", attempts: 0, lockedBy: null });
    expect((await getJob(id)).runAt).toEqual(at(30_000));
  });

  it("retryFailed puts a failed job back in the queue", async () => {
    const { id } = await queue.enqueue({ type: "t" });
    await queue.claim(1, LOCK_MS, "w1");
    await queue.fail(id, "w1", "x", { retryable: false });
    expect(await queue.retryFailed(id)).toBe(true);
    expect(await getJob(id)).toMatchObject({ status: "pending", attempts: 0 });
    expect(await queue.retryFailed(id)).toBe(false);
  });
});

describe("recurring jobs", () => {
  it("ensureRecurring keeps a single active job and complete schedules the next run", async () => {
    const a = await queue.ensureRecurring({ type: "mail.poll", key: "mail", intervalMs: 60_000 });
    const b = await queue.ensureRecurring({ type: "mail.poll", key: "mail", intervalMs: 60_000 });
    expect(b).toMatchObject({ id: a.id, created: false });
    await queue.claim(1, LOCK_MS, "w1");
    expect(await queue.ensureRecurring({ type: "mail.poll", key: "mail", intervalMs: 60_000 })).toMatchObject({
      id: a.id,
      created: false,
    });
    await queue.complete(a.id, "w1");
    const job = await getJob(a.id);
    expect(job).toMatchObject({ status: "pending", attempts: 0 });
    expect(job.runAt).toEqual(at(60_000));
  });

  it("a recurring job that keeps failing is re-scheduled instead of dying", async () => {
    const { id } = await queue.ensureRecurring({ type: "health", key: "health", intervalMs: 6 * 3_600_000 });
    await db.update(jobs).set({ maxAttempts: 1 }).where(eq(jobs.id, id));
    await queue.claim(1, LOCK_MS, "w1");
    expect(await queue.fail(id, "w1", "Meta no responde")).toBe("rescheduled");
    const job = await getJob(id);
    expect(job).toMatchObject({ status: "pending", attempts: 0, lastError: "Meta no responde" });
    expect(job.runAt).toEqual(at(6 * 3_600_000));
  });
});

describe("cancel, stats and clean-up", () => {
  it("cancels pending jobs by id or dedupe key", async () => {
    const a = await queue.enqueue({ type: "t" });
    await queue.enqueue({ type: "t", dedupeKey: "k" });
    expect(await queue.cancel({ id: a.id })).toBe(1);
    expect(await queue.cancel({ dedupeKey: "k" })).toBe(1);
    expect(await queue.cancel({ dedupeKey: "k" })).toBe(0);
  });

  it("counts jobs by status and the due ones", async () => {
    await queue.enqueue({ type: "t", runAt: at(-10_000) });
    await queue.enqueue({ type: "t", runAt: at(60_000) });
    const { id } = await queue.enqueue({ type: "t", runAt: at(-20_000) });
    await queue.claim(1, LOCK_MS, "w1");
    await queue.fail(id, "w1", "x", { retryable: false });
    const stats = await queue.stats();
    expect(stats).toMatchObject({ pending: 2, due: 1, failed: 1, running: 0, done: 0 });
    expect(stats.oldestDueAt).toEqual(at(-10_000));
  });

  it("deletes finished jobs older than a date", async () => {
    const { id } = await queue.enqueue({ type: "t" });
    await queue.claim(1, LOCK_MS, "w1");
    await queue.complete(id, "w1");
    await queue.enqueue({ type: "t" });
    expect(await queue.deleteFinishedBefore(at(1))).toBe(1);
    expect(await db.select().from(jobs)).toHaveLength(1);
  });
});
