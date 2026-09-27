import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { updateChannel } from "@/data/channels";
import { db } from "@/db";
import { appKv, channels, contactIdentities, contacts, conversations, jobs, messages, notifications, realtimeEvents, webhookEvents, whatsappTemplates } from "@/db/schema";
import type { Job } from "@/server/adapters/job-queue";
import { replyLeaseKey } from "@/server/engine/reply";
import { tryAcquireLease } from "@/server/kv";
import { FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes } from "@/test/fake-openrouter";
import { createAgentRow, createBusiness, createChannel, createUser, type TestUser } from "@/test/factories";
import { fixtureText, signWebhook, WA_TEST } from "@/test/fixtures/whatsapp";
import { connectedNumberRoutes, debugTokenResponse, FAKE_META_BASE_URL, fakeMetaFetch, metaError, metaJson, type MetaHandler } from "@/test/fixtures/whatsapp/fake-meta";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import type { ChannelRecord } from "../types";
import { encryptWhatsAppSecrets } from "./config";
import { runHealthCheck, runMediaDownload, runStatusRetry, worsenedChecks } from "./jobs";
import { MEDIA_DOWNLOAD_JOB, type MediaDownloadPayload } from "./media";
import { processWhatsAppWebhook } from "./webhook";

const T0 = new Date("2026-09-26T10:00:05Z");
const WEBHOOK_URL = "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=TEST900000000000001";
let owner: TestUser;
let channel: ChannelRecord;

async function receive(name: "voice" | "text") {
  const text = fixtureText(name);
  await processWhatsAppWebhook(new TextEncoder().encode(text), signWebhook(text), { now: T0 });
}

async function mediaJob(attempts = 1): Promise<{ job: Job; payload: MediaDownloadPayload }> {
  const [job] = await db.select().from(jobs).where(eq(jobs.type, MEDIA_DOWNLOAD_JOB));
  return { job: { ...job, attempts }, payload: job.payload as MediaDownloadPayload };
}

const context = (job: Job) => ({ job, remainingMs: () => 60_000 });
const deps = (handler: MetaHandler) => {
  const fake = fakeMetaFetch(handler);
  const memory = memoryFileStorage();
  return { fake, memory, deps: { fetchImpl: fake.fetch, baseUrl: FAKE_META_BASE_URL, storage: memory.storage } };
};

beforeAll(async () => {
  owner = await createUser("owner");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  for (const table of [notifications, messages, conversations, contactIdentities, contacts, whatsappTemplates, webhookEvents, jobs, realtimeEvents, appKv]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
  const agent = await createAgentRow();
  channel = await createChannel({
    type: "whatsapp",
    name: "WhatsApp Peluquería",
    status: "connected",
    phoneNumberId: WA_TEST.phoneNumberId,
    wabaId: WA_TEST.wabaId,
    metaAppId: WA_TEST.appId,
    graphApiVersion: "v26.0",
    activeAgentId: agent.id,
    paymentMethodConfirmedAt: T0,
    secretsEnc: encryptWhatsAppSecrets({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: null }),
  });
});

describe("wa.media_download [WA-41] [MED-08]", () => {
  it("downloads the webhook's URL with the Bearer token and stores it privately", async () => {
    await receive("voice");
    const { job, payload } = await mediaJob();
    const { fake, memory, deps: jobDeps } = deps(() => new Response(new Uint8Array([79, 103, 103, 83]), { headers: { "content-type": "audio/ogg" } }));
    expect(await runMediaDownload(payload, context(job), jobDeps)).toBe("done");
    expect(fake.calls.map((call) => call.url)).toEqual([WEBHOOK_URL]);
    expect(fake.calls[0].headers.get("authorization")).toBe(`Bearer ${WA_TEST.accessToken}`);
    const [message] = await db.select().from(messages);
    expect(message.media).toMatchObject({ downloadStatus: "done", mimeType: "audio/ogg; codecs=opus", size: 4 });
    expect(memory.files.has(message.media?.fileKey ?? "")).toBe(true);
    // Nothing is left behind: a second run does nothing.
    expect(await runMediaDownload(payload, context(job), jobDeps)).toBe("skipped");
  });

  it("a voice note is transcribed right after its download, whether the AI answers or not [MED-01] [MED-04]", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    await receive("voice");
    const { job, payload } = await mediaJob();
    const { deps: jobDeps } = deps(() => new Response(new Uint8Array([79, 103, 103, 83]), { headers: { "content-type": "audio/ogg" } }));
    const openRouter = fakeFetch(
      routes({ "POST /audio/transcriptions": () => jsonResponse({ text: "Hola, quería pedir cita para el martes", usage: { seconds: 3, cost: 0.00001 } }) }),
    );
    expect(await runMediaDownload(payload, context(job), { ...jobDeps, openRouterFetch: openRouter.fetch })).toBe("done");
    expect(openRouter.calls.map((call) => call.path)).toEqual(["/audio/transcriptions"]);
    const [message] = await db.select().from(messages);
    expect(message).toMatchObject({ contentType: "audio", transcript: "Hola, quería pedir cita para el martes" });
    expect(message.media).toMatchObject({ downloadStatus: "done" });
  });

  it("an image is stored privately and never transcribed [WA-41] [MED-08]", async () => {
    const text = fixtureText("image");
    await processWhatsAppWebhook(new TextEncoder().encode(text), signWebhook(text), { now: T0 });
    const { job, payload } = await mediaJob();
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const { fake, memory, deps: jobDeps } = deps((call) =>
      call.path === "/900000000000002" || call.path.endsWith("/900000000000002")
        ? metaJson({ url: `${FAKE_META_BASE_URL}/media/download/900000000000002`, mime_type: "image/png", sha256: "x", file_size: "8", id: "900000000000002" })
        : new Response(png, { headers: { "content-type": "image/png" } }),
    );
    expect(await runMediaDownload(payload, context(job), jobDeps)).toBe("done");
    expect(fake.calls.every((call) => call.headers.get("authorization") === `Bearer ${WA_TEST.accessToken}`)).toBe(true);
    const [message] = await db.select().from(messages);
    expect(message).toMatchObject({ contentType: "image", transcript: null });
    expect(message.media).toMatchObject({ downloadStatus: "done" });
    expect(memory.files.has(message.media?.fileKey ?? "")).toBe(true);
  });

  it("an expired URL (404) asks Meta for a fresh one with GET /{media_id}", async () => {
    await receive("voice");
    const { job, payload } = await mediaJob();
    const fresh = `${FAKE_META_BASE_URL}/media/download/900000000000001`;
    const { fake, deps: jobDeps } = deps((call) => {
      if (call.url === WEBHOOK_URL) return new Response("gone", { status: 404 });
      if (call.path === "/900000000000001") return metaJson({ url: fresh, mime_type: "audio/ogg", sha256: "x", file_size: "3", id: "900000000000001" });
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/ogg" } });
    });
    expect(await runMediaDownload(payload, context(job), jobDeps)).toBe("done");
    expect(fake.calls.map((call) => call.path)).toEqual(["/whatsapp_business/attachments/", "/900000000000001", "/media/download/900000000000001"]);
    expect(fake.calls[1].query.get("phone_number_id")).toBe(WA_TEST.phoneNumberId);
  });

  it("retries while attempts remain; after the last one the message says the file could not be downloaded", async () => {
    await receive("voice");
    const failing = deps(() => metaError(2, 503));
    const first = await mediaJob(1);
    await expect(runMediaDownload(first.payload, context(first.job), failing.deps)).rejects.toBeTruthy();
    const last = await mediaJob(first.job.maxAttempts);
    expect(await runMediaDownload(last.payload, context(last.job), failing.deps)).toBe("failed");
    const [message] = await db.select().from(messages);
    expect(message.media?.downloadStatus).toBe("failed");
  });

  it("holds the conversation's reply lease while downloading, so the reply waits for the file [MOT-04]", async () => {
    await receive("voice");
    const { job, payload } = await mediaJob();
    const [conversation] = await db.select().from(conversations);
    let replyGotLease: boolean | null = null;
    const { deps: jobDeps } = deps(async () => {
      replyGotLease = await tryAcquireLease(replyLeaseKey(conversation.id), "reply-job", 60_000);
      return new Response(new Uint8Array([1]), { headers: { "content-type": "audio/ogg" } });
    });
    await runMediaDownload(payload, context(job), jobDeps);
    expect(replyGotLease).toBe(false);
    expect(await tryAcquireLease(replyLeaseKey(conversation.id), "reply-job", 60_000)).toBe(true);
  });
});

describe("wa.health_check [WA-26] [WA-29] [CAN-15]", () => {
  it("stores the lights and the number's data; a healthy number stays «conectado»", async () => {
    const { deps: jobDeps } = deps(connectedNumberRoutes());
    const report = await runHealthCheck(channel.id, jobDeps);
    expect(report?.blocking).toBe(false);
    const [row] = await db.select().from(channels).where(eq(channels.id, channel.id));
    expect(row.status).toBe("connected");
    expect(row.lastHealth?.checks.map((check) => check.key)).toEqual(["token", "registration", "subscription", "webhook", "last_message", "quality", "name", "limit", "send", "payment", "version"]);
    expect(row.lastHealth?.checks.find((check) => check.key === "token")?.status).toBe("ok");
    expect(row).toMatchObject({ qualityRating: "GREEN", nameStatus: "APPROVED", messagingLimit: "TIER_250", webhookStatus: "subscribed" });
  });

  it("when something gets worse the channel goes to «error» and owner and admins are told", async () => {
    await runHealthCheck(channel.id, deps(connectedNumberRoutes()).deps);
    const broken = connectedNumberRoutes({ [`GET /${WA_TEST.wabaId}/subscribed_apps`]: () => metaJson({ data: [] }) });
    const report = await runHealthCheck(channel.id, deps(broken).deps);
    expect(report?.blocking).toBe(true);
    const [row] = await db.select().from(channels).where(eq(channels.id, channel.id));
    expect(row.status).toBe("error");
    expect(row.lastHealth?.error).toContain("no está suscrita");
    const notices = await db.select().from(notifications).where(and(eq(notifications.userId, owner.userId), eq(notifications.event, "channel_error")));
    expect(notices[0]?.title).toContain("Suscripción");
  });

  it("an expired token turns the token light red", async () => {
    const report = await runHealthCheck(channel.id, deps(connectedNumberRoutes({ [`GET /${WA_TEST.phoneNumberId}`]: () => metaError(190, 401) })).deps);
    expect(report?.health.checks.find((check) => check.key === "token")).toMatchObject({ status: "error" });
  });

  it("a number turned off and on again («conectando») is back to «conectado» at its next check [CAN-15] [CAN-16]", async () => {
    await updateChannel(owner.actor, channel.id, { enabled: false });
    await updateChannel(owner.actor, channel.id, { enabled: true });
    const status = async () => (await db.select().from(channels).where(eq(channels.id, channel.id)))[0].status;
    expect(await status()).toBe("connecting");
    await runHealthCheck(channel.id, deps(connectedNumberRoutes()).deps);
    expect(await status()).toBe("connected");
  });

  it("from «conectando»: «error» when the app is subscribed but something blocks; still «conectando» while it is not subscribed [CAN-15] [WA-14]", async () => {
    const status = async () => (await db.select().from(channels).where(eq(channels.id, channel.id)))[0].status;
    await db.update(channels).set({ status: "connecting" }).where(eq(channels.id, channel.id));
    const invalidToken = connectedNumberRoutes({ "GET /debug_token": () => metaJson(debugTokenResponse({ is_valid: false })) });
    expect((await runHealthCheck(channel.id, deps(invalidToken).deps))?.blocking).toBe(true);
    expect(await status()).toBe("error");

    // The wizard has not subscribed the app to the WABA yet: the check does not decide for it.
    await db.update(channels).set({ status: "connecting" }).where(eq(channels.id, channel.id));
    await runHealthCheck(channel.id, deps(connectedNumberRoutes({ [`GET /${WA_TEST.wabaId}/subscribed_apps`]: () => metaJson({ data: [] }) })).deps);
    expect(await status()).toBe("connecting");
  });

  it("drafts and disabled channels are not checked", async () => {
    await db.update(channels).set({ status: "disabled" }).where(eq(channels.id, channel.id));
    const { fake, deps: jobDeps } = deps(connectedNumberRoutes());
    expect(await runHealthCheck(channel.id, jobDeps)).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it("without a previous check only errors notify; later, anything that worsens", () => {
    const ok = { checkedAt: "", checks: [{ key: "quality", status: "ok" as const }] };
    const warn = { checkedAt: "", checks: [{ key: "quality", status: "warn" as const }] };
    expect(worsenedChecks(null, warn)).toEqual([]);
    expect(worsenedChecks(ok, warn)).toHaveLength(1);
    expect(worsenedChecks(warn, ok)).toEqual([]);
  });
});

describe("wa.status_retry (docs §8.2)", () => {
  it("applies the status once its message exists; gives up quietly after a few tries", async () => {
    const payload = { channelId: channel.id, status: { externalId: "wamid.LATE", status: "delivered" as const, at: T0.toISOString(), error: null, pricing: null } };
    const job = { attempts: 1 } as Job;
    await expect(runStatusRetry(payload, { job, remainingMs: () => 1_000 })).rejects.toThrow();
    expect(await runStatusRetry(payload, { job: { ...job, attempts: 3 }, remainingMs: () => 1_000 })).toBe("given_up");
    await receive("text");
    const [conversation] = await db.select().from(conversations);
    await db.insert(messages).values({ conversationId: conversation.id, channelId: channel.id, direction: "outbound", senderType: "human", externalId: "wamid.LATE", status: "sent" });
    expect(await runStatusRetry(payload, { job, remainingMs: () => 1_000 })).toBe("applied");
    const [row] = await db.select().from(messages).where(eq(messages.externalId, "wamid.LATE"));
    expect(row.status).toBe("delivered");
  });
});
