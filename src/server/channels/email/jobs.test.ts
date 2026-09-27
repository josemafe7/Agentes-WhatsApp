// The email poll job ([MOT-15], [CAN-15], [ARR-11]): one recurring job per mailbox, never for demo, draft or disabled
// channels, one poll at a time, and «error» with a notice after several failures in a row.
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deleteChannel, updateChannel } from "@/data/channels";
import { db } from "@/db";
import { channels, jobs, notifications } from "@/db/schema";
import { getJobRegistration } from "@/server/jobs/registry";
import { tryAcquireLease } from "@/server/kv";
import { createBusiness, createChannel, createUser } from "@/test/factories";
import { encryptOAuthSecrets, readEmailConfig } from "./config";
import { EMAIL_POLL_INTERVAL_MS, MAX_SYNC_FAILURES } from "./constants";
import { cancelEmailJobs, EMAIL_POLL_JOB, emailPollLeaseKey, ensureEmailPolling, ensureEmailPollingForAll, runEmailPoll } from "./jobs";
import { fakeGoogle } from "./test-helpers";

const HOUR = 60 * 60_000;

function gmailChannel(overrides: Parameters<typeof createChannel>[0] = {}) {
  return createChannel({
    type: "email_gmail",
    status: "connected",
    config: { emailAddress: "hola@negocio.test", gmail: { clientId: "1.apps.googleusercontent.com", historyId: "100" } },
    secretsEnc: encryptOAuthSecrets({ clientSecret: "s", refreshToken: "r", accessToken: "ya29.ok", accessExpiresAt: new Date(Date.now() + HOUR) }),
    ...overrides,
  });
}

describe("email.poll", () => {
  it("está registrado y se programa una sola vez por buzón, cada minuto", async () => {
    expect(getJobRegistration(EMAIL_POLL_JOB)).toBeDefined();
    const channel = await gmailChannel();
    await ensureEmailPolling(channel.id);
    await ensureEmailPolling(channel.id);
    const rows = await db.select().from(jobs).where(eq(jobs.dedupeKey, `recurring:email.poll:${channel.id}`));
    expect(rows).toHaveLength(1);
    expect(rows[0].intervalMs).toBe(EMAIL_POLL_INTERVAL_MS);
    await cancelEmailJobs(channel.id);
    const [cancelled] = await db.select().from(jobs).where(eq(jobs.dedupeKey, `recurring:email.poll:${channel.id}`));
    expect(cancelled.status).toBe("cancelled");
  });

  it("al arrancar, cada buzón conectado recupera su lectura periódica si la había perdido (nunca los de demo)", async () => {
    const connected = await gmailChannel();
    const demo = await gmailChannel({ isDemo: true });
    await ensureEmailPollingForAll();
    expect(await db.select().from(jobs).where(eq(jobs.dedupeKey, `recurring:email.poll:${connected.id}`))).toHaveLength(1);
    expect(await db.select().from(jobs).where(eq(jobs.dedupeKey, `recurring:email.poll:${demo.id}`))).toHaveLength(0);
  });

  it("[ARR-11] nunca lee buzones de demo, en borrador o desactivados", async () => {
    const google = fakeGoogle();
    for (const [overrides, reason] of [
      [{ isDemo: true }, "demo"],
      [{ status: "draft" as const }, "inactive"],
      [{ status: "disabled" as const }, "inactive"],
    ] as const) {
      const channel = await gmailChannel(overrides);
      await expect(runEmailPoll(channel.id, {}, google.deps)).resolves.toEqual({ kind: "skipped", reason });
    }
    expect(google.calls).toHaveLength(0);
  });

  it("[CAN-16] un buzón borrado deja de leerse; desactivado no se lee y, al volver a activarlo, se lee otra vez", async () => {
    const owner = await createUser("owner");
    const recurring = (channelId: string) => db.select().from(jobs).where(eq(jobs.dedupeKey, `recurring:email.poll:${channelId}`));

    const deleted = await gmailChannel();
    await ensureEmailPolling(deleted.id);
    await deleteChannel(owner.actor, deleted.id);
    expect((await recurring(deleted.id)).map((job) => job.status)).toEqual(["cancelled"]);

    const google = fakeGoogle();
    const switched = await gmailChannel();
    await updateChannel(owner.actor, switched.id, { enabled: false });
    await expect(runEmailPoll(switched.id, {}, google.deps)).resolves.toEqual({ kind: "skipped", reason: "inactive" });
    expect(google.calls).toHaveLength(0);
    await updateChannel(owner.actor, switched.id, { enabled: true });
    expect((await recurring(switched.id)).map((job) => job.status)).toEqual(["pending"]);
    await expect(runEmailPoll(switched.id, {}, google.deps)).resolves.toMatchObject({ kind: "polled" });
    const [row] = await db.select().from(channels).where(eq(channels.id, switched.id));
    expect(row.status).toBe("connected");
  });

  it("dos rondas a la vez del mismo buzón: una espera", async () => {
    const google = fakeGoogle();
    const channel = await gmailChannel();
    await tryAcquireLease(emailPollLeaseKey(channel.id), "otra-ronda", 60_000);
    await expect(runEmailPoll(channel.id, {}, google.deps)).resolves.toEqual({ kind: "skipped", reason: "busy" });
  });

  it("[CAN-15] tras varios fallos seguidos, «error» con el motivo en español y un aviso; al volver, «conectado»", async () => {
    await createBusiness();
    const owner = await createUser("owner");
    const google = fakeGoogle();
    const channel = await gmailChannel();
    const down: typeof fetch = async () => new Response(JSON.stringify({ error: { code: 503, message: "x" } }), { status: 503 });
    for (let attempt = 1; attempt <= MAX_SYNC_FAILURES; attempt++) {
      await expect(runEmailPoll(channel.id, {}, { ...google.deps, fetchImpl: down })).resolves.toMatchObject({ kind: "failed", reconnect: false });
    }
    let [row] = await db.select().from(channels).where(eq(channels.id, channel.id));
    expect(row.status).toBe("error");
    expect(row.lastHealth?.error).toBe("Gmail no está disponible ahora mismo. Lo reintentamos.");
    expect(await db.select().from(notifications).where(and(eq(notifications.channelId, channel.id), eq(notifications.userId, owner.userId)))).toHaveLength(1);
    await expect(runEmailPoll(channel.id, {}, google.deps)).resolves.toMatchObject({ kind: "polled" });
    [row] = await db.select().from(channels).where(eq(channels.id, channel.id));
    expect(row.status).toBe("connected");
    expect(readEmailConfig(row.config).syncFailures).toBe(0);
    expect(row.lastHealth?.checks.map((check) => check.key)).toEqual(["connection", "last_read"]);
  });
});
