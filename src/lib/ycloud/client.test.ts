import { describe, expect, it } from "vitest";
import { FAKE_YCLOUD_BASE_URL, fakeYCloudFetch, JPEG_BYTES, mediaLink, phoneNumberResponse, sentMessageResponse, YC_TEST, ycError, ycFile, ycloudAccount, ycloudRoutes, ycOk } from "@/test/fixtures/ycloud";
import { createYCloudClient, isYCloudMediaUrl, YCLOUD_WEBHOOK_EVENTS } from "./client";
import { describeYCloudError, isYCloudApiError, YCloudApiError } from "./errors";
import { computeYCloudSignature, verifyYCloudSignature } from "./signature";

function client(handler: Parameters<typeof fakeYCloudFetch>[0], apiKey: string = YC_TEST.apiKey) {
  const fake = fakeYCloudFetch(handler);
  return { calls: fake.calls, api: createYCloudClient({ apiKey, ...fake.deps }) };
}

async function failure(run: () => Promise<unknown>): Promise<YCloudApiError> {
  try {
    await run();
  } catch (error) {
    if (isYCloudApiError(error)) return error;
    throw error;
  }
  throw new Error("La llamada tendría que haber fallado.");
}

describe("YCloud API client (docs/integracion-ycloud.md)", () => {
  it("sends the key in X-API-Key, never in the address, and reads the balance and the numbers [YC-02]", async () => {
    const { api, calls } = client(ycloudAccount().handler);
    expect(await api.getBalance()).toEqual({ amount: 12.5, currency: "USD" });
    expect(await api.listPhoneNumbers()).toEqual([expect.objectContaining({ phoneNumber: YC_TEST.phoneNumber, wabaId: YC_TEST.wabaId, status: "CONNECTED" })]);
    for (const call of calls) {
      expect(call.headers.get("x-api-key")).toBe(YC_TEST.apiKey);
      expect(`${call.path}?${call.query.toString()}`).not.toContain(YC_TEST.apiKey);
    }
    expect(calls[1].query.get("page")).toBe("1");
  });

  it("a text that cannot be a header value never leaves [SEG-05]", () => {
    const fake = fakeYCloudFetch(ycloudAccount().handler);
    for (const apiKey of ["", "   ", "clave con espacios", "clave\r\nX-Otra: 1", "ñ".repeat(20), "a".repeat(501)]) {
      expect(() => createYCloudClient({ apiKey, ...fake.deps })).toThrow(YCloudApiError);
    }
    expect(fake.calls).toHaveLength(0);
  });

  it("follows the pages of a list while they come full and skips an odd entry", async () => {
    const full = Array.from({ length: 100 }, (_, index) => phoneNumberResponse({ phoneNumber: `+346001${String(index).padStart(5, "0")}` }));
    const { api, calls } = client(
      ycloudRoutes({ "GET /whatsapp/phoneNumbers": (call) => ycOk({ items: call.query.get("page") === "1" ? full : ["roto", phoneNumberResponse()], limit: 100 }) }),
    );
    expect(await api.listPhoneNumbers()).toHaveLength(101);
    expect(calls.map((call) => call.query.get("page"))).toEqual(["1", "2"]);
  });

  it("creates the channel's webhook endpoint asking only for what the app handles [YC-03]", async () => {
    const account = ycloudAccount();
    const { api, calls } = client(account.handler);
    const endpoint = await api.createWebhookEndpoint({ url: "https://agentes.example.com/api/webhooks/ycloud/abc", description: "DominIA Agentes" });
    expect(endpoint).toMatchObject({ id: YC_TEST.endpointId, secret: YC_TEST.webhookSecret });
    expect(calls[0].body).toEqual({ url: "https://agentes.example.com/api/webhooks/ycloud/abc", enabledEvents: [...YCLOUD_WEBHOOK_EVENTS], status: "active", description: "DominIA Agentes" });
    expect(YCLOUD_WEBHOOK_EVENTS).toEqual(["whatsapp.inbound_message.received", "whatsapp.message.updated", "whatsapp.smb.message.echoes", "whatsapp.template.reviewed"]);
    await api.deleteWebhookEndpoint(endpoint.id);
    expect(await failure(() => api.getWebhookEndpoint(endpoint.id))).toMatchObject({ httpStatus: 404, retryable: false });
  });

  it("errors come in Spanish by code, keep Meta's code and never carry the key or YCloud's text [YC-07] [SEG-02]", async () => {
    const { api } = client(
      ycloudRoutes({
        "GET /balance": () => ycError(401, "UNAUTHORIZED"),
        "POST /whatsapp/messages/sendDirectly": () => ycError(403, "BALANCE_INSUFFICIENT"),
        "GET /whatsapp/phoneNumbers": () => ycError(429, "TOO_MANY_REQUESTS", { retryAfter: 3 }),
        "GET /whatsapp/templates": () => ycError(400, "BAD_REQUEST", { metaCode: 131047 }),
      }),
    );
    const unauthorized = await failure(() => api.getBalance());
    expect(unauthorized).toMatchObject({ code: "UNAUTHORIZED", retryable: false });
    expect(unauthorized.userMessage).toMatch(/no acepta la clave/);
    const noBalance = await failure(() => api.sendMessage({ from: YC_TEST.phoneNumber, to: YC_TEST.customer.phone, type: "text", text: { body: "hola" } }));
    expect(noBalance).toMatchObject({ code: "BALANCE_INSUFFICIENT", retryable: false });
    expect(noBalance.action).toMatch(/Recarga saldo/);
    expect(await failure(() => api.listPhoneNumbers())).toMatchObject({ retryable: true, retryAfterSec: 3 });
    expect(await failure(() => api.listTemplates(YC_TEST.wabaId))).toMatchObject({ metaCode: 131047 });
    for (const error of [unauthorized, noBalance]) {
      expect(`${error.message} ${error.userMessage} ${error.action}`).not.toContain(YC_TEST.apiKey);
      expect(error.message).not.toContain("Test error");
    }
    expect(describeYCloudError({ code: "ALGO_NUEVO" }).message).toContain("ALGO_NUEVO");
    expect(describeYCloudError({ httpStatus: 503 })).toMatchObject({ retryable: true });
  });

  it("a network failure keeps neither the address nor the key [SEG-02]", async () => {
    const api = createYCloudClient({
      apiKey: YC_TEST.apiKey,
      baseUrl: FAKE_YCLOUD_BASE_URL,
      fetchImpl: (async (input: string | URL | Request) => {
        throw new Error(`connect ECONNREFUSED ${String(input)} ${YC_TEST.apiKey}`);
      }) as typeof fetch,
    });
    const error = await failure(() => api.getBalance());
    expect(error.retryable).toBe(true);
    expect(`${error.message} ${error.userMessage}`).not.toContain(YC_TEST.apiKey);
  });

  it("sends one message with sendDirectly and uploads a file as multipart [YC-07]", async () => {
    const { api, calls } = client(ycloudAccount().handler);
    expect(await api.sendMessage({ from: YC_TEST.phoneNumber, to: YC_TEST.customer.phone, type: "text", text: { body: "Hola" } })).toMatchObject({ id: sentMessageResponse().id, status: "accepted" });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/whatsapp/messages/sendDirectly" });
    expect(await api.uploadMedia(YC_TEST.phoneNumber, { bytes: JPEG_BYTES, mimeType: "image/jpeg", fileName: "corte.jpg" })).toBe("media-subida-1");
    expect(calls[1].path).toBe(`/whatsapp/media/${encodeURIComponent(YC_TEST.phoneNumber)}/upload`);
    expect(((calls[1].body as FormData).get("file") as File).name).toBe("corte.jpg");
    await api.markAsRead("wamid.ABC=");
    await api.sendTyping("wamid.ABC=");
    expect(calls.slice(2).map((call) => call.path)).toEqual(["/whatsapp/inboundMessages/wamid.ABC%3D/markAsRead", "/whatsapp/inboundMessages/wamid.ABC%3D/typing"]);
  });

  it("downloads a file only from YCloud's own host, with the key, and never past the limit [YC-06]", async () => {
    const { api, calls } = client(ycloudRoutes({ "GET /whatsapp/media/download/:id": () => ycFile(JPEG_BYTES, "image/jpeg") }));
    const file = await api.downloadMedia(mediaLink("592623615738103"), { maxBytes: 1_000 });
    expect([...file.bytes]).toEqual([...JPEG_BYTES]);
    expect(calls[0].headers.get("x-api-key")).toBe(YC_TEST.apiKey);
    for (const url of ["https://evil.example/v2/whatsapp/media/download/1", "https://api.ycloud.test.evil.example/v2/x", "https://user:pass@api.ycloud.test/v2/x", "no-es-una-url", ""]) {
      expect(isYCloudMediaUrl(url, FAKE_YCLOUD_BASE_URL)).toBe(false);
      expect(await failure(() => api.downloadMedia(url, { maxBytes: 1_000 }))).toMatchObject({ httpStatus: 400 });
    }
    expect(await failure(() => api.downloadMedia(mediaLink("592623615738103"), { maxBytes: 4 }))).toMatchObject({ httpStatus: 413 });
    expect(calls).toHaveLength(2);
  });

  it("an answer that is not what the API documents is an error, not a crash", async () => {
    const { api } = client(ycloudRoutes({ "GET /balance": () => new Response("<html>", { status: 200 }), "POST /webhookEndpoints": () => ycOk({ url: "sin id" }) }));
    expect(await failure(() => api.getBalance())).toMatchObject({ retryable: true });
    expect(await failure(() => api.createWebhookEndpoint({ url: "https://agentes.example.com/x" }))).toMatchObject({ retryable: true });
  });
});

describe("YCloud-Signature [YC-05] [SEG-08]", () => {
  const now = new Date("2026-09-26T10:00:00Z");
  const body = new TextEncoder().encode('{"id":"evt_1","type":"whatsapp.inbound_message.received"}');
  const t = Math.floor(now.getTime() / 1_000);
  const valid = computeYCloudSignature(YC_TEST.webhookSecret, body, t);

  it("accepts the HMAC-SHA256 of «t.body» with the endpoint's secret", () => {
    expect(valid).toMatch(/^t=\d+,s=[0-9a-f]{64}$/);
    expect(verifyYCloudSignature(body, valid, YC_TEST.webhookSecret, now)).toBe(true);
    expect(verifyYCloudSignature(body, valid.toUpperCase().replace("T=", "t=").replace(",S=", ",s="), YC_TEST.webhookSecret, now)).toBe(true);
  });

  it("refuses another secret, another body, a missing or malformed header and an old or future timestamp", () => {
    const other = new TextEncoder().encode('{"id":"evt_2"}');
    expect(verifyYCloudSignature(body, valid, `${YC_TEST.webhookSecret}x`, now)).toBe(false);
    expect(verifyYCloudSignature(other, valid, YC_TEST.webhookSecret, now)).toBe(false);
    expect(verifyYCloudSignature(body, valid, "", now)).toBe(false);
    for (const header of [null, undefined, "", "t=1", `s=${"a".repeat(64)}`, `t=${t},s=abc`, `t=${t},s=${"z".repeat(64)}`, `${valid},extra`]) {
      expect(verifyYCloudSignature(body, header, YC_TEST.webhookSecret, now)).toBe(false);
    }
    expect(verifyYCloudSignature(body, valid, YC_TEST.webhookSecret, new Date(now.getTime() + 5 * 60_000 + 1_000))).toBe(false);
    expect(verifyYCloudSignature(body, valid, YC_TEST.webhookSecret, new Date(now.getTime() - 5 * 60_000 - 1_000))).toBe(false);
    expect(verifyYCloudSignature(body, valid, YC_TEST.webhookSecret, new Date(now.getTime() + 4 * 60_000))).toBe(true);
  });
});
