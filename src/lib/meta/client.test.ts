import { describe, expect, it } from "vitest";
import {
  connectedNumberRoutes,
  debugTokenResponse,
  FAKE_META_BASE_URL,
  fakeMetaFetch,
  metaError,
  metaJson,
  metaRoutes,
  templatesResponse,
} from "@/test/fixtures/whatsapp/fake-meta";
import { WA_TEST } from "@/test/fixtures/whatsapp";
import { createMetaGraphClient, isAllowedMediaUrl, metaGraphBaseUrl, WHATSAPP_WEBHOOK_FIELDS } from "./client";
import { MetaGraphError } from "./errors";

function client(handler: Parameters<typeof fakeMetaFetch>[0], options: { version?: string; appSecret?: string | null } = {}) {
  const fake = fakeMetaFetch(handler);
  const graph = createMetaGraphClient({
    accessToken: WA_TEST.accessToken,
    appId: WA_TEST.appId,
    appSecret: options.appSecret === undefined ? WA_TEST.appSecret : options.appSecret,
    version: options.version,
    baseUrl: FAKE_META_BASE_URL,
    fetchImpl: fake.fetch,
  });
  return { graph, calls: fake.calls };
}

describe("Graph client: versions, tokens and paths [WA-49]", () => {
  it("uses META_GRAPH_BASE_URL or Meta's, and the channel's version in every path (v26.0 by default)", async () => {
    expect(metaGraphBaseUrl()).toBe("https://graph.facebook.com");
    const { graph, calls } = client(connectedNumberRoutes());
    await graph.getPhoneNumber(WA_TEST.phoneNumberId);
    expect(calls[0].url.startsWith(`${FAKE_META_BASE_URL}/v26.0/${WA_TEST.phoneNumberId}?fields=`)).toBe(true);
    expect(calls[0].query.get("fields")).toContain("health_status");

    const other = fakeMetaFetch(() => metaJson({ id: WA_TEST.phoneNumberId }));
    await createMetaGraphClient({ accessToken: "x", version: "v25.0", baseUrl: FAKE_META_BASE_URL, fetchImpl: other.fetch }).getPhoneNumber(WA_TEST.phoneNumberId);
    expect(new URL(other.calls[0].url).pathname).toBe(`/v25.0/${WA_TEST.phoneNumberId}`);
  });

  it("sends the system user's token as Bearer and never in the URL", async () => {
    const { graph, calls } = client(connectedNumberRoutes());
    await graph.getSubscribedApps(WA_TEST.wabaId);
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${WA_TEST.accessToken}`);
    expect(calls[0].url).not.toContain(WA_TEST.accessToken);
  });

  it("uses the app token (APP_ID|APP_SECRET) only for /debug_token and /{APP_ID}/subscriptions", async () => {
    const { graph, calls } = client(
      metaRoutes({
        "GET /debug_token": () => metaJson(debugTokenResponse()),
        [`GET /${WA_TEST.appId}/subscriptions`]: () => metaJson({ data: [] }),
        [`POST /${WA_TEST.appId}/subscriptions`]: () => metaJson({ success: true }),
      }),
    );
    await graph.debugToken(WA_TEST.accessToken);
    await graph.listAppSubscriptions();
    await graph.subscribeApp({ callbackUrl: "https://agentes.example.es/api/webhooks/whatsapp", verifyToken: "verify-123" });
    for (const call of calls) {
      expect(call.query.get("access_token")).toBe(`${WA_TEST.appId}|${WA_TEST.appSecret}`);
      expect(call.headers.get("authorization")).toBeNull();
    }
    expect(calls[0].query.get("input_token")).toBe(WA_TEST.accessToken);
    expect(calls[2].body).toEqual({
      object: "whatsapp_business_account",
      callback_url: "https://agentes.example.es/api/webhooks/whatsapp",
      verify_token: "verify-123",
      fields: WHATSAPP_WEBHOOK_FIELDS.join(","),
      include_values: "true",
    });
  });

  it("subscribes the WABA without a body (never override_callback_uri) and registers with messaging_product and pin [WA-14] [WA-15] [WA-17]", async () => {
    const { graph, calls } = client(
      metaRoutes({
        [`POST /${WA_TEST.wabaId}/subscribed_apps`]: () => metaJson({ success: true }),
        [`POST /${WA_TEST.phoneNumberId}/register`]: () => metaJson({ success: true }),
        [`POST /${WA_TEST.phoneNumberId}/request_code`]: () => metaJson({ success: true }),
      }),
    );
    expect(await graph.subscribeWaba(WA_TEST.wabaId)).toBe(true);
    expect(calls[0].body).toBeUndefined();
    await graph.register(WA_TEST.phoneNumberId, "123456");
    expect(calls[1].body).toEqual({ messaging_product: "whatsapp", pin: "123456" });
    await graph.requestCode(WA_TEST.phoneNumberId, "SMS");
    expect(calls[2].body).toEqual({ code_method: "SMS", language: "es" });
  });

  it("follows the template pages by their `after` cursor, not the absolute next URL [WA-22]", async () => {
    let page = 0;
    const { graph, calls } = client(
      metaRoutes({
        [`GET /${WA_TEST.wabaId}/message_templates`]: () => {
          page += 1;
          const first = templatesResponse();
          return metaJson(page === 1 ? { ...first, paging: { ...first.paging, next: "https://evil.example/next" } } : templatesResponse([{ id: "7", name: "otra", language: "es", status: "PAUSED" }, { bad: true }]));
        },
      }),
    );
    const templates = await graph.listTemplates(WA_TEST.wabaId);
    expect(templates.map((template) => template.name)).toEqual(["recordatorio_cita", "otra"]);
    expect(calls).toHaveLength(2);
    expect(calls[1].query.get("after")).toBe("QVFIUb");
    expect(calls.every((call) => call.host === new URL(FAKE_META_BASE_URL).host)).toBe(true);
  });

  it("marks as read and shows «escribiendo…» with the wamid [WA-45]", async () => {
    const { graph, calls } = client(metaRoutes({ [`POST /${WA_TEST.phoneNumberId}/messages`]: () => metaJson({ success: true }) }));
    await graph.markRead(WA_TEST.phoneNumberId, "wamid.IN");
    await graph.markRead(WA_TEST.phoneNumberId, "wamid.IN", { typing: true });
    expect(calls[0].body).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.IN" });
    expect(calls[1].body).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.IN", typing_indicator: { type: "text" } });
  });
});

describe("Graph client: failures [WA-09]", () => {
  it("turns Meta's error body into MetaGraphError with the Spanish message", async () => {
    const { graph } = client(() => metaError(190, 401));
    await expect(graph.getPhoneNumber(WA_TEST.phoneNumberId)).rejects.toMatchObject({ code: 190, httpStatus: 401, retryable: false });
  });

  it("is_transient and 5xx are retryable; an odd 200 body is an invalid response", async () => {
    await expect(client(() => metaError(100, 400, { isTransient: true })).graph.getWaba(WA_TEST.wabaId)).rejects.toMatchObject({ retryable: true });
    await expect(client(() => new Response("oops", { status: 503 })).graph.getWaba(WA_TEST.wabaId)).rejects.toMatchObject({ httpStatus: 503, retryable: true });
    await expect(client(() => metaJson({ nothing: true })).graph.getWaba(WA_TEST.wabaId)).rejects.toMatchObject({ httpStatus: 502 });
  });

  it("network errors never carry the URL (the app token may be in it)", async () => {
    const { graph } = client(() => {
      throw new Error(`connect ECONNREFUSED ${FAKE_META_BASE_URL}/v26.0/debug_token?access_token=${WA_TEST.appId}|${WA_TEST.appSecret}`);
    });
    const error = await graph.debugToken("x").catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(MetaGraphError);
    expect(String((error as Error).message)).not.toContain(WA_TEST.appSecret);
    expect((error as MetaGraphError).retryable).toBe(true);
  });

  it("refuses bad ids, a bad version and a missing app secret before calling", async () => {
    const { graph, calls } = client(() => metaJson({}), { appSecret: null });
    await expect(graph.getPhoneNumber("../me")).rejects.toMatchObject({ code: 100 });
    await expect(graph.debugToken("x")).rejects.toBeInstanceOf(MetaGraphError);
    expect(calls).toHaveLength(0);
    expect(() => createMetaGraphClient({ version: "latest" })).toThrow(MetaGraphError);
  });
});

describe("Graph client: media [WA-41]", () => {
  it("downloads with the same Bearer token only from Meta's hosts or the configured base URL", async () => {
    expect(isAllowedMediaUrl("https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1")).toBe(true);
    expect(isAllowedMediaUrl("http://lookaside.fbsbx.com/x")).toBe(false);
    expect(isAllowedMediaUrl("https://evil.example/fbsbx.com")).toBe(false);
    expect(isAllowedMediaUrl("https://user:pass@lookaside.fbsbx.com/x")).toBe(false);
    expect(isAllowedMediaUrl(`${FAKE_META_BASE_URL}/media/1`, FAKE_META_BASE_URL)).toBe(true);

    const { graph, calls } = client(() => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }));
    const file = await graph.downloadMedia("https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1");
    expect([...file.bytes]).toEqual([1, 2, 3]);
    expect(file.contentType).toBe("image/jpeg");
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${WA_TEST.accessToken}`);
    await expect(graph.downloadMedia("https://evil.example/file")).rejects.toBeInstanceOf(MetaGraphError);
    expect(calls).toHaveLength(1);
  });

  it("follows at most 3 redirects by hand, checking every address; the token never leaves the first host", async () => {
    const { graph, calls } = client((call) =>
      call.host === "lookaside.fbsbx.com"
        ? new Response(null, { status: 302, headers: { location: "https://mmg.whatsapp.net/d/f/1.enc" } })
        : new Response(new Uint8Array([7]), { headers: { "content-type": "audio/ogg" } }),
    );
    const file = await graph.downloadMedia("https://lookaside.fbsbx.com/x");
    expect([...file.bytes]).toEqual([7]);
    expect(calls.map((call) => call.host)).toEqual(["lookaside.fbsbx.com", "mmg.whatsapp.net"]);
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${WA_TEST.accessToken}`);
    expect(calls[1].headers.get("authorization")).toBeNull();

    // Off Meta's hosts (an internal address, say) it is never followed.
    const internal = client(() => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }));
    await expect(internal.graph.downloadMedia("https://lookaside.fbsbx.com/x")).rejects.toBeInstanceOf(MetaGraphError);
    expect(internal.calls).toHaveLength(1);

    // Nor endlessly.
    const loop = client((call) => new Response(null, { status: 302, headers: { location: `https://lookaside.fbsbx.com${call.path}x` } }));
    await expect(loop.graph.downloadMedia("https://lookaside.fbsbx.com/x")).rejects.toBeInstanceOf(MetaGraphError);
    expect(loop.calls).toHaveLength(4);
  });

  it("stops reading a file bigger than allowed", async () => {
    const { graph } = client(() => new Response(new Uint8Array(10)));
    await expect(graph.downloadMedia("https://lookaside.fbsbx.com/x", { maxBytes: 5 })).rejects.toMatchObject({ httpStatus: 413, code: 131052 });
  });

  it("uploads with messaging_product, type and the file (multipart)", async () => {
    const { graph, calls } = client(metaRoutes({ [`POST /${WA_TEST.phoneNumberId}/media`]: () => metaJson({ id: "1234" }) }));
    expect(await graph.uploadMedia(WA_TEST.phoneNumberId, { bytes: new Uint8Array([1]), mimeType: "application/pdf", fileName: "a.pdf" })).toBe("1234");
    const form = calls[0].body as FormData;
    expect(form.get("messaging_product")).toBe("whatsapp");
    expect(form.get("type")).toBe("application/pdf");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });
});
