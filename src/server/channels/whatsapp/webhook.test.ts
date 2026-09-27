import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  appKv,
  channels,
  contactIdentities,
  contacts,
  conversations,
  integrationSettings,
  jobs,
  messages,
  notifications,
  pricingRates,
  realtimeEvents,
  webhookEvents,
  whatsappTemplates,
} from "@/db/schema";
import { readWhatsAppVerifyToken } from "@/data/whatsapp";
import { REPLY_JOB } from "@/server/engine/schedule";
import { createAgentRow, createBusiness, createChannel, createContactWithIdentity, createUser, type TestUser } from "@/test/factories";
import { fixtureText, signWebhook, WA_TEST, type WhatsAppFixture } from "@/test/fixtures/whatsapp";
import type { ChannelRecord } from "../types";
import { encryptWhatsAppSecrets } from "./config";
import { MEDIA_DOWNLOAD_JOB } from "./media";
import { HEALTH_CHECK_JOB, STATUS_RETRY_JOB } from "./schedule";
import { WEBHOOK_MAX_ROUTING_IDS, WEBHOOK_MAX_UPDATES } from "./normalize";
import { invalidSignatureStats, processWhatsAppWebhook, verifyWhatsAppWebhook } from "./webhook";

const T0 = new Date("2026-09-26T10:00:05Z");
const bytes = (text: string) => new TextEncoder().encode(text);
let owner: TestUser;
let channel: ChannelRecord;

async function whatsappChannel(overrides: Partial<typeof channels.$inferInsert> = {}): Promise<ChannelRecord> {
  const agent = await createAgentRow({ name: "Recepción" });
  return createChannel({
    type: "whatsapp",
    name: "WhatsApp Peluquería",
    status: "connected",
    phoneNumberId: WA_TEST.phoneNumberId,
    wabaId: WA_TEST.wabaId,
    metaAppId: WA_TEST.appId,
    displayPhoneNumber: "+1 555-000-1111",
    graphApiVersion: "v26.0",
    activeAgentId: agent.id,
    secretsEnc: encryptWhatsAppSecrets({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: null }),
    ...overrides,
  });
}

function post(name: WhatsAppFixture | string, options: { secret?: string; signature?: string | null; now?: Date } = {}) {
  const text = name.trim().startsWith("{") ? name : fixtureText(name as WhatsAppFixture);
  const signature = options.signature === undefined ? signWebhook(text, options.secret) : options.signature;
  return processWhatsAppWebhook(bytes(text), signature, { now: options.now ?? T0 });
}

const inboundMessages = () => db.select().from(messages).where(eq(messages.direction, "inbound"));
const pendingJobs = (type: string) => db.select().from(jobs).where(and(eq(jobs.type, type), eq(jobs.status, "pending")));

async function outboundFor(conversationId: string, externalId = "wamid.TEST_OUT_0001", overrides: Partial<typeof messages.$inferInsert> = {}) {
  const [row] = await db
    .insert(messages)
    .values({ conversationId, channelId: channel.id, direction: "outbound", senderType: "human", externalId, text: "Te esperamos", status: "sent", ...overrides })
    .returning();
  return row;
}

beforeAll(async () => {
  owner = await createUser("owner");
});

beforeEach(async () => {
  for (const table of [notifications, messages, conversations, contactIdentities, contacts, whatsappTemplates, webhookEvents, jobs, realtimeEvents]) await db.delete(table);
  await db.delete(channels);
  await db.delete(pricingRates);
  await db.delete(appKv);
  await createBusiness();
  channel = await whatsappChannel();
});

describe("signature [WA-32] [SEG-08]", () => {
  it("a wrong or missing signature is refused with 401 and nothing is stored", async () => {
    expect((await post("text", { secret: WA_TEST.otherAppSecret })).status).toBe(401);
    expect((await post("text", { signature: null })).status).toBe(401);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
    expect(await inboundMessages()).toHaveLength(0);
    // Diagnóstico counts them, without keeping the body ([WA-24]).
    expect(await invalidSignatureStats(channel.id)).toMatchObject({ count: 2 });
  });

  it("the signature is checked on the raw bytes: the same JSON re-serialized does not pass", async () => {
    const text = fixtureText("text");
    const compact = JSON.stringify(JSON.parse(text));
    expect((await processWhatsAppWebhook(bytes(compact), signWebhook(text), { now: T0 })).status).toBe(401);
  });

  it("another app's secret never unlocks a channel of a different app", async () => {
    await whatsappChannel({ phoneNumberId: "200000000000099", wabaId: "100000000000099", metaAppId: "300000000000099", secretsEnc: encryptWhatsAppSecrets({ accessToken: "x".repeat(30), appSecret: WA_TEST.otherAppSecret, twoStepPin: null }) });
    const text = fixtureText("text");
    // Signed with the other app's secret, but addressed to our number: refused.
    expect((await processWhatsAppWebhook(bytes(text), signWebhook(text, WA_TEST.otherAppSecret), { now: T0 })).status).toBe(401);
  });
});

describe("an unsigned body cannot make the app work hard before its signature is checked [SEG-07] [WA-32]", () => {
  const FORGED = `sha256=${"0".repeat(64)}`;
  const change = (phoneNumberId: string) => ({
    field: "messages",
    value: { messaging_product: "whatsapp", metadata: { display_phone_number: "15550001111", phone_number_id: phoneNumberId }, statuses: [] },
  });
  /** One entry per WABA id, each with the changes for these Phone Number IDs. */
  const body = (entries: { wabaId: string; numbers: string[] }[]) =>
    JSON.stringify({ object: "whatsapp_business_account", entry: entries.map((entry) => ({ id: entry.wabaId, changes: entry.numbers.map(change) })) });
  const otherNumbers = (count: number) => Array.from({ length: count }, (_, index) => String(210_000_000_000_000 + index));

  it("more numbers or accounts than an installation has: 400, and nothing is looked up nor counted", async () => {
    // Ours is among them: without the limit this would reach our App Secret and count a rejected signature.
    const numbers = await post(body([{ wabaId: WA_TEST.wabaId, numbers: [WA_TEST.phoneNumberId, ...otherNumbers(WEBHOOK_MAX_ROUTING_IDS)] }]), { signature: FORGED });
    expect(numbers.status).toBe(400);
    const accounts = await post(body([WA_TEST.wabaId, ...otherNumbers(WEBHOOK_MAX_ROUTING_IDS).map((id) => `1${id.slice(1)}`)].map((wabaId) => ({ wabaId, numbers: [] }))), { signature: FORGED });
    expect(accounts.status).toBe(400);
    expect(await invalidSignatureStats(channel.id)).toBeNull();
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
  });

  it("more updates than Meta ever puts in one POST (1,000): 400; Meta's biggest batch still reaches the signature check [WA-35]", async () => {
    const ours = (count: number) => body([{ wabaId: WA_TEST.wabaId, numbers: Array.from({ length: count }, () => WA_TEST.phoneNumberId) }]);
    expect((await post(ours(WEBHOOK_MAX_UPDATES + 1), { signature: FORGED })).status).toBe(400);
    expect((await post(ours(WEBHOOK_MAX_UPDATES), { signature: FORGED })).status).toBe(401);
  });
});

describe("a webhook for no channel [WA-34]", () => {
  it("a number of one of our apps that is no channel: 200, and only the time and the number are kept", async () => {
    await db.update(channels).set({ phoneNumberId: "200000000000099" }).where(eq(channels.id, channel.id));
    const result = await post("text");
    expect(result).toMatchObject({ status: 200, channelIds: [] });
    const [row] = await db.select().from(webhookEvents);
    expect(row).toMatchObject({ channelId: null, payload: null, externalAccountId: WA_TEST.phoneNumberId, signatureValid: true });
    expect(await inboundMessages()).toHaveLength(0);
  });

  it("a body no app of ours signed, for no channel: 200 and nothing stored", async () => {
    await db.delete(channels);
    expect((await post("text")).status).toBe(200);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
    expect(await inboundMessages()).toHaveLength(0);
  });

  it("a disconnected channel (no credentials) is treated the same way", async () => {
    await db.update(channels).set({ secretsEnc: null }).where(eq(channels.id, channel.id));
    expect((await post("text")).status).toBe(200);
    expect(await inboundMessages()).toHaveLength(0);
  });
});

describe("messages in [CAN-09] [CAN-10] [CAN-11] [CAN-13] [WA-35] [WA-39]", () => {
  it("stores the raw webhook, the contact by BSUID and wa_id (never the phone as key), the message and schedules one reply", async () => {
    const result = await post("text");
    expect(result).toMatchObject({ status: 200, channelIds: [channel.id], queuedNow: false });
    expect(result.replyRunAt).not.toBeNull();
    const [raw] = await db.select().from(webhookEvents);
    expect(raw).toMatchObject({ source: "whatsapp", channelId: channel.id, signatureValid: true });
    expect(raw.processedAt).not.toBeNull();
    const identities = await db.select().from(contactIdentities);
    expect(identities.map((row) => row.externalId).sort()).toEqual([WA_TEST.customer.waId, WA_TEST.customer.bsuid].sort());
    expect(new Set(identities.map((row) => row.contactId)).size).toBe(1);
    const [contact] = await db.select().from(contacts);
    expect(contact).toMatchObject({ name: "Ana Pruebas", phone: WA_TEST.customer.waId });
    const [message] = await inboundMessages();
    expect(message).toMatchObject({ externalId: "wamid.TEST_IN_TEXT_0001", contentType: "text", status: "received", sentAt: new Date(1790416800 * 1_000) });
    const [conversation] = await db.select().from(conversations);
    expect(conversation.lastInboundAt).toEqual(new Date(1790416800 * 1_000));
    expect(await pendingJobs(REPLY_JOB)).toHaveLength(1);
  });

  it("the same message delivered twice is stored once and answered once; both deliveries get 200", async () => {
    const [first, second] = JSON.parse(fixtureText("duplicate")) as unknown[];
    for (const body of [first, second]) {
      const text = JSON.stringify(body);
      expect((await processWhatsAppWebhook(bytes(text), signWebhook(text), { now: T0 })).status).toBe(200);
    }
    expect(await inboundMessages()).toHaveLength(1);
    expect(await pendingJobs(REPLY_JOB)).toHaveLength(1);
    expect(await db.select().from(webhookEvents)).toHaveLength(2);
  });

  it("a contact with only a BSUID is created and can be answered [WA-39]", async () => {
    await post("bsuid-only");
    const [identity] = await db.select().from(contactIdentities);
    expect(identity).toMatchObject({ externalId: WA_TEST.bsuidOnly.bsuid, phone: null, channelType: "whatsapp" });
    const [contact] = await db.select().from(contacts);
    expect(contact).toMatchObject({ name: "Lucía Test", phone: null });
  });

  it("an old contact known by wa_id gets the BSUID on the same contact [WA-40]", async () => {
    const { contact } = await createContactWithIdentity("whatsapp", { externalId: WA_TEST.customer.waId, phone: WA_TEST.customer.waId, name: "Ana" });
    await post("text");
    const identities = await db.select().from(contactIdentities);
    expect(identities).toHaveLength(2);
    expect(identities.every((row) => row.contactId === contact.id)).toBe(true);
    expect(await db.select().from(contacts)).toHaveLength(1);
  });

  it("a BSUID change moves the identity in the same contact, leaves a system note and no reply [WA-50]", async () => {
    await post("bsuid-only");
    await db.delete(jobs);
    await post("system-user-changed-user-id");
    const identities = await db.select().from(contactIdentities);
    expect(identities.map((row) => row.externalId)).toEqual([WA_TEST.bsuidOnly.newBsuid]);
    expect(await db.select().from(contacts)).toHaveLength(1);
    const system = (await inboundMessages()).find((row) => row.contentType === "system");
    // A system message in the Bandeja, never the customer's words for the AI ([BAN-05]).
    expect(system).toMatchObject({ text: "El identificador de WhatsApp del cliente ha cambiado.", senderType: "system" });
    expect(new Set((await db.select().from(conversations)).map((row) => row.id)).size).toBe(1);
    expect(await pendingJobs(REPLY_JOB)).toHaveLength(0);
  });

  it("a number change moves the BSUID and the wa_id to the new ones in the same contact [WA-50]", async () => {
    await post("text");
    await post("system-user-changed-number");
    const identities = await db.select().from(contactIdentities);
    expect(identities.map((row) => row.externalId).sort()).toEqual(["15550003333", "US.10000000000000000009"]);
    expect(identities.every((row) => row.phone === "15550003333")).toBe(true);
    expect(await db.select().from(contacts)).toHaveLength(1);
  });

  it("unsupported types are shown as a system message and never answered [WA-36] [BAN-05]", async () => {
    await post("unsupported");
    const [message] = await inboundMessages();
    expect(message).toMatchObject({ contentType: "unsupported", text: "Tipo de mensaje no admitido", senderType: "system" });
    expect(await pendingJobs(REPLY_JOB)).toHaveLength(0);
  });

  it("a voice note is stored pending and its download is queued right away [WA-41]", async () => {
    const result = await post("voice");
    expect(result.queuedNow).toBe(true);
    const [message] = await inboundMessages();
    expect(message.media).toMatchObject({ externalMediaId: "900000000000001", downloadStatus: "pending" });
    const [job] = await pendingJobs(MEDIA_DOWNLOAD_JOB);
    expect(job.payload).toMatchObject({ channelId: channel.id, wamid: "wamid.TEST_IN_AUDIO_0001", mediaId: "900000000000001", url: expect.stringContaining("lookaside.fbsbx.com") });
  });

  it("a reaction goes on our message and is removed without emoji; never answered [WA-37]", async () => {
    await post("text");
    const [conversation] = await db.select().from(conversations);
    const out = await outboundFor(conversation.id);
    await db.delete(jobs);
    await post("reaction");
    expect((await db.select().from(messages).where(eq(messages.id, out.id)))[0].reactions).toEqual([{ from: "contact", emoji: "👍", at: new Date(1790417300 * 1_000).toISOString() }]);
    await post("reaction-removed");
    expect((await db.select().from(messages).where(eq(messages.id, out.id)))[0].reactions).toEqual([]);
    expect(await pendingJobs(REPLY_JOB)).toHaveLength(0);
  });

  it("a disabled channel keeps receiving (the AI does not answer there, [CAN-16]) and answers 200", async () => {
    await db.update(channels).set({ status: "disabled" }).where(eq(channels.id, channel.id));
    expect((await post("text")).status).toBe(200);
    expect(await inboundMessages()).toHaveLength(1);
  });
});

describe("statuses [WA-38] [WA-47] [WA-46]", () => {
  let conversationId: string;
  beforeEach(async () => {
    await post("text");
    conversationId = (await db.select().from(conversations))[0].id;
  });

  it("only move forward: a late «entregado» after «leído» changes nothing; the first pricing is kept, free = 0", async () => {
    const out = await outboundFor(conversationId);
    await post("status-read");
    await post("status-delivered");
    const [row] = await db.select().from(messages).where(eq(messages.id, out.id));
    expect(row).toMatchObject({ status: "read", pricingType: "free_customer_service", pricingCategory: "service", costEstimate: 0 });
  });

  it("regular = the editable rate of the recipient's market and category; without a rate it is not estimated", async () => {
    const out = await outboundFor(conversationId);
    await post("status-delivered-regular");
    expect((await db.select().from(messages).where(eq(messages.id, out.id)))[0]).toMatchObject({ pricingType: "regular", costEstimate: null });
    await db.update(messages).set({ pricingType: null, pricingCategory: null }).where(eq(messages.id, out.id));
    await db.insert(pricingRates).values({ country: "US", category: "service", price: 0.0034 });
    await post("status-delivered-regular");
    expect((await db.select().from(messages).where(eq(messages.id, out.id)))[0]).toMatchObject({ pricingType: "regular", pricingCategory: "service", costEstimate: 0.0034 });
  });

  it("«fallido» 131047 shows its Spanish error and closes the window as Meta says [WA-43]", async () => {
    const out = await outboundFor(conversationId, "wamid.TEST_OUT_0002");
    await post("status-failed-131047");
    const [row] = await db.select().from(messages).where(eq(messages.id, out.id));
    expect(row).toMatchObject({ status: "failed", error: { code: 131047, message: "La ventana de 24 h está cerrada. Usa una plantilla aprobada." } });
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    expect(conversation.metadata.whatsappWindowClosedAt).toBe(T0.toISOString());
  });

  it("an AI reply Meta could not deliver tells the owner and admins [WA-46]", async () => {
    await outboundFor(conversationId, "wamid.TEST_OUT_0002", { senderType: "ai" });
    await post("status-failed-131047");
    const notices = await db.select().from(notifications).where(eq(notifications.userId, owner.userId));
    expect(notices.map((notice) => notice.event)).toContain("channel_error");
  });

  it("a status whose message is not stored yet is retried later instead of dropped (§8.2)", async () => {
    await post("status-read");
    expect(await pendingJobs(STATUS_RETRY_JOB)).toHaveLength(1);
  });

  it("a status revealing the BSUID of a contact we wrote to by phone adds it to that contact [WA-40]", async () => {
    await db.delete(contactIdentities).where(eq(contactIdentities.externalId, WA_TEST.customer.bsuid));
    await outboundFor(conversationId);
    await post("status-sent");
    const identities = await db.select().from(contactIdentities);
    expect(identities.map((row) => row.externalId).sort()).toEqual([WA_TEST.customer.waId, WA_TEST.customer.bsuid].sort());
  });
});

describe("account notices [WA-20] [WA-22] [WA-29]", () => {
  it("a restriction tells owner and admins and asks for a health check", async () => {
    expect((await post("account-update")).status).toBe(200);
    const notices = await db.select().from(notifications).where(eq(notifications.userId, owner.userId));
    expect(notices.map((notice) => notice.event)).toContain("whatsapp_quality");
    expect(await pendingJobs(HEALTH_CHECK_JOB)).toHaveLength(1);
  });

  it("a template status updates the synced template (languages compared with - or _)", async () => {
    await db.insert(whatsappTemplates).values({ channelId: channel.id, name: "recordatorio_cita", language: "es-ES", status: "PENDING" });
    await post("template-status");
    const [template] = await db.select().from(whatsappTemplates);
    expect(template).toMatchObject({ status: "APPROVED", category: "UTILITY", rejectedReason: null });
  });

  it("an approved name starts the 14-day re-registration reminder", async () => {
    await post("name-update-approved");
    const [row] = await db.select().from(channels).where(eq(channels.id, channel.id));
    expect(row.nameStatus).toBe("APPROVED");
    expect(row.nameApprovedAt).toEqual(T0);
  });
});

describe("GET verification [WA-31] [WA-12]", () => {
  it("returns the challenge with the installation's token and records the time; refuses anything else", async () => {
    const token = await readWhatsAppVerifyToken();
    const params = (values: Record<string, string>) => new URLSearchParams(values);
    expect(await verifyWhatsAppWebhook(params({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "1158201444" }), T0)).toEqual({ ok: true, challenge: "1158201444" });
    const [settings] = await db.select().from(integrationSettings);
    expect(settings.whatsappVerifiedAt).toEqual(T0);
    expect((await verifyWhatsAppWebhook(params({ "hub.mode": "subscribe", "hub.verify_token": `${token}x`, "hub.challenge": "1" }))).ok).toBe(false);
    expect((await verifyWhatsAppWebhook(params({ "hub.mode": "unsubscribe", "hub.verify_token": token, "hub.challenge": "1" }))).ok).toBe(false);
    expect((await verifyWhatsAppWebhook(params({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "<script>" }))).ok).toBe(false);
  });
});
