import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, jobs, messages, realtimeEvents, webhookEvents } from "@/db/schema";
import { REPLY_JOB } from "@/server/engine/schedule";
import { createAgentRow, createBusiness, createChannel } from "@/test/factories";
import { documentUpdate, groupUpdate, photoUpdate, textUpdate, TG_TEST, voiceUpdate } from "@/test/fixtures/telegram";
import type { ChannelRecord } from "../types";
import { encryptTelegramSecrets } from "./config";
import { TELEGRAM_MEDIA_DOWNLOAD_JOB } from "./media";
import { processTelegramWebhook, TELEGRAM_WEBHOOK_SOURCE } from "./webhook";

const T0 = new Date("2026-09-26T10:00:05Z");
const bytes = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
let channel: ChannelRecord;

async function telegramChannel(overrides: Partial<typeof channels.$inferInsert> = {}): Promise<ChannelRecord> {
  const agent = await createAgentRow({ name: "Recepción" });
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

const post = (update: unknown, options: { secret?: string | null; channelId?: string } = {}) =>
  processTelegramWebhook(options.channelId ?? channel.id, bytes(update), options.secret === undefined ? TG_TEST.webhookSecret : options.secret, { now: T0 });

const inboundMessages = () => db.select().from(messages).where(eq(messages.direction, "inbound"));
const pendingJobs = (type: string) => db.select().from(jobs).where(and(eq(jobs.type, type), eq(jobs.status, "pending")));

beforeEach(async () => {
  for (const table of [messages, conversations, contactIdentities, contacts, webhookEvents, jobs, realtimeEvents]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
  channel = await telegramChannel();
});

describe("Telegram webhook", () => {
  it("without the channel's secret, or with a wrong one, it is refused and nothing is stored [TG-02] [SEG-08]", async () => {
    for (const secret of [null, "", "otro-secreto", `${TG_TEST.webhookSecret}x`, TG_TEST.webhookSecret.toUpperCase()]) {
      expect(await post(textUpdate(), { secret })).toMatchObject({ status: 401, replyRunAt: null });
    }
    expect(await inboundMessages()).toHaveLength(0);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
    expect(await db.select().from(contacts)).toHaveLength(0);
  });

  it("a channel that is no connected bot gets the same refusal, even with a right-looking secret [TG-02] [ARR-11]", async () => {
    const demo = await telegramChannel({ isDemo: true });
    const disconnected = await telegramChannel({ secretsEnc: null });
    const webchat = await createChannel();
    for (const channelId of [demo.id, disconnected.id, webchat.id, crypto.randomUUID(), "no-es-un-id"]) {
      expect(await post(textUpdate(), { channelId })).toMatchObject({ status: 401 });
    }
    expect(await inboundMessages()).toHaveLength(0);
  });

  it("with the secret: raw update saved, contact by its Telegram id, message stored and the reply scheduled, never the AI [CAN-09] [CAN-10] [CAN-13]", async () => {
    const result = await post(textUpdate("Hola, ¿tenéis hueco mañana?", { messageId: 7 }));
    expect(result.status).toBe(200);
    expect(result.replyRunAt).toBeInstanceOf(Date);
    const [raw] = await db.select().from(webhookEvents);
    expect(raw).toMatchObject({ source: TELEGRAM_WEBHOOK_SOURCE, channelId: channel.id, signatureValid: true });
    expect(raw.processedAt).not.toBeNull();
    const [message] = await inboundMessages();
    expect(message).toMatchObject({ channelId: channel.id, externalId: `${TG_TEST.customer.id}:7`, contentType: "text", text: "Hola, ¿tenéis hueco mañana?", senderType: "contact", status: "received" });
    const [identity] = await db.select().from(contactIdentities);
    expect(identity).toMatchObject({ channelType: "telegram", externalId: TG_TEST.customer.id, phone: null, displayName: "Ana Pruebas" });
    const [contact] = await db.select().from(contacts);
    expect(contact).toMatchObject({ name: "Ana Pruebas", phone: null });
    expect(await pendingJobs(REPLY_JOB)).toHaveLength(1);
    const [updated] = await db.select().from(channels).where(eq(channels.id, channel.id));
    expect(updated.lastInboundAt?.toISOString()).toBe(T0.toISOString());
  });

  it("the same message twice is stored once and answered once [CAN-11]", async () => {
    const update = textUpdate("Hola", { updateId: 50, messageId: 9 });
    expect((await post(update)).status).toBe(200);
    expect((await post(update)).status).toBe(200);
    expect(await inboundMessages()).toHaveLength(1);
    expect(await pendingJobs(REPLY_JOB)).toHaveLength(1);
  });

  it("one conversation per contact: a second message joins it [CAN-12]", async () => {
    await post(textUpdate("Hola", { messageId: 1 }));
    await post(textUpdate("¿Estáis?", { messageId: 2 }));
    expect(await db.select().from(conversations)).toHaveLength(1);
    expect(await inboundMessages()).toHaveLength(2);
  });

  it("a voice note or a photo is stored pending and its download queued at once [TG-03] [TG-11]", async () => {
    const voice = await post(voiceUpdate({ messageId: 3 }));
    expect(voice).toMatchObject({ status: 200, queuedNow: true });
    await post(photoUpdate("Mira", { messageId: 4 }));
    const stored = await inboundMessages();
    expect(stored.map((message) => message.contentType).sort()).toEqual(["audio", "image"]);
    expect(stored.every((message) => message.media?.downloadStatus === "pending")).toBe(true);
    const downloads = await pendingJobs(TELEGRAM_MEDIA_DOWNLOAD_JOB);
    expect(downloads.map((job) => (job.payload as { externalId: string }).externalId).sort()).toEqual([`${TG_TEST.customer.id}:3`, `${TG_TEST.customer.id}:4`]);
  });

  it("another kind of message is a notice of the system and gets no reply [TG-03]", async () => {
    const result = await post(documentUpdate());
    expect(result).toMatchObject({ status: 200, replyRunAt: null });
    const [message] = await inboundMessages();
    expect(message).toMatchObject({ senderType: "system", contentType: "unsupported", text: "Tipo de mensaje no admitido" });
    expect(await pendingJobs(REPLY_JOB)).toHaveLength(0);
  });

  it("a group message or another kind of update is acknowledged and not even stored", async () => {
    expect(await post(groupUpdate())).toMatchObject({ status: 200, replyRunAt: null });
    expect(await post({ update_id: 77, edited_message: { message_id: 1 } })).toMatchObject({ status: 200 });
    expect(await inboundMessages()).toHaveLength(0);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
  });

  it("a body that is not an update is refused", async () => {
    expect(await post("no es json")).toMatchObject({ status: 400 });
    expect(await post({ hola: 1 })).toMatchObject({ status: 400 });
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
  });

  it("a NUL character in a customer's text never loses the message [CAN-09]", async () => {
    expect((await post(textUpdate("Ho\u0000la"))).status).toBe(200);
    expect((await inboundMessages())[0].text).toBe("Hola");
  });
});
