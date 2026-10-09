import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { appKv, businessSettings, channels, contactIdentities, contacts, conversations, jobs, messages, realtimeEvents, webhookEvents } from "@/db/schema";
import { REPLY_JOB } from "@/server/engine/schedule";
import { createAgentRow, createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage } from "@/test/factories";
import { echoEvent, inboundEvent, inboundImage, inboundText, inboundVoice, signedEvent, statusEvent, templateReviewedEvent, YC_TEST } from "@/test/fixtures/ycloud";
import { PHONE_PAUSE_REASON, PHONE_SENDER_NAME } from "../phone-echo";
import type { ChannelRecord } from "../types";
import { encryptYCloudSecrets, ycloudPhoneNumberId } from "./config";
import { YCLOUD_MEDIA_DOWNLOAD_JOB } from "./media";
import { YCLOUD_TEMPLATES_SYNC_JOB } from "./templates";
import { processYCloudWebhook, YCLOUD_WEBHOOK_SOURCE } from "./webhook";

const T0 = new Date("2026-09-26T10:00:05Z");
let channel: ChannelRecord;

async function ycloudChannel(overrides: Partial<typeof channels.$inferInsert> = {}): Promise<ChannelRecord> {
  const agent = await createAgentRow({ name: "Recepción" });
  return createChannel({
    type: "whatsapp",
    connectionMode: "ycloud",
    name: "WhatsApp YCloud",
    status: "connected",
    activeAgentId: agent.id,
    phoneNumberId: ycloudPhoneNumberId(YC_TEST.phoneNumber),
    wabaId: YC_TEST.wabaId,
    displayPhoneNumber: YC_TEST.displayPhoneNumber,
    config: { ycloudPhoneNumber: YC_TEST.phoneNumber, ycloudWebhookEndpointId: YC_TEST.endpointId },
    secretsEnc: encryptYCloudSecrets({ apiKey: YC_TEST.apiKey, webhookSecret: YC_TEST.webhookSecret }),
    ...overrides,
  });
}

function post(event: unknown, options: { secret?: string; signature?: string | null; channelId?: string; signedAt?: Date } = {}) {
  const signed = signedEvent(event, options.secret ?? YC_TEST.webhookSecret, options.signedAt ?? T0);
  return processYCloudWebhook(options.channelId ?? channel.id, signed.raw, options.signature === undefined ? signed.signature : options.signature, { now: T0 });
}

const stored = (direction: "inbound" | "outbound") => db.select().from(messages).where(eq(messages.direction, direction));
const pendingJobs = (type: string) => db.select().from(jobs).where(and(eq(jobs.type, type), eq(jobs.status, "pending")));

beforeEach(async () => {
  for (const table of [messages, conversations, contactIdentities, contacts, webhookEvents, jobs, realtimeEvents, appKv]) await db.delete(table);
  await db.delete(channels);
  await db.delete(businessSettings);
  await createBusiness();
  channel = await ycloudChannel();
});

describe("YCloud webhook", () => {
  it("without the channel's signature, with another secret or an old one, it is refused and nothing is stored [YC-05] [SEG-08]", async () => {
    expect(await post(inboundText(), { signature: null })).toMatchObject({ status: 401, replyRunAt: null });
    expect(await post(inboundText(), { signature: "t=1,s=abc" })).toMatchObject({ status: 401 });
    expect(await post(inboundText(), { secret: `${YC_TEST.webhookSecret}x` })).toMatchObject({ status: 401 });
    // Signed well, but more than 5 minutes ago: a captured request cannot be replayed.
    expect(await post(inboundText(), { signedAt: new Date(T0.getTime() - 6 * 60_000) })).toMatchObject({ status: 401 });
    expect(await stored("inbound")).toHaveLength(0);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
    expect(await db.select().from(contacts)).toHaveLength(0);
  });

  it("a channel that is no connected YCloud number gets the same refusal [YC-05] [WA-54]", async () => {
    const meta = await createChannel({ type: "whatsapp", connectionMode: "manual", phoneNumberId: "200000000000001", secretsEnc: encryptYCloudSecrets({ apiKey: YC_TEST.apiKey, webhookSecret: YC_TEST.webhookSecret }) });
    const noSecret = await ycloudChannel({ phoneNumberId: "ycloud:34600999888", secretsEnc: encryptYCloudSecrets({ apiKey: YC_TEST.apiKey, webhookSecret: null }) });
    const disconnected = await ycloudChannel({ phoneNumberId: "ycloud:34600999777", secretsEnc: null });
    for (const channelId of [meta.id, noSecret.id, disconnected.id, crypto.randomUUID(), "no-es-un-id"]) {
      expect(await post(inboundText(), { channelId })).toMatchObject({ status: 401 });
    }
    expect(await stored("inbound")).toHaveLength(0);
  });

  it("with the signature: raw event saved, contact by its WhatsApp identity, message stored once and the reply scheduled, never the AI [CAN-09]–[CAN-13] [YC-06]", async () => {
    const event = inboundText("Hola, ¿tenéis hueco mañana?", { id: "67aa0001", wamid: "wamid.PRUEBA1" });
    const result = await post(event);
    expect(result.status).toBe(200);
    expect(result.replyRunAt).toBeInstanceOf(Date);
    const [raw] = await db.select().from(webhookEvents);
    expect(raw).toMatchObject({ source: YCLOUD_WEBHOOK_SOURCE, channelId: channel.id, signatureValid: true });
    const [message] = await stored("inbound");
    expect(message).toMatchObject({ channelId: channel.id, externalId: "wamid.PRUEBA1", contentType: "text", text: "Hola, ¿tenéis hueco mañana?", senderType: "contact", status: "received" });
    const identities = await db.select().from(contactIdentities);
    // The stable id first and the phone as data, never as the contact's key ([WA-39], [CAN-13]).
    expect(identities.map((identity) => identity.externalId).sort()).toEqual([YC_TEST.customer.waId, YC_TEST.customer.bsuid].sort());
    expect(identities.every((identity) => identity.channelType === "whatsapp")).toBe(true);
    const [contact] = await db.select().from(contacts);
    expect(contact).toMatchObject({ name: YC_TEST.customer.name, phone: YC_TEST.customer.waId });
    expect(await pendingJobs(REPLY_JOB)).toHaveLength(1);

    // YCloud delivers at least once: the same message again changes nothing ([CAN-11]).
    expect(await post(event)).toMatchObject({ status: 200, replyRunAt: null });
    expect(await stored("inbound")).toHaveLength(1);
    expect(await db.select().from(contacts)).toHaveLength(1);
  });

  it("a voice note and a photo are stored and their download from YCloud queued at once [YC-06] [MED-01]", async () => {
    const voice = await post(inboundVoice({ id: "67aa0002", wamid: "wamid.VOZ" }));
    expect(voice).toMatchObject({ status: 200, queuedNow: true });
    await post(inboundImage("Así lo quiero", { id: "67aa0003", wamid: "wamid.FOTO" }));
    const rows = await stored("inbound");
    expect(rows.map((row) => row.contentType).sort()).toEqual(["audio", "image"]);
    expect(rows.find((row) => row.contentType === "image")).toMatchObject({ text: "Así lo quiero", media: { downloadStatus: "pending" } });
    const downloads = await pendingJobs(YCLOUD_MEDIA_DOWNLOAD_JOB);
    expect(downloads.map((job) => (job.payload as { externalId: string }).externalId).sort()).toEqual(["wamid.FOTO", "wamid.VOZ"]);
    expect((downloads[0].payload as { url: string }).url).toContain("/whatsapp/media/download/");
  });

  it("a type the app does not handle shows as «no admitido» and is never answered [YC-06] [WA-36]", async () => {
    // An edited message, as YCloud tells about it in coexistence.
    const result = await post(inboundEvent({ type: "unsupported", unsupported: { type: "edit" }, errors: [{ code: 131051, title: "Unsupported message type" }] }));
    expect(result).toMatchObject({ status: 200, replyRunAt: null });
    expect(await stored("inbound")).toMatchObject([{ contentType: "unsupported", senderType: "system" }]);
    expect(await pendingJobs(REPLY_JOB)).toHaveLength(0);
    // A location is one of the types the app does read, as with the direct connection.
    expect((await post(inboundEvent({ type: "location", location: { latitude: 40.4, longitude: -3.7, name: "Plaza Mayor" } }))).replyRunAt).toBeInstanceOf(Date);
  });

  it("an event about another number of the same account is acknowledged and ignored [YC-05]", async () => {
    expect(await post(inboundText("Para el otro número", { to: YC_TEST.otherPhoneNumber }))).toMatchObject({ status: 200, replyRunAt: null });
    expect(await post(echoEvent(undefined, { from: YC_TEST.otherPhoneNumber }))).toMatchObject({ status: 200 });
    expect(await db.select().from(messages)).toHaveLength(0);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
  });

  it("statuses of our own messages move them forward, with what failed in Spanish [YC-07] [WA-38]", async () => {
    const { contact } = await createContactWithIdentity("whatsapp", { externalId: YC_TEST.customer.waId, phone: YC_TEST.customer.waId });
    const conversation = await createConversation(channel.id, contact.id);
    const sent = await createMessage(conversation, { direction: "outbound", senderType: "ai", externalId: "67f10001", status: "sent", text: "Sí, a las 10." });
    const failed = await createMessage(conversation, { direction: "outbound", senderType: "ai", externalId: "67f10002", status: "sent", text: "¿Te va bien?" });

    expect(await post(statusEvent("67f10001", "delivered"))).toMatchObject({ status: 200 });
    expect((await db.select().from(messages).where(eq(messages.id, sent.id)))[0].status).toBe("delivered");
    await post(statusEvent("67f10001", "read"));
    // A late «entregado» never takes a read message back.
    await post(statusEvent("67f10001", "delivered"));
    expect((await db.select().from(messages).where(eq(messages.id, sent.id)))[0].status).toBe("read");

    await post(statusEvent("67f10002", "failed", { errorCode: "BALANCE_INSUFFICIENT", errorMessage: "Insufficient balance" }));
    const [row] = await db.select().from(messages).where(eq(messages.id, failed.id));
    expect(row.status).toBe("failed");
    expect(row.error?.message).toMatch(/No queda saldo/);
    expect(JSON.stringify(row.error)).not.toContain("Insufficient");
    // «accepted» and a status of a message we do not have change nothing.
    expect(await post(statusEvent("67f19999", "accepted"))).toMatchObject({ status: 200 });
    expect(await post(statusEvent("67f19999", "delivered"))).toMatchObject({ status: 200 });
  });

  it("what the business writes from its phone joins the conversation as a person's and pauses the AI there [YC-08] [BAN-11]", async () => {
    await post(inboundText("¿A qué hora abrís?", { id: "67aa0010", wamid: "wamid.PREGUNTA" }));
    expect(await pendingJobs(REPLY_JOB)).toHaveLength(1);
    const echo = echoEvent({ type: "text", text: { body: "Abrimos a las 9, te espero." } });
    expect(await post(echo)).toMatchObject({ status: 200 });

    const [message] = await stored("outbound");
    expect(message).toMatchObject({ senderType: "human", senderName: PHONE_SENDER_NAME, contentType: "text", text: "Abrimos a las 9, te espero.", status: "sent", metadata: { sentFromPhone: true } });
    const [conversation] = await db.select().from(conversations);
    expect(message.conversationId).toBe(conversation.id);
    expect(conversation.pauseReason).toBe(PHONE_PAUSE_REASON);
    expect(conversation.aiPausedUntil!.getTime()).toBeGreaterThan(T0.getTime());
    // The reply the AI was about to send is dropped, and no second contact appears for the same customer.
    expect(await pendingJobs(REPLY_JOB)).toHaveLength(0);
    expect(await db.select().from(contacts)).toHaveLength(1);

    // The same echo again, or the echo of a message the app itself sent, adds nothing.
    await post(echo);
    const ours = await createMessage(conversation, { direction: "outbound", senderType: "ai", externalId: "67f10077", status: "sent", text: "Hasta mañana." });
    await post(echoEvent({ type: "text", text: { body: "Hasta mañana." } }, { id: ours.externalId }));
    expect(await stored("outbound")).toHaveLength(2);
  });

  it("a template review asks for a new sync, and anything else signed is acknowledged [YC-07]", async () => {
    expect(await post(templateReviewedEvent())).toMatchObject({ status: 200, queuedNow: true });
    expect(await pendingJobs(YCLOUD_TEMPLATES_SYNC_JOB)).toHaveLength(1);
    expect(await post({ id: "evt_nuevo_1", type: "whatsapp.group.settings_update", apiVersion: "v2" })).toMatchObject({ status: 200, queuedNow: false });
    expect(await post("no es json")).toMatchObject({ status: 400 });
    expect(await post({ sin: "sobre" })).toMatchObject({ status: 400 });
  });
});
