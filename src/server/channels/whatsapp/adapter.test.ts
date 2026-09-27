import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, messages, realtimeEvents } from "@/db/schema";
import { isAllowlisted, testModeIdentifiers } from "@/server/engine/checks";
import { createBusiness, createChannel, createContactWithIdentity, createConversation } from "@/test/factories";
import { fixtureBody, WA_TEST } from "@/test/fixtures/whatsapp";
import { connectedNumberRoutes, FAKE_META_BASE_URL, fakeMetaFetch, metaError, metaJson, sendMessageResponse, type MetaHandler } from "@/test/fixtures/whatsapp/fake-meta";
import { demoAdapter } from "../demo-adapter";
import { getChannelAdapter } from "../registry";
import { ChannelSendError, type ChannelRecord, type OutboundMessage } from "../types";
import { createWhatsAppAdapter, whatsappAdapter } from "./adapter";
import { encryptWhatsAppSecrets } from "./config";

let channel: ChannelRecord;

function adapter(handler: MetaHandler = connectedNumberRoutes()) {
  const fake = fakeMetaFetch(handler);
  return { calls: fake.calls, adapter: createWhatsAppAdapter({ fetchImpl: fake.fetch, baseUrl: FAKE_META_BASE_URL, sleep: async () => {} }) };
}

const outbound = (conversationId: string, overrides: Partial<OutboundMessage> = {}): OutboundMessage => ({
  messageId: crypto.randomUUID(),
  conversationId,
  recipient: { externalIds: [], phone: "34600999888", email: null, name: null },
  threadId: null,
  contentType: "text",
  text: "¡Hola!",
  ...overrides,
});

beforeEach(async () => {
  for (const table of [messages, conversations, contactIdentities, contacts, realtimeEvents]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
  channel = await createChannel({
    type: "whatsapp",
    name: "WhatsApp",
    status: "connected",
    phoneNumberId: WA_TEST.phoneNumberId,
    wabaId: WA_TEST.wabaId,
    metaAppId: WA_TEST.appId,
    graphApiVersion: "v26.0",
    secretsEnc: encryptWhatsAppSecrets({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: null }),
  });
});

describe("WhatsAppAdapter in the registry [CAN-02] [CAN-14]", () => {
  it("is the adapter of real WhatsApp channels; demo ones keep the DemoAdapter", () => {
    expect(getChannelAdapter({ type: "whatsapp", isDemo: false })).toBe(whatsappAdapter);
    expect(getChannelAdapter({ type: "whatsapp", isDemo: true })).toBe(demoAdapter);
    expect(whatsappAdapter.capabilities(channel)).toMatchObject({ templates: true, window24h: true, typing: true, readReceipts: true, audio: true, images: true, documents: true, html: false });
  });

  it("handleWebhook gives only this channel's events", async () => {
    const events = await whatsappAdapter.handleWebhook(channel, { body: fixtureBody("text") });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "inbound_message", externalId: "wamid.TEST_IN_TEXT_0001" });
    expect(await whatsappAdapter.handleWebhook({ ...channel, phoneNumberId: "999", wabaId: "888" }, { body: fixtureBody("text") })).toEqual([]);
  });
});

describe("sending [WA-39] [WA-42] [WA-44]", () => {
  it("writes to «+» + wa_id from the channel's identity, never to a phone a person typed", async () => {
    const { contact } = await createContactWithIdentity("whatsapp", { externalId: WA_TEST.customer.bsuid, phone: WA_TEST.customer.waId });
    await db.update(contacts).set({ phone: "34600999888" }).where(eq(contacts.id, contact.id));
    const conversation = await createConversation(channel.id, contact.id);
    const { adapter: wa, calls } = adapter();
    expect(await wa.send(channel, outbound(conversation.id))).toMatchObject({ externalId: "wamid.TEST_OUT_SENT", status: "sent" });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ to: `+${WA_TEST.customer.waId}`, type: "text" });
    expect(calls[0].body).not.toHaveProperty("recipient");
  });

  it("a contact with only a BSUID gets the reply by `recipient` [WA-39]", async () => {
    const { contact } = await createContactWithIdentity("whatsapp", { externalId: WA_TEST.bsuidOnly.bsuid, phone: null });
    const conversation = await createConversation(channel.id, contact.id);
    const { adapter: wa, calls } = adapter(connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}/messages`]: () => metaJson(sendMessageResponse("wamid.B", { input: WA_TEST.bsuidOnly.bsuid, user_id: WA_TEST.bsuidOnly.bsuid })) }));
    await wa.send(channel, outbound(conversation.id));
    expect(calls[0].body).toMatchObject({ recipient: WA_TEST.bsuidOnly.bsuid });
    expect(calls[0].body).not.toHaveProperty("to");
  });

  it("a 131047 from Meta marks the conversation's window as closed and fails for good [WA-43] [WA-46]", async () => {
    const { contact } = await createContactWithIdentity("whatsapp", { externalId: WA_TEST.customer.bsuid, phone: WA_TEST.customer.waId });
    const conversation = await createConversation(channel.id, contact.id);
    const { adapter: wa } = adapter(connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}/messages`]: () => metaError(131047, 400) }));
    const error = await wa.send(channel, outbound(conversation.id)).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ChannelSendError);
    expect(error).toMatchObject({ retryable: false, channelCode: 131047 });
    const [row] = await db.select().from(conversations).where(eq(conversations.id, conversation.id));
    expect(typeof row.metadata.whatsappWindowClosedAt).toBe("string");
  });

  it("without credentials it fails with a clear message and calls nobody", async () => {
    const { adapter: wa, calls } = adapter();
    await expect(wa.send({ ...channel, secretsEnc: null }, outbound(crypto.randomUUID()))).rejects.toMatchObject({ userMessage: expect.stringContaining("Faltan las credenciales") });
    expect(calls).toHaveLength(0);
  });

  it("«leído» and «escribiendo…» use the customer's wamid [WA-45]", async () => {
    const { adapter: wa, calls } = adapter(connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}/messages`]: () => metaJson({ success: true }) }));
    await wa.markRead?.(channel, "wamid.IN");
    await wa.sendTyping?.(channel, "wamid.IN");
    expect(calls.map((call) => call.body)).toEqual([
      { messaging_product: "whatsapp", status: "read", message_id: "wamid.IN" },
      { messaging_product: "whatsapp", status: "read", message_id: "wamid.IN", typing_indicator: { type: "text" } },
    ]);
  });
});

describe("validateAndConnect and health [WA-05] [WA-26]", () => {
  it("returns the secrets to store encrypted, and the lights", async () => {
    const { adapter: wa } = adapter();
    const result = await wa.validateAndConnect(channel, { accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, phoneNumberId: WA_TEST.phoneNumberId });
    expect(result).toEqual({ ok: true, config: {}, secrets: { access_token: WA_TEST.accessToken, app_secret: WA_TEST.appSecret } });
    const health = await wa.healthCheck(channel);
    expect(health.checks.find((check) => check.key === "subscription")?.status).toBe("ok");
  });
});

describe("test mode with WhatsApp identities [CAN-06] [WA-25]", () => {
  it("the list may have the number (any format) or the BSUID; only what WhatsApp gives is compared", () => {
    const identities = [
      { externalId: WA_TEST.customer.bsuid, phone: WA_TEST.customer.waId },
      { externalId: WA_TEST.customer.waId, phone: WA_TEST.customer.waId },
    ];
    const ids = testModeIdentifiers("whatsapp", identities);
    expect(isAllowlisted(["+1 555-000-2222"], ids)).toBe(true);
    expect(isAllowlisted([WA_TEST.customer.bsuid], ids)).toBe(true);
    expect(isAllowlisted(["+34 600 000 000"], ids)).toBe(false);
    expect(isAllowlisted([WA_TEST.bsuidOnly.bsuid], testModeIdentifiers("whatsapp", [{ externalId: WA_TEST.bsuidOnly.bsuid, phone: null }]))).toBe(true);
  });
});
