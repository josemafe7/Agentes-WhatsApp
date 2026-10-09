import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { appKv, channels, contactIdentities, contacts, conversations, jobs, messages, notifications, realtimeEvents, webhookEvents } from "@/db/schema";
import type { Job } from "@/server/adapters/job-queue";
import { REPLY_JOB } from "@/server/engine/schedule";
import { FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes } from "@/test/fake-openrouter";
import { createAgentRow, createBusiness, createChannel, createUser, type TestUser } from "@/test/factories";
import {
  botResponse,
  connectedBotRoutes,
  fakeTelegramFetch,
  JPEG_BYTES,
  OGG_BYTES,
  photoUpdate,
  textUpdate,
  TG_TEST,
  tgError,
  tgFile,
  tgOk,
  voiceUpdate,
  webhookInfoResponse,
  type TelegramHandler,
} from "@/test/fixtures/telegram";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import type { ChannelRecord } from "../types";
import { encryptTelegramSecrets, readTelegramConfig, telegramWebhookUrl } from "./config";
import { MAX_POLL_FAILURES, POLL_BLOCKED_RETRY_MS, runTelegramHealthCheck, runTelegramMediaDownload, runTelegramPoll } from "./jobs";
import { TELEGRAM_MEDIA_DOWNLOAD_JOB, type TelegramMediaDownloadPayload } from "./media";
import { processTelegramWebhook } from "./webhook";

const T0 = new Date("2026-09-26T10:00:05Z");
let owner: TestUser;
let channel: ChannelRecord;

async function telegramChannel(overrides: Partial<typeof channels.$inferInsert> = {}): Promise<ChannelRecord> {
  const agent = await createAgentRow();
  return createChannel({
    type: "telegram",
    name: "Telegram Peluquería",
    status: "connected",
    activeAgentId: agent.id,
    config: { botId: TG_TEST.botId, botUsername: TG_TEST.botUsername, botName: TG_TEST.botName, receiveMode: "webhook" },
    secretsEnc: encryptTelegramSecrets({ botToken: TG_TEST.botToken, webhookSecret: TG_TEST.webhookSecret }),
    ...overrides,
  });
}

const receive = (update: unknown) => processTelegramWebhook(channel.id, new TextEncoder().encode(JSON.stringify(update)), TG_TEST.webhookSecret, { now: T0 });

async function mediaJob(attempts = 1): Promise<{ job: Job; payload: TelegramMediaDownloadPayload }> {
  const [job] = await db.select().from(jobs).where(eq(jobs.type, TELEGRAM_MEDIA_DOWNLOAD_JOB));
  return { job: { ...job, attempts }, payload: job.payload as TelegramMediaDownloadPayload };
}

const context = (job: Job) => ({ job, remainingMs: () => 60_000 });

function telegram(handler: TelegramHandler) {
  const fake = fakeTelegramFetch(handler);
  const memory = memoryFileStorage();
  return { calls: fake.calls, memory, deps: { ...fake.deps, storage: memory.storage, now: () => T0, sleep: async () => undefined } };
}

const fileRoutes = (bytes: Uint8Array, size = bytes.length) =>
  connectedBotRoutes({ getFile: () => tgOk({ file_id: "f", file_unique_id: "u", file_size: size, file_path: "voice/file_7.oga" }), file: () => tgFile(bytes) });

const ownerNotices = () => db.select().from(notifications).where(eq(notifications.userId, owner.userId));
const reload = async () => (await db.select().from(channels).where(eq(channels.id, channel.id)))[0];

beforeAll(async () => {
  owner = await createUser("owner");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  for (const table of [notifications, messages, conversations, contactIdentities, contacts, webhookEvents, jobs, realtimeEvents, appKv]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
  channel = await telegramChannel();
});

describe("tg.media_download [TG-11] [MED-08]", () => {
  it("asks for the file's path, downloads it with the bot's token and stores it privately, typed by its bytes", async () => {
    await receive(voiceUpdate());
    const { job, payload } = await mediaJob();
    const { calls, memory, deps } = telegram(fileRoutes(OGG_BYTES));
    expect(await runTelegramMediaDownload(payload, context(job), deps)).toBe("done");
    expect(calls.map((call) => call.method)).toEqual(["getFile", "file"]);
    expect(calls.every((call) => call.token === TG_TEST.botToken)).toBe(true);
    const [message] = await db.select().from(messages);
    expect(message.media).toMatchObject({ downloadStatus: "done", mimeType: "audio/ogg", size: OGG_BYTES.length, durationSec: 4 });
    expect(memory.files.has(message.media?.fileKey ?? "")).toBe(true);
    // The download address carries the token: nothing of it is kept with the message.
    expect(JSON.stringify(message)).not.toContain(TG_TEST.botToken);
    expect(await runTelegramMediaDownload(payload, context(job), deps)).toBe("skipped");
  });

  it("a voice note is transcribed right after its download, whether the AI answers or not [TG-03] [MED-04]", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
    await receive(voiceUpdate());
    const { job, payload } = await mediaJob();
    const { deps } = telegram(fileRoutes(OGG_BYTES));
    const openRouter = fakeFetch(routes({ "POST /audio/transcriptions": () => jsonResponse({ text: "Hola, quería pedir cita para el martes", usage: { seconds: 3, cost: 0.00001 } }) }));
    expect(await runTelegramMediaDownload(payload, context(job), { ...deps, openRouterFetch: openRouter.fetch })).toBe("done");
    const [message] = await db.select().from(messages);
    expect(message).toMatchObject({ contentType: "audio", transcript: "Hola, quería pedir cita para el martes" });
  });

  it("a photo is stored as the image its bytes show and never transcribed", async () => {
    await receive(photoUpdate("Mira"));
    const { job, payload } = await mediaJob();
    const { deps } = telegram(fileRoutes(JPEG_BYTES));
    expect(await runTelegramMediaDownload(payload, context(job), deps)).toBe("done");
    const [message] = await db.select().from(messages);
    expect(message.media).toMatchObject({ downloadStatus: "done", mimeType: "image/jpeg" });
    expect(message.transcript).toBeNull();
  });

  it("a file bigger than its limit is not downloaded: «No se pudo descargar el archivo» [TG-11]", async () => {
    await receive(voiceUpdate());
    const { job, payload } = await mediaJob();
    const { calls, deps } = telegram(fileRoutes(OGG_BYTES, 30 * 1024 * 1024));
    expect(await runTelegramMediaDownload(payload, context(job), deps)).toBe("failed");
    expect(calls.map((call) => call.method)).toEqual(["getFile"]);
    expect((await db.select().from(messages))[0].media).toMatchObject({ downloadStatus: "failed" });
  });

  it("a failure that may pass is retried by the queue; the last attempt gives up", async () => {
    await receive(voiceUpdate());
    const { job, payload } = await mediaJob();
    const { deps } = telegram(connectedBotRoutes({ getFile: () => tgError(502, "Bad Gateway") }));
    await expect(runTelegramMediaDownload(payload, context(job), deps)).rejects.toThrow();
    expect((await db.select().from(messages))[0].media).toMatchObject({ downloadStatus: "pending" });
    expect(await runTelegramMediaDownload(payload, context({ ...job, attempts: job.maxAttempts }), deps)).toBe("failed");
  });

  it("a revoked token is final at once", async () => {
    await receive(voiceUpdate());
    const { job, payload } = await mediaJob();
    const { deps } = telegram(connectedBotRoutes({ getFile: () => tgError(401, "Unauthorized") }));
    expect(await runTelegramMediaDownload(payload, context(job), deps)).toBe("failed");
  });
});

describe("tg.health_check [TG-08] [CAN-15]", () => {
  it("a bot whose webhook is this channel's is «conectado», with its lights and its current name", async () => {
    vi.stubEnv("APP_URL", "https://agentes.peluqueria-ejemplo.es");
    const { deps } = telegram(connectedBotRoutes({ getMe: () => tgOk(botResponse({ first_name: "Peluquería Aurora" })), getWebhookInfo: () => tgOk(webhookInfoResponse({ url: telegramWebhookUrl(channel.id) })) }));
    const report = await runTelegramHealthCheck(channel.id, deps);
    expect(report?.blocking).toBe(false);
    const row = await reload();
    expect(row.status).toBe("connected");
    expect(row.lastHealth?.checks.map((check) => [check.key, check.status])).toEqual([["token", "ok"], ["receiving", "ok"], ["last_message", "off"]]);
    expect(readTelegramConfig(row.config).botName).toBe("Peluquería Aurora");
    expect(await ownerNotices()).toHaveLength(0);
  });

  it("a revoked token or a webhook taken elsewhere puts it in «error» and tells owner and admins once", async () => {
    vi.stubEnv("APP_URL", "https://agentes.peluqueria-ejemplo.es");
    const revoked = telegram(connectedBotRoutes({ getMe: () => tgError(401, "Unauthorized"), getWebhookInfo: () => tgError(401, "Unauthorized") }));
    expect((await runTelegramHealthCheck(channel.id, revoked.deps))?.blocking).toBe(true);
    let row = await reload();
    expect(row.status).toBe("error");
    expect(row.lastHealth?.error).toMatch(/token del bot no es válido/);
    expect(await ownerNotices()).toHaveLength(1);
    await runTelegramHealthCheck(channel.id, revoked.deps);
    expect(await ownerNotices()).toHaveLength(1);

    const elsewhere = telegram(connectedBotRoutes({ getWebhookInfo: () => tgOk(webhookInfoResponse({ url: "https://otra-herramienta.example/hook" })) }));
    await runTelegramHealthCheck(channel.id, elsewhere.deps);
    row = await reload();
    expect(row.lastHealth?.checks.find((check) => check.key === "receiving")).toMatchObject({ status: "error" });
    expect(row.lastHealth?.error).toMatch(/otra dirección/);
  });

  it("a delivery Telegram could not make in the last day shows in amber, with Telegram's note as data", async () => {
    vi.stubEnv("APP_URL", "https://agentes.peluqueria-ejemplo.es");
    const failedAt = Math.floor(T0.getTime() / 1_000) - 600;
    const { deps } = telegram(connectedBotRoutes({ getWebhookInfo: () => tgOk(webhookInfoResponse({ url: telegramWebhookUrl(channel.id), last_error_date: failedAt, last_error_message: "Wrong response from the webhook: 500 Internal Server Error" })) }));
    const report = await runTelegramHealthCheck(channel.id, deps);
    expect(report?.blocking).toBe(false);
    expect(report?.health.checks.find((check) => check.key === "receiving")).toMatchObject({ status: "warn" });
    expect((await reload()).status).toBe("connected");
  });

  it("drafts, disabled and demo channels are not checked", async () => {
    const { calls, deps } = telegram(connectedBotRoutes());
    await db.update(channels).set({ status: "disabled" }).where(eq(channels.id, channel.id));
    expect(await runTelegramHealthCheck(channel.id, deps)).toBeNull();
    const demo = await telegramChannel({ isDemo: true });
    expect(await runTelegramHealthCheck(demo.id, deps)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("tg.poll: a bot without a public address [TG-06]", () => {
  beforeEach(async () => {
    await db.update(channels).set({ config: { ...channel.config, receiveMode: "polling" } }).where(eq(channels.id, channel.id));
  });

  it("brings the new updates, ingests them like a webhook and moves the offset on", async () => {
    const { calls, deps } = telegram(connectedBotRoutes({ getUpdates: () => tgOk([textUpdate("Hola", { updateId: 200, messageId: 1 }), voiceUpdate({ updateId: 201, messageId: 2 })]) }));
    const outcome = await runTelegramPoll(channel.id, {}, deps);
    expect(outcome).toMatchObject({ kind: "polled", updates: 2 });
    expect(calls[0]).toMatchObject({ method: "getUpdates", body: { limit: 100, timeout: 0, allowed_updates: ["message"] } });
    expect(await db.select().from(messages)).toHaveLength(2);
    expect(await db.select().from(jobs).where(and(eq(jobs.type, REPLY_JOB), eq(jobs.status, "pending")))).toHaveLength(1);
    expect(await db.select().from(jobs).where(eq(jobs.type, TELEGRAM_MEDIA_DOWNLOAD_JOB))).toHaveLength(1);
    expect(readTelegramConfig((await reload()).config).updateOffset).toBe(202);

    const next = telegram(connectedBotRoutes());
    await runTelegramPoll(channel.id, {}, next.deps);
    expect(next.calls[0].body).toMatchObject({ offset: 202 });
  });

  it("updates brought twice (a poll cut half-way) are stored once [CAN-11]", async () => {
    const same = () => tgOk([textUpdate("Hola", { updateId: 300, messageId: 5 })]);
    await runTelegramPoll(channel.id, {}, telegram(connectedBotRoutes({ getUpdates: same })).deps);
    await db.update(channels).set({ config: { ...channel.config, receiveMode: "polling" } }).where(eq(channels.id, channel.id));
    await runTelegramPoll(channel.id, {}, telegram(connectedBotRoutes({ getUpdates: same })).deps);
    expect(await db.select().from(messages)).toHaveLength(1);
  });

  it("a long round waits for updates; a short one only looks", async () => {
    const long = telegram(connectedBotRoutes());
    await runTelegramPoll(channel.id, { remainingMs: () => 240_000 }, long.deps);
    expect(long.calls[0].body).toMatchObject({ timeout: 10 });
    const short = telegram(connectedBotRoutes());
    await runTelegramPoll(channel.id, { remainingMs: () => 50_000 }, short.deps);
    expect(short.calls[0].body).toMatchObject({ timeout: 0 });
  });

  it("a channel with a webhook, a draft, a demo or one without its token is not polled", async () => {
    const { calls, deps } = telegram(connectedBotRoutes());
    const webhook = await telegramChannel();
    expect(await runTelegramPoll(webhook.id, {}, deps)).toEqual({ kind: "skipped", reason: "not_polling" });
    const demo = await telegramChannel({ isDemo: true });
    expect(await runTelegramPoll(demo.id, {}, deps)).toEqual({ kind: "skipped", reason: "not_found" });
    await db.update(channels).set({ secretsEnc: null }).where(eq(channels.id, channel.id));
    expect(await runTelegramPoll(channel.id, {}, deps)).toEqual({ kind: "skipped", reason: "inactive" });
    expect(calls).toHaveLength(0);
  });

  it("a webhook set elsewhere or a revoked token: «error», a notice, and the next poll waits [CAN-15]", async () => {
    const rescheduled: Date[] = [];
    const { deps } = telegram(connectedBotRoutes({ getUpdates: () => tgError(409, "Conflict: can't use getUpdates method while webhook is active") }));
    const outcome = await runTelegramPoll(channel.id, { rescheduleAt: (at) => void rescheduled.push(at) }, deps);
    expect(outcome).toMatchObject({ kind: "failed", blocked: true });
    expect(rescheduled.map((at) => at.getTime())).toEqual([T0.getTime() + POLL_BLOCKED_RETRY_MS]);
    const row = await reload();
    expect(row.status).toBe("error");
    expect(row.lastHealth?.error).toMatch(/otra vía/);
    expect(await ownerNotices()).toHaveLength(1);
  });

  it("failures that may pass only count; the third in a row is an error, and one good poll clears it", async () => {
    const down = telegram(connectedBotRoutes({ getUpdates: () => tgError(502, "Bad Gateway") }));
    for (let attempt = 1; attempt < MAX_POLL_FAILURES; attempt++) {
      expect(await runTelegramPoll(channel.id, {}, down.deps)).toMatchObject({ kind: "failed", blocked: false });
      expect((await reload()).status).toBe("connected");
    }
    await runTelegramPoll(channel.id, {}, down.deps);
    expect((await reload()).status).toBe("error");
    expect(await ownerNotices()).toHaveLength(1);

    await runTelegramPoll(channel.id, {}, telegram(connectedBotRoutes()).deps);
    const row = await reload();
    expect(row.status).toBe("connected");
    expect(readTelegramConfig(row.config).pollFailures).toBe(0);
  });
});
