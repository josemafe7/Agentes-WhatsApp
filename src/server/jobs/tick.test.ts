import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { backoffMs, PgJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import { getKv } from "@/server/kv";
import { PermanentJobError, registerJobHandler } from "./registry";
import { LAST_TICK_KV_KEY, tick } from "./tick";

const START = new Date("2026-09-26T10:00:00Z").getTime();
let nowMs = START;
const clock = () => nowMs;
const queue = new PgJobQueue({ now: () => new Date(nowMs) });
const BUDGET = 25_000;
const run = (extra: Partial<Parameters<typeof tick>[0]> = {}) => tick({ budgetMs: BUDGET, queue, clock, ...extra });

async function statusOf(id: string) {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row;
}

beforeEach(async () => {
  nowMs = START;
  await db.delete(jobs);
});

describe("tick() [MOT-15] [MOT-16]", () => {
  it("runs due jobs with their payload and marks them done", async () => {
    const seen: unknown[] = [];
    registerJobHandler("test.ok", async (payload) => void seen.push(payload));
    const { id } = await queue.enqueue({ type: "test.ok", payload: { n: 1 } });
    await queue.enqueue({ type: "test.ok", payload: { n: 2 }, runAt: new Date(START + 60_000) });
    const summary = await run();
    expect(summary).toMatchObject({ claimed: 1, completed: 1, stoppedBy: "idle" });
    expect(seen).toEqual([{ n: 1 }]);
    expect((await statusOf(id)).status).toBe("done");
  });

  it("retries a failing job with growing waits and fails it after its attempts, without throwing", async () => {
    let calls = 0;
    registerJobHandler("test.flaky", async () => {
      calls++;
      throw new Error("Servicio caído Bearer abc123");
    });
    const { id } = await queue.enqueue({ type: "test.flaky", maxAttempts: 3 });
    expect(await run()).toMatchObject({ retried: 1 });
    expect((await statusOf(id)).lastError).not.toContain("abc123");
    expect(await run()).toMatchObject({ claimed: 0 }); // waiting for the backoff
    nowMs += backoffMs(1);
    expect(await run()).toMatchObject({ retried: 1 });
    nowMs += backoffMs(2);
    expect(await run()).toMatchObject({ failed: 1 });
    expect(calls).toBe(3);
    expect(await statusOf(id)).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("fails at once on PermanentJobError, invalid payloads and unknown types", async () => {
    registerJobHandler("test.permanent", async () => {
      throw new PermanentJobError("Falta configurar algo");
    });
    registerJobHandler("test.typed", async () => undefined, { payload: z.object({ id: z.string() }) });
    const a = await queue.enqueue({ type: "test.permanent" });
    const b = await queue.enqueue({ type: "test.typed", payload: { id: 42 } });
    const c = await queue.enqueue({ type: "test.unknown-type" });
    expect(await run()).toMatchObject({ claimed: 3, failed: 3 });
    expect(await statusOf(a.id)).toMatchObject({ status: "failed", lastError: "Falta configurar algo" });
    expect(await statusOf(b.id)).toMatchObject({ status: "failed", lastError: "Los datos del trabajo no son válidos." });
    expect((await statusOf(c.id)).lastError).toContain("Tipo de trabajo desconocido");
  });

  it("stops starting jobs when the budget is spent and leaves the rest for the next tick", async () => {
    registerJobHandler("test.slow", async () => {
      nowMs += BUDGET;
    });
    await queue.enqueue({ type: "test.slow" });
    await queue.enqueue({ type: "test.slow" });
    expect(await run()).toMatchObject({ claimed: 1, completed: 1, stoppedBy: "budget" });
    expect(await run()).toMatchObject({ claimed: 1, completed: 1 });
  });

  it("respects maxJobs", async () => {
    registerJobHandler("test.quick", async () => undefined);
    for (let i = 0; i < 3; i++) await queue.enqueue({ type: "test.quick" });
    expect(await run({ maxJobs: 2 })).toMatchObject({ claimed: 2, stoppedBy: "max_jobs" });
  });

  it("parallel ticks run each job exactly once (atomic claim)", async () => {
    const runs = new Map<string, number>();
    registerJobHandler("test.count", async (payload: { n: number }) => {
      runs.set(String(payload.n), (runs.get(String(payload.n)) ?? 0) + 1);
    });
    for (let n = 0; n < 12; n++) await queue.enqueue({ type: "test.count", payload: { n } });
    const summaries = await Promise.all([run({ workerId: "a" }), run({ workerId: "b" }), run({ workerId: "c" })]);
    expect(summaries.reduce((total, s) => total + s.completed, 0)).toBe(12);
    expect([...runs.values()].every((count) => count === 1)).toBe(true);
    expect(runs.size).toBe(12);
  });

  it("a handler can ask to run again later instead of finishing", async () => {
    registerJobHandler("test.chunked", async (_payload, context) => {
      context.rescheduleAt(new Date(START + 5_000));
    });
    const { id } = await queue.enqueue({ type: "test.chunked" });
    expect(await run()).toMatchObject({ rescheduled: 1 });
    expect(await statusOf(id)).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("a debounced reply only runs when due, once for the whole burst [MOT-01]", async () => {
    let replies = 0;
    registerJobHandler("test.reply", async () => {
      replies++;
    });
    const maxRunAt = new Date(START + 20_000);
    await queue.upsertDebounced({ type: "test.reply", dedupeKey: "conv:1", runAt: new Date(START + 6_000), maxRunAt });
    nowMs += 4_000;
    await queue.upsertDebounced({ type: "test.reply", dedupeKey: "conv:1", runAt: new Date(nowMs + 6_000), maxRunAt });
    nowMs += 5_000;
    expect(await run()).toMatchObject({ claimed: 0 });
    nowMs += 1_000;
    expect(await run()).toMatchObject({ completed: 1 });
    expect(replies).toBe(1);
  });

  it("never throws when the queue itself fails", async () => {
    const broken = { claim: async () => Promise.reject(new Error("database is locked token=abc")) } as unknown as JobQueue;
    const summary = await tick({ budgetMs: BUDGET, queue: broken, clock });
    expect(summary.stoppedBy).toBe("error");
    expect(summary.error).not.toContain("abc");
  });

  it("records the last tick for Diagnóstico [AJU-11]", async () => {
    const summary = await run({ workerId: "tick-diag" });
    expect(await getKv<{ workerId: string }>(LAST_TICK_KV_KEY)).toMatchObject({ workerId: summary.workerId });
  });
});
