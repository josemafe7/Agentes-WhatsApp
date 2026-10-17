import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, jobs, messages } from "@/db/schema";
import { createInstagramClient, INSTAGRAM_MAX_TEXT_BYTES } from "@/lib/instagram/client";
import { WINDOW_CLOSED_METADATA_KEY, whatsappWindowState } from "@/lib/meta/window";
import { createChannel, createContactWithIdentity, createConversation } from "@/test/factories";
import { connectedAccountRoutes, fakeInstagramFetch, IG_TEST, igError, igOk, sentResponse, type InstagramHandler } from "@/test/fixtures/instagram";
import { ChannelSendError, type OutboundMessage } from "../types";
import { createInstagramAdapter } from "./adapter";
import { encryptInstagramSecrets } from "./config";
import { INSTAGRAM_TEXT_ONLY, sendInstagramMessage } from "./send";

function outbound(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    messageId: crypto.randomUUID(),
    conversationId: crypto.randomUUID(),
    recipient: { externalIds: [IG_TEST.customer.id], phone: null, email: null, name: "Ana" },
    threadId: null,
    contentType: "text",
    text: "Hola, Ana",
    ...overrides,
  };
}

function setup(overrides: Record<string, InstagramHandler> = {}) {
  const fake = fakeInstagramFetch(connectedAccountRoutes(overrides));
  const client = createInstagramClient({ accessToken: IG_TEST.accessToken, ...fake.deps });
  const accountErrors: number[] = [];
  const send = (message: OutboundMessage) => sendInstagramMessage(client, message, { onAccountError: async () => void accountErrors.push(1) });
  return { calls: fake.calls, send, accountErrors, deps: fake.deps };
}

async function sendError(run: () => Promise<unknown>): Promise<ChannelSendError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ChannelSendError) return error;
    throw error;
  }
  throw new Error("El envío tendría que haber fallado.");
}

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

beforeEach(async () => {
  for (const table of [messages, conversations, contactIdentities, contacts, jobs]) await db.delete(table);
  await db.delete(channels);
});

describe("sending by Instagram [IG-03] [IG-05] [IG-12]", () => {
  it("one text to the customer's Instagram id; its id in the channel is the mid Instagram returns", async () => {
    const { send, calls } = setup({ "POST me/messages": () => igOk(sentResponse("m_321")) });
    const result = await send(outbound());
    expect(result).toMatchObject({ externalId: "m_321", status: "sent" });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ recipient: { id: IG_TEST.customer.id }, message: { text: "Hola, Ana" } });
  });

  it("a text longer than 1,000 bytes is cut with «…», never split in two messages [IG-05]", async () => {
    const { send, calls } = setup();
    await send(outbound({ text: "¿Qué tal? ".repeat(200) }));
    expect(calls).toHaveLength(1);
    const sent = (calls[0].body as { message: { text: string } }).message.text;
    expect(bytes(sent)).toBeLessThanOrEqual(INSTAGRAM_MAX_TEXT_BYTES);
    expect(sent.endsWith("…")).toBe(true);
  });

  it("anything but text is refused before calling Instagram, not retried [IG-03]", async () => {
    const { send, calls } = setup();
    for (const contentType of ["image", "audio", "document", "template"] as const) {
      const error = await sendError(() => send(outbound({ contentType, media: { fileKey: "media/x.jpg" } })));
      expect(error.userMessage).toBe(INSTAGRAM_TEXT_ONLY);
      expect(error.retryable).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  it("a closed window marks the conversation so the inbox shows it closed, and the message fails with the reason [IG-04] [BAN-18]", async () => {
    const channel = await createChannel({ type: "instagram", status: "connected" });
    const { contact } = await createContactWithIdentity("instagram", { externalId: IG_TEST.customer.id });
    const lastInboundAt = new Date(Date.now() - 60 * 60_000);
    const conversation = await createConversation(channel.id, contact.id, { lastInboundAt });
    const { send } = setup({ "POST me/messages": () => igError(10, 2534022) });
    const error = await sendError(() => send(outbound({ conversationId: conversation.id })));
    expect(error).toMatchObject({ retryable: false, channelCode: 10 });
    expect(error.userMessage).toMatch(/^Han pasado más de 24 horas desde el último mensaje del cliente: Instagram no deja responder/);
    const [row] = await db.select().from(conversations).where(eq(conversations.id, conversation.id));
    expect(typeof row.metadata[WINDOW_CLOSED_METADATA_KEY]).toBe("string");
    expect(whatsappWindowState(lastInboundAt, new Date(), row.metadata)).toMatchObject({ open: false, closedByMeta: true });
  });

  it("a rate limit is worth another try (the common sending retries once); an unavailable customer is final [IG-12]", async () => {
    const limited = setup({ "POST me/messages": () => igError(613, 2534040) });
    expect(await sendError(() => limited.send(outbound()))).toMatchObject({ retryable: true });
    const unavailable = setup({ "POST me/messages": () => igError(551, 1545041) });
    const error = await sendError(() => unavailable.send(outbound()));
    expect(error).toMatchObject({ retryable: false });
    expect(error.userMessage).toMatch(/no puede recibir mensajes/);
  });

  it("a problem of the account itself (an invalid token) asks for a check of the channel [IG-09]", async () => {
    const { send, accountErrors } = setup({ "POST me/messages": () => igError(190, undefined, 401) });
    const error = await sendError(() => send(outbound()));
    expect(error.userMessage).toMatch(/token de Instagram no es válido/);
    expect(accountErrors).toHaveLength(1);
  });

  it("through the adapter: a rate limit fails as worth another try and the next one goes; an invalid token puts the channel in «error» at once [IG-09] [IG-12]", async () => {
    const channel = await createChannel({
      type: "instagram",
      status: "connected",
      config: { accountId: IG_TEST.accountId },
      secretsEnc: encryptInstagramSecrets({ accessToken: IG_TEST.accessToken, appSecret: IG_TEST.appSecret, metaAppSecret: null, verifyToken: IG_TEST.verifyToken }),
    });
    const { contact } = await createContactWithIdentity("instagram", { externalId: IG_TEST.customer.id });
    const conversation = await createConversation(channel.id, contact.id, { lastInboundAt: new Date() });
    let attempts = 0;
    const adapter = createInstagramAdapter(fakeInstagramFetch(connectedAccountRoutes({ "POST me/messages": () => (++attempts === 1 ? igError(613, 2534040) : igOk(sentResponse("m_ok"))) })).deps);
    const limited = await sendError(() => adapter.send(channel, outbound({ conversationId: conversation.id })));
    expect(limited.retryable).toBe(true);
    expect(await adapter.send(channel, outbound({ conversationId: conversation.id }))).toMatchObject({ externalId: "m_ok", status: "sent" });

    const revoked = createInstagramAdapter(fakeInstagramFetch(connectedAccountRoutes({ "POST me/messages": () => igError(190, undefined, 401) })).deps);
    expect(await sendError(() => revoked.send(channel, outbound({ conversationId: conversation.id })))).toMatchObject({ retryable: false, channelCode: 190 });
    const [after] = await db.select().from(channels).where(eq(channels.id, channel.id));
    expect(after.status).toBe("error");
    expect(after.lastHealth?.checks.find((check) => check.key === "token")).toMatchObject({ status: "error" });
  });

  it("a channel without its token cannot send, and says so", async () => {
    const channel = await createChannel({ type: "instagram", status: "connected", secretsEnc: null });
    const error = await sendError(() => createInstagramAdapter().send(channel, outbound()));
    expect(error.userMessage).toMatch(/Falta el token/);
  });
});
