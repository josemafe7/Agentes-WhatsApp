// Job «compliance.retention» ([CUM-05], [CUM-06], [MOT-15]): there is always one daily job, it runs in the queue with the
// time of its round and comes back a day later; without time for a batch it tries again shortly instead of starting it.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { appKv, auditLog, jobs } from "@/db/schema";
import { PgJobQueue } from "@/server/adapters/job-queue";
import { ensureRetentionJob, RETENTION_INTERVAL_MS, RETENTION_JOB } from "@/server/compliance/retention";
import { createBusiness } from "@/test/factories";
import { getJobRegistration } from "../registry";
import { tick } from "../tick";
import "./retention";

const NOW = new Date("2026-09-30T03:00:00Z");

beforeEach(async () => {
  for (const table of [jobs, auditLog, appKv]) await db.delete(table);
  await createBusiness();
});

describe("the daily clean-up job [CUM-05] [MOT-15]", () => {
  it("there is always exactly one, and asking for it again changes nothing", async () => {
    const queue = new PgJobQueue({ now: () => NOW });
    const first = await ensureRetentionJob({ queue, now: NOW });
    const again = await ensureRetentionJob({ queue, now: NOW });
    expect(again).toMatchObject({ id: first.id, created: false });
    const rows = await db.select().from(jobs).where(eq(jobs.type, RETENTION_JOB));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "pending", intervalMs: RETENTION_INTERVAL_MS, runAt: NOW });
  });

  it("runs in the queue, leaves its summary [CUM-06] and comes back a day later", async () => {
    const queue = new PgJobQueue({ now: () => NOW });
    await ensureRetentionJob({ queue, now: NOW });
    const summary = await tick({ budgetMs: 60_000, queue });
    expect(summary.completed).toBe(1);
    const [job] = await db.select().from(jobs).where(eq(jobs.type, RETENTION_JOB));
    expect(job).toMatchObject({ status: "pending", runAt: new Date(NOW.getTime() + RETENTION_INTERVAL_MS) });
    expect(await db.select().from(auditLog)).toEqual([expect.objectContaining({ actorType: "system", action: "retention.cleanup" })]);
  });

  it("without time for a batch it starts nothing and tries again shortly", async () => {
    const queue = new PgJobQueue({ now: () => NOW });
    await ensureRetentionJob({ queue, now: NOW });
    const [job] = await db.select().from(jobs).where(eq(jobs.type, RETENTION_JOB));
    const registration = getJobRegistration(RETENTION_JOB);
    const state: { rescheduledAt: Date | null } = { rescheduledAt: null };
    const before = Date.now();
    await registration?.handler(
      {},
      {
        job,
        workerId: "prueba",
        queue,
        remainingMs: () => 0,
        rescheduleAt: (runAt) => {
          state.rescheduledAt = runAt;
        },
      },
    );
    expect(state.rescheduledAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });
});
