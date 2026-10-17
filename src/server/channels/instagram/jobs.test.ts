import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, jobs, messages, realtimeEvents, webhookEvents } from "@/db/schema";
import type { Job } from "@/server/adapters/job-queue";
import "@/server/jobs/handlers";
import { getJobRegistration } from "@/server/jobs/registry";
import { FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes } from "@/test/fake-openrouter";
import { createAgentRow, createBusiness, createChannel } from "@/test/factories";
import {
  attachmentMessage,
  connectedAccountRoutes,
  deletedMessage,
  fakeInstagramFetch,
  FAKE_INSTAGRAM_CDN,
  IG_TEST,
  igFile,
  instagramWebhook,
  JPEG_BYTES,
  M4A_BYTES,
  PDF_BYTES,
  signedBody,
  type InstagramHandler,
} from "@/test/fixtures/instagram";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import type { ChannelRecord } from "../types";
import { encryptInstagramSecrets } from "./config";
import { runInstagramMediaDownload } from "./jobs";
import { INSTAGRAM_MEDIA_CAPS } from "./media";
import {
  INSTAGRAM_HEALTH_CHECK_JOB,
  INSTAGRAM_MEDIA_DOWNLOAD_JOB,
  INSTAGRAM_PROFILE_JOB,
  type InstagramMediaDownloadPayload,
} from "./schedule";
import { processInstagramWebhook } from "./webhook";

const T0 = new Date("2026-10-16T08:00:05Z");
let channel: ChannelRecord;

async function instagramChannel(overrides: Partial<typeof channels.$inferInsert> = {}): Promise<ChannelRecord> {
  const agent = await createAgentRow();
  return createChannel({
    type: "instagram",
    name: "Instagram Peluquería",
    status: "connected",
    activeAgentId: agent.id,
    config: { accountId: IG_TEST.accountId, username: IG_TEST.username },
    secretsEnc: encryptInstagramSecrets({ accessToken: IG_TEST.accessToken, appSecret: IG_TEST.appSecret, metaAppSecret: null, verifyToken: IG_TEST.verifyToken }),
    ...overrides,
  });
}

async function receive(messaging: unknown[]) {
  const signed = signedBody(instagramWebhook(messaging));
  return processInstagramWebhook(channel.id, signed.raw, signed.signature, { now: T0 });
}

async function mediaJob(attempts = 1): Promise<{ job: Job; payload: InstagramMediaDownloadPayload }> {
  const [job] = await db.select().from(jobs).where(and(eq(jobs.type, INSTAGRAM_MEDIA_DOWNLOAD_JOB), eq(jobs.status, "pending")));
  return { job: { ...job, attempts }, payload: job.payload as InstagramMediaDownloadPayload };
}

const context = (job: Job) => ({ job, remainingMs: () => 60_000 });

function instagram(file: InstagramHandler) {
  const fake = fakeInstagramFetch(connectedAccountRoutes({ "GET file": file }));
  const memory = memoryFileStorage();
  return { calls: fake.calls, memory, deps: { ...fake.deps, storage: memory.storage, now: () => T0 } };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  for (const table of [messages, conversations, contactIdentities, contacts, webhookEvents, jobs, realtimeEvents]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
  channel = await instagramChannel();
});

describe("Instagram jobs are registered with their payloads", () => {
  it("ig.health_check, ig.media_download and ig.profile [IG-03] [IG-08] [IG-09]", () => {
    for (const type of [INSTAGRAM_HEALTH_CHECK_JOB, INSTAGRAM_MEDIA_DOWNLOAD_JOB, INSTAGRAM_PROFILE_JOB]) {
      const registration = getJobRegistration(type);
      expect(registration, type).toBeDefined();
      expect(registration?.payload, type).toBeDefined();
    }
    expect(getJobRegistration(INSTAGRAM_PROFILE_JOB)?.payload?.safeParse({ channelId: crypto.randomUUID(), userId: "../me" }).success).toBe(false);
  });
});

describe("ig.media_download [IG-03] [MED-08]", () => {
  it("downloads an image from Instagram's CDN without the token and stores it privately, typed by its bytes", async () => {
    await receive([attachmentMessage("image", `${FAKE_INSTAGRAM_CDN}/v/t51/foto.jpg`)]);
    const { job, payload } = await mediaJob();
    const { calls, memory, deps } = instagram(() => igFile(JPEG_BYTES, "application/octet-stream"));
    expect(await runInstagramMediaDownload(payload, context(job), deps)).toBe("done");
    expect(calls.map((call) => call.route)).toEqual(["file"]);
    expect(calls[0].headers.get("authorization")).toBeNull();
    const [message] = await db.select().from(messages);
    expect(message.media).toMatchObject({ downloadStatus: "done", mimeType: "image/jpeg", size: JPEG_BYTES.length });
    expect(memory.files.has(message.media?.fileKey ?? "")).toBe(true);
    // The CDN address is not kept once the file is stored.
    expect(JSON.stringify(message.media)).not.toContain(FAKE_INSTAGRAM_CDN);
    expect(await runInstagramMediaDownload(payload, context(job), deps)).toBe("skipped");
  });

  it("a voice note is stored as audio and transcribed right after, whether the AI answers or not [IG-03] [MED-04]", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    await receive([attachmentMessage("audio", `${FAKE_INSTAGRAM_CDN}/v/t59/nota.mp4`)]);
    const { job, payload } = await mediaJob();
    const { deps } = instagram(() => igFile(M4A_BYTES, "audio/mp4"));
    const openRouter = fakeFetch(routes({ "POST /audio/transcriptions": () => jsonResponse({ text: "Quería pedir cita para el martes", usage: { seconds: 3, cost: 0.00001 } }) }));
    expect(await runInstagramMediaDownload(payload, context(job), { ...deps, openRouterFetch: openRouter.fetch })).toBe("done");
    const [message] = await db.select().from(messages);
    expect(message).toMatchObject({ contentType: "audio", transcript: "Quería pedir cita para el martes" });
    expect(message.media).toMatchObject({ mimeType: "audio/mp4" });
  });

  it("a PDF is stored as a document [IG-03]", async () => {
    await receive([attachmentMessage("file", `${FAKE_INSTAGRAM_CDN}/v/t59/presupuesto.pdf`)]);
    const { job, payload } = await mediaJob();
    const { deps } = instagram(() => igFile(PDF_BYTES, "application/octet-stream"));
    expect(await runInstagramMediaDownload(payload, context(job), deps)).toBe("done");
    expect((await db.select().from(messages))[0].media).toMatchObject({ mimeType: "application/pdf" });
  });

  it("an image over Instagram's 8 MB is not stored: «No se pudo descargar el archivo» [IG-03]", async () => {
    await receive([attachmentMessage("image", `${FAKE_INSTAGRAM_CDN}/v/t51/enorme.jpg`)]);
    const { job, payload } = await mediaJob();
    const { deps } = instagram(() => new Response(new Uint8Array(JPEG_BYTES), { headers: { "content-length": String(INSTAGRAM_MEDIA_CAPS.image + 1) } }));
    expect(await runInstagramMediaDownload(payload, context(job), deps)).toBe("failed");
    expect((await db.select().from(messages))[0].media).toMatchObject({ downloadStatus: "failed" });
  });

  it("a failure that may pass is retried by the queue; the last attempt gives up", async () => {
    await receive([attachmentMessage("image", `${FAKE_INSTAGRAM_CDN}/v/t51/foto.jpg`)]);
    const { job, payload } = await mediaJob();
    const { deps } = instagram(() => new Response("Bad Gateway", { status: 502 }));
    await expect(runInstagramMediaDownload(payload, context(job), deps)).rejects.toThrow();
    expect((await db.select().from(messages))[0].media).toMatchObject({ downloadStatus: "pending" });
    expect(await runInstagramMediaDownload(payload, context({ ...job, attempts: job.maxAttempts }), deps)).toBe("failed");
  });

  it("a message the customer deleted is not downloaded any more [IG-07]", async () => {
    await receive([attachmentMessage("image", `${FAKE_INSTAGRAM_CDN}/v/t51/foto.jpg`, { mid: "m-borrar" })]);
    const { job, payload } = await mediaJob();
    await receive([deletedMessage("m-borrar")]);
    const { calls, deps } = instagram(() => igFile(JPEG_BYTES));
    expect(await runInstagramMediaDownload(payload, context(job), deps)).toBe("skipped");
    expect(calls).toHaveLength(0);
    expect((await db.select().from(messages))[0].media).toBeNull();
  });

  it("a demo channel never calls Instagram [ARR-11]", async () => {
    const demo = await instagramChannel({ isDemo: true });
    const { calls, deps } = instagram(() => igFile(JPEG_BYTES));
    const job = { id: crypto.randomUUID(), attempts: 1, maxAttempts: 4 } as Job;
    expect(await runInstagramMediaDownload({ channelId: demo.id, externalId: "m", url: `${FAKE_INSTAGRAM_CDN}/x.jpg`, contentType: "image" }, context(job), deps)).toBe("skipped");
    expect(calls).toHaveLength(0);
  });
});
