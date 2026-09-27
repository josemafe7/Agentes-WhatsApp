import { describe, expect, it } from "vitest";
import { createMetaGraphClient } from "@/lib/meta/client";
import { FAKE_META_BASE_URL, fakeMetaFetch, metaError, metaJson, metaRoutes, sendMessageResponse, type MetaHandler } from "@/test/fixtures/whatsapp/fake-meta";
import { WA_TEST } from "@/test/fixtures/whatsapp";
import type { FileStorage } from "@/server/adapters/file-storage";
import { ChannelSendError, type OutboundMessage } from "../types";
import { buildMessagePayload, chooseDestination, SEND_MAX_ATTEMPTS, sendRetryDelayMs, sendWithRetries } from "./send";

const message = (overrides: Partial<OutboundMessage> = {}): OutboundMessage => ({
  messageId: crypto.randomUUID(),
  conversationId: crypto.randomUUID(),
  recipient: { externalIds: [], phone: null, email: null, name: null },
  threadId: null,
  contentType: "text",
  text: "¡Hola! Tenemos hueco a las 17:00.",
  ...overrides,
});

function graph(handler: MetaHandler) {
  const fake = fakeMetaFetch(handler);
  return { client: createMetaGraphClient({ accessToken: WA_TEST.accessToken, baseUrl: FAKE_META_BASE_URL, fetchImpl: fake.fetch }), calls: fake.calls };
}

describe("where a WhatsApp reply goes [WA-39] [WA-42]", () => {
  it("to = «+» + wa_id when the channel gave the phone; recipient = BSUID only without phone; never both", () => {
    expect(chooseDestination([{ externalId: WA_TEST.customer.bsuid, phone: WA_TEST.customer.waId }])).toEqual({ to: `+${WA_TEST.customer.waId}` });
    expect(chooseDestination([{ externalId: WA_TEST.customer.waId, phone: null }])).toEqual({ to: `+${WA_TEST.customer.waId}` });
    expect(chooseDestination([{ externalId: WA_TEST.bsuidOnly.bsuid, phone: null }])).toEqual({ recipient: WA_TEST.bsuidOnly.bsuid });
    expect(chooseDestination([{ externalId: "visitor-uuid-like-id", phone: null }])).toBeNull();
  });

  it("builds text, file (by uploaded id, with caption and file name) and template payloads", () => {
    expect(buildMessagePayload(message(), null)).toEqual({ type: "text", text: { body: "¡Hola! Tenemos hueco a las 17:00.", preview_url: false } });
    expect(buildMessagePayload(message({ contentType: "document", text: "Tu factura", media: { fileKey: "media/2026/09/x.pdf", fileName: "factura.pdf" } }), "77")).toEqual({
      type: "document",
      document: { id: "77", caption: "Tu factura", filename: "factura.pdf" },
    });
    expect(buildMessagePayload(message({ contentType: "audio", text: "no caption for audio" }), "78")).toEqual({ type: "audio", audio: { id: "78" } });
    const template = { name: "recordatorio_cita", language: { code: "es" }, components: [] };
    expect(buildMessagePayload(message({ contentType: "template", metadata: { whatsappTemplate: template } }), null)).toEqual({ type: "template", template });
    expect(() => buildMessagePayload(message({ contentType: "template", metadata: {} }), null)).toThrow(ChannelSendError);
    expect(() => buildMessagePayload(message({ contentType: "location" }), null)).toThrow(ChannelSendError);
  });
});

describe("sending with retries [WA-44] [WA-46]", () => {
  it("sends ONE message and returns its wamid as «enviado»", async () => {
    const { client, calls } = graph(metaRoutes({ [`POST /${WA_TEST.phoneNumberId}/messages`]: () => metaJson(sendMessageResponse("wamid.OUT")) }));
    const result = await sendWithRetries(client, WA_TEST.phoneNumberId, { recipient: WA_TEST.bsuidOnly.bsuid }, message(), { sleep: async () => {} });
    expect(result).toMatchObject({ externalId: "wamid.OUT", status: "sent" });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ messaging_product: "whatsapp", recipient_type: "individual", recipient: WA_TEST.bsuidOnly.bsuid, type: "text", text: { body: "¡Hola! Tenemos hueco a las 17:00.", preview_url: false } });
  });

  it("retries a transient error with growing waits, then succeeds", async () => {
    const waits: number[] = [];
    let attempt = 0;
    const { client, calls } = graph(() => (++attempt < 3 ? metaError(131000, 500) : metaJson(sendMessageResponse("wamid.LATE"))));
    const result = await sendWithRetries(client, WA_TEST.phoneNumberId, { to: "+15550002222" }, message(), { sleep: async (ms) => void waits.push(ms) });
    expect(result.externalId).toBe("wamid.LATE");
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([1_000, 2_000]);
  });

  it("131056 waits 4^X seconds and gives up within the time budget with a final error", async () => {
    const waits: number[] = [];
    const { client, calls } = graph(() => metaError(131056, 400));
    const error = await sendWithRetries(client, WA_TEST.phoneNumberId, { to: "+15550002222" }, message(), { sleep: async (ms) => void waits.push(ms) }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ChannelSendError);
    expect(error).toMatchObject({ retryable: false, channelCode: 131056 });
    expect(waits).toEqual([1_000, 4_000]);
    expect(calls.length).toBeLessThanOrEqual(SEND_MAX_ATTEMPTS);
    expect(sendRetryDelayMs(131056, 2)).toBe(16_000);
  });

  it("a permanent error (131047) is not retried: failed with its Spanish message and code", async () => {
    const { client, calls } = graph(() => metaError(131047, 400));
    await expect(sendWithRetries(client, WA_TEST.phoneNumberId, { to: "+15550002222" }, message(), { sleep: async () => {} })).rejects.toMatchObject({
      userMessage: "La ventana de 24 h está cerrada. Usa una plantilla aprobada.",
      channelCode: 131047,
      retryable: false,
    });
    expect(calls).toHaveLength(1);
  });

  it("uploads a file once, even when the send is retried, and sends it by id", async () => {
    let sends = 0;
    const { client, calls } = graph(
      metaRoutes({
        [`POST /${WA_TEST.phoneNumberId}/media`]: () => metaJson({ id: "555" }),
        [`POST /${WA_TEST.phoneNumberId}/messages`]: () => (++sends === 1 ? metaError(130429, 400) : metaJson(sendMessageResponse())),
      }),
    );
    const storage: FileStorage = {
      kind: "disk",
      put: async () => ({ key: "k", size: 1 }),
      get: async () => ({ stream: new Response(new Uint8Array([37, 80, 68, 70, 45])).body as ReadableStream<Uint8Array>, contentType: "application/pdf", size: 5 }),
      delete: async () => {},
      exists: async () => true,
    };
    await sendWithRetries(client, WA_TEST.phoneNumberId, { to: "+15550002222" }, message({ contentType: "document", text: null, media: { fileKey: "media/2026/09/a.pdf", mimeType: "application/pdf", fileName: "a.pdf" } }), {
      sleep: async () => {},
      storage,
    });
    expect(calls.map((call) => call.path)).toEqual([`/${WA_TEST.phoneNumberId}/media`, `/${WA_TEST.phoneNumberId}/messages`, `/${WA_TEST.phoneNumberId}/messages`]);
    expect(calls[2].body).toMatchObject({ type: "document", document: { id: "555", filename: "a.pdf" } });
  });
});
