import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, jobs, messages, realtimeEvents, webhookEvents } from "@/db/schema";
import { REPLY_JOB } from "@/server/engine/schedule";
import { scheduleSummaryIfNeeded } from "@/server/engine/summary";
import { createAgentRow, createBusiness, createChannel, createMessage } from "@/test/factories";
import {
  attachmentMessage,
  customerMessage,
  deletedMessage,
  echoMessage,
  FAKE_INSTAGRAM_CDN,
  IG_TEST,
  instagramWebhook,
  readEvent,
  reactionEvent,
  signedBody,
  T_MS,
  textMessage,
} from "@/test/fixtures/instagram";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import type { ChannelRecord } from "../types";
import { encryptInstagramSecrets } from "./config";
import { INSTAGRAM_MEDIA_DOWNLOAD_JOB, INSTAGRAM_PROFILE_JOB } from "./schedule";
import { instagramSigner, processInstagramWebhook } from "./webhook";

const T0 = new Date("2026-10-16T08:00:05Z");
let channel: ChannelRecord;
let memory: ReturnType<typeof memoryFileStorage>;

async function instagramChannel(overrides: Partial<typeof channels.$inferInsert> = {}): Promise<ChannelRecord> {
  const agent = await createAgentRow({ name: "Recepción" });
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

function receive(messaging: unknown[], options: { channelId?: string; secret?: string } = {}) {
  const signed = signedBody(instagramWebhook(messaging), options.secret);
  return processInstagramWebhook(options.channelId ?? channel.id, signed.raw, signed.signature, { now: T0, storage: memory.storage });
}

const inboundMessages = () => db.select().from(messages).where(eq(messages.direction, "inbound"));
const pendingJobs = (type: string) => db.select().from(jobs).where(and(eq(jobs.type, type), eq(jobs.status, "pending")));

beforeEach(async () => {
  for (const table of [messages, conversations, contactIdentities, contacts, webhookEvents, jobs, realtimeEvents]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
  channel = await instagramChannel();
  memory = memoryFileStorage();
});

describe("Instagram webhook processing", () => {
  it("a channel that is no connected Instagram account gets the same refusal, even with a right signature [IG-02] [ARR-11]", async () => {
    const demo = await instagramChannel({ isDemo: true });
    const disconnected = await instagramChannel({ secretsEnc: null });
    const webchat = await createChannel();
    for (const channelId of [demo.id, disconnected.id, webchat.id, crypto.randomUUID(), "no-es-un-id"]) {
      expect(await receive([textMessage()], { channelId })).toMatchObject({ status: 401 });
    }
    expect(await inboundMessages()).toHaveLength(0);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
  });

  it("without a Meta app secret only the Instagram one signs [IG-02]", () => {
    const { raw, signature } = signedBody("{}", IG_TEST.metaAppSecret);
    expect(instagramSigner(raw, signature, { appSecret: IG_TEST.appSecret, metaAppSecret: null })).toBeNull();
    expect(instagramSigner(raw, signature, { appSecret: IG_TEST.appSecret, metaAppSecret: IG_TEST.metaAppSecret })).toBe("meta");
    expect(instagramSigner(raw, signature, { appSecret: IG_TEST.appSecret, metaAppSecret: IG_TEST.metaAppSecret }, "meta")).toBe("meta");
  });

  it("raw webhook saved, contact by its Instagram id (never a phone), message stored and the reply scheduled, never the AI [CAN-09] [CAN-10] [CAN-13]", async () => {
    const result = await receive([textMessage("Hola, ¿tenéis cita el viernes?", { mid: IG_TEST.mid })]);
    expect(result).toMatchObject({ status: 200 });
    expect(result.replyRunAt).toBeInstanceOf(Date);
    const [raw] = await db.select().from(webhookEvents);
    expect(raw).toMatchObject({ source: "instagram", channelId: channel.id, signatureValid: true });
    expect(raw.processedAt).not.toBeNull();
    const [message] = await inboundMessages();
    expect(message).toMatchObject({ channelId: channel.id, externalId: IG_TEST.mid, contentType: "text", text: "Hola, ¿tenéis cita el viernes?", senderType: "contact" });
    const [identity] = await db.select().from(contactIdentities);
    expect(identity).toMatchObject({ channelType: "instagram", externalId: IG_TEST.customer.id, phone: null });
    expect(await pendingJobs(REPLY_JOB)).toHaveLength(1);
  });

  it("one conversation per customer: a second message joins it [CAN-12]", async () => {
    await receive([textMessage("Hola")]);
    await receive([textMessage("¿Estáis?")]);
    expect(await db.select().from(conversations)).toHaveLength(1);
    expect(await inboundMessages()).toHaveLength(2);
  });

  it("someone new without a name: their profile is asked for, once [IG-08]", async () => {
    const first = await receive([textMessage("Hola")]);
    expect(first.queuedNow).toBe(true);
    await receive([textMessage("¿Hola?")]);
    const profiles = await pendingJobs(INSTAGRAM_PROFILE_JOB);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].payload).toEqual({ channelId: channel.id, userId: IG_TEST.customer.id });
  });

  it("an image, a voice note and a PDF are stored pending and their downloads queued at once [IG-03]", async () => {
    const result = await receive([
      attachmentMessage("image", `${FAKE_INSTAGRAM_CDN}/foto.jpg`, { mid: "m-img" }),
      attachmentMessage("audio", `${FAKE_INSTAGRAM_CDN}/nota.mp4`, { mid: "m-aud" }),
      attachmentMessage("file", `${FAKE_INSTAGRAM_CDN}/doc.pdf`, { mid: "m-pdf" }),
    ]);
    expect(result).toMatchObject({ status: 200, queuedNow: true });
    const stored = await inboundMessages();
    expect(stored.map((message) => message.contentType).sort()).toEqual(["audio", "document", "image"]);
    expect(stored.every((message) => message.media?.downloadStatus === "pending")).toBe(true);
    const downloads = await pendingJobs(INSTAGRAM_MEDIA_DOWNLOAD_JOB);
    expect(downloads.map((job) => (job.payload as { externalId: string }).externalId).sort()).toEqual(["m-aud", "m-img", "m-pdf"]);
  });

  it("a story mention is a notice of the system without reply, and its address is kept nowhere [IG-03]", async () => {
    const url = `${FAKE_INSTAGRAM_CDN}/historia-privada.mp4`;
    const result = await receive([attachmentMessage("story_mention", url)]);
    expect(result).toMatchObject({ status: 200, replyRunAt: null });
    const [message] = await inboundMessages();
    expect(message).toMatchObject({ senderType: "system", contentType: "unsupported", text: "Tipo de mensaje no admitido" });
    expect(JSON.stringify(message)).not.toContain(url);
    // Not in the raw webhook kept for a few days either (§7).
    expect(JSON.stringify(await db.select().from(webhookEvents))).not.toContain(url);
    expect(await pendingJobs(REPLY_JOB)).toHaveLength(0);
    expect(await pendingJobs(INSTAGRAM_MEDIA_DOWNLOAD_JOB)).toHaveLength(0);
  });

  it("an answer to a story keeps its text, never the story's address [IG-03]", async () => {
    const url = `${FAKE_INSTAGRAM_CDN}/historia.jpg`;
    await receive([customerMessage({ text: "¡Qué bonito!", reply_to: { story: { url, id: "123" } } })]);
    const [message] = await inboundMessages();
    expect(message).toMatchObject({ text: "¡Qué bonito!", metadata: expect.objectContaining({ storyReply: true }) });
    expect(JSON.stringify(await db.select().from(webhookEvents))).not.toContain(url);
  });

  it("a shared post is not answered, but it opens the 24 h window as the customer's own message [IG-04]", async () => {
    await receive([attachmentMessage("share", `${FAKE_INSTAGRAM_CDN}/publicacion.jpg`)]);
    const [conversation] = await db.select().from(conversations);
    expect(conversation.lastInboundAt).not.toBeNull();
  });

  it("what the business writes from Instagram joins at once «Desde Instagram» and pauses the AI before any reply [IG-06]", async () => {
    await receive([textMessage("Hola", { mid: "m-1" })]);
    // The business answers from the Instagram app, and the customer writes again in the same seconds.
    await receive([echoMessage({ text: "Te atiendo yo" }, { mid: "m-echo" }), textMessage("Vale, gracias", { mid: "m-2" })]);
    const [echo] = await db.select().from(messages).where(eq(messages.externalId, "m-echo"));
    expect(echo).toMatchObject({ direction: "outbound", senderType: "human", senderName: "Desde Instagram", text: "Te atiendo yo" });
    const [conversation] = await db.select().from(conversations);
    expect(conversation.aiPausedUntil?.getTime()).toBeGreaterThan(T0.getTime());
    expect(conversation.pauseReason).toBe("Has respondido desde Instagram");
  });

  it("several accounts of one Meta app: what arrives at one's address for another goes to the other's channel [IG-02] [CAN-02]", async () => {
    const other = await instagramChannel({ name: "Instagram Centro", config: { accountId: "17840000000000099", username: "peluqueria_centro" } });
    const signed = signedBody(instagramWebhook([textMessage("Hola desde el centro", { mid: "m-centro" })], "17840000000000099"));
    expect((await processInstagramWebhook(channel.id, signed.raw, signed.signature, { now: T0, storage: memory.storage })).status).toBe(200);
    const [stored] = await inboundMessages();
    expect(stored).toMatchObject({ channelId: other.id, text: "Hola desde el centro" });
    // An account of another app (another secret) is not taken.
    const stranger = await instagramChannel({
      name: "Otra app",
      config: { accountId: "17840000000000077" },
      secretsEnc: encryptInstagramSecrets({ accessToken: IG_TEST.accessToken, appSecret: "otra-clave-de-otra-app-1234", metaAppSecret: null, verifyToken: IG_TEST.verifyToken }),
    });
    const foreign = signedBody(instagramWebhook([textMessage("No es mío", { mid: "m-ajeno" })], "17840000000000077"));
    await processInstagramWebhook(channel.id, foreign.raw, foreign.signature, { now: T0, storage: memory.storage });
    expect(await db.select().from(messages).where(eq(messages.channelId, stranger.id))).toHaveLength(0);
  });

  it("several accounts of one Meta app in one body: each channel keeps only its own entries raw, and a deletion leaves the text in no raw row [IG-02] [IG-07]", async () => {
    const other = await instagramChannel({ name: "Instagram Centro", config: { accountId: IG_TEST.otherAccount.accountId, username: "peluqueria_centro" } });
    const body = {
      object: "instagram",
      entry: [
        { id: IG_TEST.accountId, time: T_MS, messaging: [textMessage("Mi teléfono es el 600 111 222", { mid: "m-mio" })] },
        { id: IG_TEST.otherAccount.accountId, time: T_MS, messaging: [textMessage("Hola desde el centro", { mid: "m-centro", to: IG_TEST.otherAccount.accountId })] },
      ],
    };
    const signed = signedBody(body);
    expect((await processInstagramWebhook(channel.id, signed.raw, signed.signature, { now: T0, storage: memory.storage })).status).toBe(200);
    const rawOf = async (channelId: string) => JSON.stringify((await db.select().from(webhookEvents).where(eq(webhookEvents.channelId, channelId))).map((row) => row.payload));
    expect(await rawOf(channel.id)).toContain("600 111 222");
    expect(await rawOf(channel.id)).not.toContain("Hola desde el centro");
    expect(await rawOf(other.id)).toContain("Hola desde el centro");
    expect(await rawOf(other.id)).not.toContain("600 111 222");

    await receive([deletedMessage("m-mio")]);
    expect(JSON.stringify(await db.select().from(webhookEvents))).not.toContain("600 111 222");
  });

  it("an account of the same app that is switched off still takes what arrives for it at another's address, as at its own [IG-02] [CAN-16]", async () => {
    const off = await instagramChannel({ name: "Instagram Centro", status: "disabled", config: { accountId: IG_TEST.otherAccount.accountId, username: "peluqueria_centro" } });
    const signed = signedBody(instagramWebhook([textMessage("Hola, ¿abrís el sábado?", { mid: "m-apagada", to: IG_TEST.otherAccount.accountId })], IG_TEST.otherAccount.accountId));
    expect((await processInstagramWebhook(channel.id, signed.raw, signed.signature, { now: T0, storage: memory.storage })).status).toBe(200);
    const [stored] = await inboundMessages();
    expect(stored).toMatchObject({ channelId: off.id, externalId: "m-apagada", text: "Hola, ¿abrís el sábado?" });
  });

  it("a deletion clears the conversation's summary and how far it reached, so the next one is made from everything that stays [IG-07] [MOT-13]", async () => {
    await receive([textMessage("Mi teléfono es el 600 111 222", { mid: "m-text" })]);
    const [conversation] = await db.select().from(conversations);
    for (let index = 1; index <= 30; index++) await createMessage(conversation, { text: `Mensaje ${index}`, createdAt: new Date(T0.getTime() + index * 60_000) });
    // 31 messages, 20 in the model's window: the summary already covers the 11 older ones up to «Mensaje 5».
    await db
      .update(conversations)
      .set({ summary: "Ana ha dado su teléfono: 600 111 222.", metadata: { ...conversation.metadata, summaryUntil: new Date(T0.getTime() + 5 * 60_000).toISOString() } })
      .where(eq(conversations.id, conversation.id));
    expect(await scheduleSummaryIfNeeded(conversation.id, { now: T0 })).toBe(false);

    await receive([deletedMessage("m-text")]);
    const [after] = await db.select().from(conversations).where(eq(conversations.id, conversation.id));
    expect(after.summary).toBeNull();
    expect(after.metadata).not.toHaveProperty("summaryUntil");
    // The next summary folds again every message out of the window, not only those after the old one.
    expect(await scheduleSummaryIfNeeded(conversation.id, { now: T0 })).toBe(true);
  });

  it("a reaction goes on its message and «seen» marks ours as read, neither answered [WA-37]", async () => {
    await receive([textMessage("Hola", { mid: "m-1" })]);
    await receive([reactionEvent("m-1", "❤️")]);
    const [target] = await inboundMessages();
    expect(target.reactions).toEqual([expect.objectContaining({ from: "contact", emoji: "❤️" })]);
    const [conversation] = await db.select().from(conversations);
    await db.insert(messages).values({ conversationId: conversation.id, channelId: channel.id, direction: "outbound", senderType: "ai", externalId: "m-ours", contentType: "text", text: "¡Hola!", status: "sent" });
    await receive([readEvent("m-ours")]);
    const [ours] = await db.select().from(messages).where(eq(messages.externalId, "m-ours"));
    expect(ours.status).toBe("read");
    expect(await pendingJobs(REPLY_JOB)).toHaveLength(1);
  });

  it("a message the customer deletes loses its text and its file, also the stored one [IG-07]", async () => {
    await receive([textMessage("Mi teléfono es el 600 111 222", { mid: "m-text" }), attachmentMessage("image", `${FAKE_INSTAGRAM_CDN}/foto.jpg`, { mid: "m-img" })]);
    // The image was already downloaded and stored.
    await memory.storage.put("media/2026/10/foto.jpg", new Uint8Array([1, 2, 3]), "image/jpeg");
    await db.update(messages).set({ media: { fileKey: "media/2026/10/foto.jpg", mimeType: "image/jpeg", size: 3, downloadStatus: "done" } }).where(eq(messages.externalId, "m-img"));
    await receive([deletedMessage("m-text"), deletedMessage("m-img")]);
    const stored = await inboundMessages();
    for (const message of stored) {
      expect(message).toMatchObject({ text: null, searchText: null, media: null, transcript: null, metadata: expect.objectContaining({ deletedByContact: true }) });
    }
    expect(memory.files.has("media/2026/10/foto.jpg")).toBe(false);
    // Its pending download is not brought in any more.
    expect(await pendingJobs(INSTAGRAM_MEDIA_DOWNLOAD_JOB)).toHaveLength(0);
    // Nor does its text stay in the raw webhooks.
    expect(JSON.stringify(await db.select().from(webhookEvents))).not.toContain("600 111 222");
  });

  it("a NUL character in a customer's text never loses the message [CAN-09]", async () => {
    expect((await receive([textMessage("Ho\u0000la")])).status).toBe(200);
    expect((await inboundMessages())[0].text).toBe("Hola");
  });
});
