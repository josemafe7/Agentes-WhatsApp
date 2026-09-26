import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, jobs, realtimeEvents, webhookEvents } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { getJobQueue } from "@/server/adapters/job-queue";
import { getRealtime } from "@/server/adapters/realtime";
import { AuthError, NotFoundError } from "@/server/errors";
import { LAST_TICK_KV_KEY } from "@/server/jobs";
import { setKv } from "@/server/kv";
import { actorFor, createBusiness, createChannel } from "@/test/factories";
import journal from "../../drizzle/meta/_journal.json";
import { cancelJob, getDiagnostics, retryJob } from "./diagnostics";

const owner = actorFor("owner");
const admin = actorFor("admin");
const denied: Role[] = ["supervisor", "agent", "viewer"];

async function jobWith(values: Partial<typeof jobs.$inferInsert>) {
  const { id } = await getJobQueue().enqueue({ type: "test.job" });
  const [row] = await db.update(jobs).set(values).where(eq(jobs.id, id)).returning();
  return row;
}

beforeEach(async () => {
  await createBusiness();
  await db.delete(jobs);
  await db.delete(auditLog);
});

describe("getDiagnostics [AJU-11]", () => {
  it("database: reachable, driver, size and every migration applied", async () => {
    const { database } = await getDiagnostics(owner);
    expect(database.ok).toBe(true);
    expect(database.driver).toBe("local");
    expect(database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(database.sizeBytes).toBeGreaterThan(0);
    expect(database.migrations).toMatchObject({ applied: journal.entries.length, total: journal.entries.length, pending: [] });
    // Never the connection string: it can carry a path or a host that is nobody's business.
    expect(JSON.stringify(database)).not.toContain(process.env.DATABASE_URL ?? "file:");
  });

  it("queue: counts by status, last round, and jobs with errors without secrets", async () => {
    await getJobQueue().enqueue({ type: "pending.job" });
    const failed = await jobWith({
      status: "failed",
      attempts: 5,
      lastError: "401 de OpenRouter con Authorization: Bearer sk-or-v1-abcdefghijklmnopqrstu",
    });
    const retrying = await jobWith({ status: "pending", attempts: 2, lastError: "Tiempo agotado", runAt: new Date(Date.now() + 60_000) });
    await setKv(LAST_TICK_KV_KEY, { at: "2026-09-26T10:00:00.000Z", completed: 3, failed: 1, stoppedBy: "idle" });

    const { queue } = await getDiagnostics(admin);
    expect(queue.stats).toMatchObject({ pending: 2, failed: 1, running: 0 });
    expect(queue.lastTick).toEqual({ at: new Date("2026-09-26T10:00:00.000Z"), completed: 3, failed: 1 });
    const byId = new Map(queue.jobsWithErrors.map((job) => [job.id, job]));
    expect(byId.get(failed.id)).toMatchObject({ status: "failed", attempts: 5, canRetry: true, canCancel: false });
    expect(byId.get(retrying.id)).toMatchObject({ status: "pending", canRetry: false, canCancel: true });
    expect(JSON.stringify(queue)).not.toContain("sk-or-v1-abcdefghijklmnopqrstu");
  });

  it("realtime: number of events and the newest one", async () => {
    await db.delete(realtimeEvents);
    await getRealtime().publish("inbox", {});
    await getRealtime().publish("inbox", {});
    const { realtime } = await getDiagnostics(owner);
    expect(realtime.count).toBe(2);
    expect(realtime.lastAt).toBeInstanceOf(Date);
  });

  it("webhooks: the last one per WhatsApp or Telegram channel, and those of unknown numbers", async () => {
    await db.delete(webhookEvents);
    const whatsapp = await createChannel({ type: "whatsapp", name: "Recepción" });
    const telegram = await createChannel({ type: "telegram", name: "Bot" });
    await createChannel({ type: "webchat", name: "Web" });
    const older = new Date("2026-09-26T08:00:00Z");
    const newer = new Date("2026-09-26T09:00:00Z");
    await db.insert(webhookEvents).values([
      { source: "whatsapp", channelId: whatsapp.id, signatureValid: true, receivedAt: older },
      { source: "whatsapp", channelId: whatsapp.id, signatureValid: true, receivedAt: newer },
      { source: "whatsapp", channelId: null, signatureValid: true, receivedAt: older, externalAccountId: "123" },
    ]);

    const { webhooks } = await getDiagnostics(owner);
    expect(webhooks.channels).toEqual(
      expect.arrayContaining([
        { channelId: whatsapp.id, name: "Recepción", type: "whatsapp", isDemo: false, lastReceivedAt: newer, count: 2 },
        { channelId: telegram.id, name: "Bot", type: "telegram", isDemo: false, lastReceivedAt: null, count: 0 },
      ]),
    );
    expect(webhooks.channels.map((c) => c.type)).not.toContain("webchat");
    expect(webhooks.unknown).toEqual({ count: 1, lastReceivedAt: older });
  });

  it.each(denied)("%s cannot see it [PER-03] [PER-04]", async (role) => {
    await expect(getDiagnostics(actorFor(role))).rejects.toBeInstanceOf(AuthError);
  });
});

describe("retryJob and cancelJob [AJU-11]", () => {
  it("owner retries a failed job: it runs again now, and it is logged", async () => {
    const failed = await jobWith({ status: "failed", attempts: 5, lastError: "Fallo" });
    await retryJob(owner, { jobId: failed.id });
    const [row] = await db.select().from(jobs).where(eq(jobs.id, failed.id));
    expect(row).toMatchObject({ status: "pending", attempts: 0 });
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "job.retried"));
    expect(entry).toMatchObject({ actorType: "user", targetType: "job", targetId: failed.id });
  });

  it("admin cancels a job that is waiting to retry, and it is logged", async () => {
    const retrying = await jobWith({ status: "pending", attempts: 2, lastError: "Tiempo agotado" });
    await cancelJob(admin, { jobId: retrying.id });
    const [row] = await db.select().from(jobs).where(eq(jobs.id, retrying.id));
    expect(row.status).toBe("cancelled");
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "job.cancelled"))).length).toBe(1);
  });

  it("only failed jobs are retried and only pending ones cancelled", async () => {
    const done = await jobWith({ status: "done" });
    await expect(retryJob(owner, { jobId: done.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelJob(owner, { jobId: done.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(retryJob(owner, { jobId: crypto.randomUUID() })).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it.each(denied)("%s cannot retry or cancel and nothing changes [PER-03] [PER-04]", async (role) => {
    const failed = await jobWith({ status: "failed", lastError: "Fallo" });
    const pending = await jobWith({ status: "pending", lastError: "Fallo" });
    await expect(retryJob(actorFor(role), { jobId: failed.id })).rejects.toBeInstanceOf(AuthError);
    await expect(cancelJob(actorFor(role), { jobId: pending.id })).rejects.toBeInstanceOf(AuthError);
    const rows = await db.select({ id: jobs.id, status: jobs.status }).from(jobs);
    expect(rows).toEqual(expect.arrayContaining([{ id: failed.id, status: "failed" }, { id: pending.id, status: "pending" }]));
  });
});
