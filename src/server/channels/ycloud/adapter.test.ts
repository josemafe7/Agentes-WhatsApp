import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { appKv, channels, contactIdentities, contacts, conversations, jobs, messages, notifications, realtimeEvents } from "@/db/schema";
import { createChannel, createContactWithIdentity, createConversation, createMessage, createUser } from "@/test/factories";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import { fakeYCloudFetch, inboundText, JPEG_BYTES, mediaLink, OGG_BYTES, sentMessageResponse, statusEvent, YC_TEST, ycError, ycFile, ycloudAccount, ycOk, type YCloudHandler } from "@/test/fixtures/ycloud";
import { getChannelAdapter, getSendAdapter } from "../registry";
import { demoAdapter } from "../demo-adapter";
import { ChannelSendError, type ChannelRecord, type OutboundMessage } from "../types";
import { whatsappAdapter } from "../whatsapp/adapter";
import { createYCloudAdapter, ycloudAdapter } from "./adapter";
import { encryptYCloudSecrets, ycloudPhoneNumberId } from "./config";
import { runYCloudHealthCheck, runYCloudMediaDownload } from "./jobs";

function adapter(overrides: Record<string, YCloudHandler> = {}) {
  const fake = fakeYCloudFetch(ycloudAccount(overrides).handler);
  return { calls: fake.calls, deps: fake.deps, adapter: createYCloudAdapter({ ...fake.deps, sleep: async () => undefined }) };
}

const number = (overrides: Partial<typeof channels.$inferInsert> = {}): Promise<ChannelRecord> =>
  createChannel({
    type: "whatsapp",
    connectionMode: "ycloud",
    name: "WhatsApp YCloud",
    phoneNumberId: ycloudPhoneNumberId(YC_TEST.phoneNumber),
    wabaId: YC_TEST.wabaId,
    displayPhoneNumber: YC_TEST.displayPhoneNumber,
    config: { ycloudPhoneNumber: YC_TEST.phoneNumber, ycloudWebhookEndpointId: YC_TEST.endpointId },
    secretsEnc: encryptYCloudSecrets({ apiKey: YC_TEST.apiKey, webhookSecret: YC_TEST.webhookSecret }),
    ...overrides,
  });

async function conversationWith(channel: ChannelRecord, identity: { externalId: string; phone: string | null } = { externalId: YC_TEST.customer.waId, phone: YC_TEST.customer.waId }) {
  const { contact } = await createContactWithIdentity("whatsapp", identity);
  return createConversation(channel.id, contact.id);
}

const outbound = (conversationId: string, overrides: Partial<OutboundMessage> = {}): OutboundMessage => ({
  messageId: crypto.randomUUID(),
  conversationId,
  recipient: { externalIds: [YC_TEST.customer.waId], phone: YC_TEST.customer.waId, email: null, name: "Ana" },
  threadId: null,
  contentType: "text",
  text: "¡Hola, Ana!",
  ...overrides,
});

beforeEach(async () => {
  for (const table of [messages, conversations, contactIdentities, contacts, jobs, notifications, realtimeEvents, appKv]) await db.delete(table);
  await db.delete(channels);
});

describe("YCloudAdapter [YC-06] [YC-07] [WA-54]", () => {
  it("the registry gives it to the numbers connected through YCloud, and Meta's to the rest [WA-54] [ARR-11]", () => {
    expect(getChannelAdapter({ type: "whatsapp", isDemo: false, connectionMode: "ycloud" })).toBe(ycloudAdapter);
    expect(getChannelAdapter({ type: "whatsapp", isDemo: false, connectionMode: "manual" })).toBe(whatsappAdapter);
    expect(getChannelAdapter({ type: "whatsapp", isDemo: false })).toBe(whatsappAdapter);
    expect(getChannelAdapter({ type: "whatsapp", isDemo: true, connectionMode: "ycloud" })).toBe(demoAdapter);
    expect(getSendAdapter({ type: "whatsapp", isDemo: false, connectionMode: "ycloud" }, true)).toBe(demoAdapter);
    // The official API all the same: templates and the 24 h window ([WA-55]).
    expect(ycloudAdapter.capabilities({} as ChannelRecord)).toMatchObject({ templates: true, window24h: true, audio: true, images: true, documents: true });
  });

  it("sends one text from the channel's number to the customer's phone, and keeps YCloud's id for the statuses", async () => {
    const channel = await number();
    const conversation = await conversationWith(channel);
    const { adapter: ycloud, calls } = adapter({ "POST /whatsapp/messages/sendDirectly": () => ycOk(sentMessageResponse("67f10001")) });
    expect(await ycloud.send(channel, outbound(conversation.id))).toMatchObject({ externalId: "67f10001", status: "sent" });
    expect(calls).toHaveLength(1);
    // YCloud's own body: the business number in `from` and Meta's content object, nothing else.
    expect(calls[0].body).toEqual({ from: YC_TEST.phoneNumber, to: YC_TEST.customer.phone, type: "text", text: { body: "¡Hola, Ana!", preview_url: false } });
  });

  it("a customer known only by their WhatsApp user id is addressed by it, never by a phone [WA-39]", async () => {
    const channel = await number();
    const conversation = await conversationWith(channel, { externalId: YC_TEST.customer.bsuid, phone: null });
    const { adapter: ycloud, calls } = adapter();
    await ycloud.send(channel, outbound(conversation.id, { recipient: { externalIds: [YC_TEST.customer.bsuid], phone: null, email: null, name: null } }));
    expect(calls[0].body).toMatchObject({ from: YC_TEST.phoneNumber, recipient: YC_TEST.customer.bsuid });
    expect(calls[0].body).not.toHaveProperty("to");
  });

  it("uploads a file first and sends it by id; ours are private [YC-07]", async () => {
    const channel = await number();
    const conversation = await conversationWith(channel);
    const { storage } = memoryFileStorage();
    const fileKey = "media/2026/09/foto.jpg";
    await storage.put(fileKey, JPEG_BYTES, "image/jpeg");
    const fake = fakeYCloudFetch(ycloudAccount().handler);
    const ycloud = createYCloudAdapter({ ...fake.deps, storage });
    await ycloud.send(channel, outbound(conversation.id, { contentType: "image", text: "Así queda", media: { fileKey, mimeType: "image/jpeg", fileName: "foto.jpg" } }));
    expect(fake.calls.map((call) => call.path)).toEqual([`/whatsapp/media/${encodeURIComponent(YC_TEST.phoneNumber)}/upload`, "/whatsapp/messages/sendDirectly"]);
    expect(fake.calls[1].body).toMatchObject({ type: "image", image: { id: "media-subida-1", caption: "Así queda" } });
  });

  it("a refusal says why in Spanish with its code; Meta closing the window is remembered in the conversation [WA-43]", async () => {
    const channel = await number();
    const conversation = await conversationWith(channel);
    const noBalance = adapter({ "POST /whatsapp/messages/sendDirectly": () => ycError(403, "BALANCE_INSUFFICIENT") });
    const error = await noBalance.adapter.send(channel, outbound(conversation.id)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ChannelSendError);
    expect(error).toMatchObject({ retryable: false, channelCode: "BALANCE_INSUFFICIENT", userMessage: expect.stringMatching(/No queda saldo/) });

    const closed = adapter({ "POST /whatsapp/messages/sendDirectly": () => ycError(400, "BAD_REQUEST", { metaCode: 131047 }) });
    await expect(closed.adapter.send(channel, outbound(conversation.id))).rejects.toMatchObject({ channelCode: 131047 });
    const [row] = await db.select().from(conversations).where(eq(conversations.id, conversation.id));
    expect(Object.keys(row.metadata)).toHaveLength(1);

    // A transient failure is retried, and then it goes through.
    let attempts = 0;
    const flaky = adapter({ "POST /whatsapp/messages/sendDirectly": () => ((attempts += 1) < 3 ? ycError(503, "SERVICE_UNAVAILABLE") : ycOk(sentMessageResponse())) });
    expect(await flaky.adapter.send(channel, outbound(conversation.id))).toMatchObject({ status: "sent" });
    expect(attempts).toBe(3);

    const disconnected = await number({ phoneNumberId: "ycloud:34600999777", secretsEnc: null });
    await expect(adapter().adapter.send(disconnected, outbound(conversation.id))).rejects.toMatchObject({ retryable: false });
  });

  it("«escribiendo…» and the read mark go by the message's id; disconnecting removes the channel's endpoint [YC-10]", async () => {
    const channel = await number();
    const { adapter: ycloud, calls } = adapter({ "DELETE /webhookEndpoints/:id": () => ycOk({}) });
    await ycloud.sendTyping?.(channel, "wamid.PRUEBA1");
    await ycloud.markRead?.(channel, "wamid.PRUEBA1");
    await ycloud.disconnect(channel);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /whatsapp/inboundMessages/wamid.PRUEBA1/typing",
      "POST /whatsapp/inboundMessages/wamid.PRUEBA1/markAsRead",
      `DELETE /webhookEndpoints/${YC_TEST.endpointId}`,
    ]);
  });

  it("handleWebhook turns an already verified event into this channel's events, never calling YCloud [CAN-10]", async () => {
    const channel = await number();
    const { adapter: ycloud, calls } = adapter();
    expect(await ycloud.handleWebhook(channel, { body: inboundText("Hola") })).toMatchObject([{ kind: "inbound_message", contentType: "text", text: "Hola" }]);
    expect(await ycloud.handleWebhook(channel, { body: statusEvent("67f10001", "read") })).toMatchObject([{ kind: "status_update", externalId: "67f10001", status: "read" }]);
    expect(await ycloud.handleWebhook(channel, { body: "nada" })).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("YCloud jobs [YC-06] [YC-09]", () => {
  const context = { job: { id: "job-1", attempts: 1, maxAttempts: 4 }, remainingMs: () => 30_000 } as Parameters<typeof runYCloudMediaDownload>[1];

  it("downloads a customer's file from YCloud with the key and stores it privately", async () => {
    const channel = await number();
    const conversation = await conversationWith(channel);
    const message = await createMessage(conversation, { externalId: "wamid.FOTO", contentType: "image", text: null, media: { externalMediaId: "592623615738103", mimeType: "image/jpeg", downloadStatus: "pending" } });
    const { storage } = memoryFileStorage();
    const fake = fakeYCloudFetch(ycloudAccount({ "GET /whatsapp/media/download/:id": () => ycFile(JPEG_BYTES, "image/jpeg") }).handler);
    const payload = { channelId: channel.id, externalId: "wamid.FOTO", url: mediaLink("592623615738103"), mimeType: "image/jpeg", fileName: null };
    expect(await runYCloudMediaDownload(payload, context, { ...fake.deps, storage })).toBe("done");
    const [row] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(row.media).toMatchObject({ downloadStatus: "done", mimeType: "image/jpeg" });
    expect(await storage.get(row.media?.fileKey ?? "")).not.toBeNull();
    expect(fake.calls[0].headers.get("x-api-key")).toBe(YC_TEST.apiKey);
    // Done once: a second run does not download again.
    expect(await runYCloudMediaDownload(payload, context, { ...fake.deps, storage })).toBe("skipped");
    expect(fake.calls).toHaveLength(1);
  });

  it("a link that is not YCloud's own is never followed: the message says the file could not be downloaded [SEG-05]", async () => {
    const channel = await number();
    const conversation = await conversationWith(channel);
    const message = await createMessage(conversation, { externalId: "wamid.VOZ", contentType: "audio", text: null, media: { mimeType: "audio/ogg", downloadStatus: "pending" } });
    const fake = fakeYCloudFetch(ycloudAccount({ "GET /whatsapp/media/download/:id": () => ycFile(OGG_BYTES, "audio/ogg") }).handler);
    const payload = { channelId: channel.id, externalId: "wamid.VOZ", url: "https://evil.example/whatsapp/media/download/1", mimeType: "audio/ogg", fileName: null };
    expect(await runYCloudMediaDownload(payload, context, { ...fake.deps, storage: memoryFileStorage().storage })).toBe("failed");
    expect((await db.select().from(messages).where(eq(messages.id, message.id)))[0].media).toMatchObject({ downloadStatus: "failed" });
    expect(fake.calls).toHaveLength(0);
  });

  it("the health check refreshes the lights and tells owner and admins when something gets worse [CAN-15]", async () => {
    const owner = await createUser("owner");
    const channel = await number({ status: "connected", lastHealth: { checkedAt: "2026-09-26T04:00:00.000Z", checks: [{ key: "key", status: "ok" }, { key: "balance", status: "ok" }] } });
    const fake = fakeYCloudFetch(ycloudAccount({}, { balance: 0 }).handler);
    const report = await runYCloudHealthCheck(channel.id, fake.deps);
    expect(report?.health.checks.find((check) => check.key === "balance")).toMatchObject({ status: "error", detail: expect.stringMatching(/Sin saldo/) });
    expect(await db.select().from(notifications).where(eq(notifications.userId, owner.userId))).toMatchObject([{ channelId: channel.id, title: expect.stringMatching(/ha empeorado .*Saldo/) }]);
    // Drafts, disabled channels and numbers connected another way are not checked.
    const disabled = await number({ phoneNumberId: "ycloud:34600999666", status: "disabled" });
    const meta = await createChannel({ type: "whatsapp", connectionMode: "manual", phoneNumberId: "200000000000002" });
    expect(await runYCloudHealthCheck(disabled.id, fake.deps)).toBeNull();
    expect(await runYCloudHealthCheck(meta.id, fake.deps)).toBeNull();
  });
});
