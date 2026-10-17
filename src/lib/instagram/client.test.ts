import { describe, expect, it } from "vitest";
import { computeMetaSignature } from "@/lib/meta/signature";
import {
  connectedAccountRoutes,
  fakeInstagramFetch,
  FAKE_INSTAGRAM_BASE_URL,
  FAKE_INSTAGRAM_CDN,
  IG_TEST,
  igError,
  igFile,
  igOk,
  instagramRoutes,
  JPEG_BYTES,
  meResponse,
  sentResponse,
  SIXTY_DAYS_S,
  type InstagramHandler,
} from "@/test/fixtures/instagram";
import { createInstagramClient, fitInstagramText, INSTAGRAM_GRAPH_VERSION, INSTAGRAM_MAX_TEXT_BYTES, INSTAGRAM_WEBHOOK_FIELDS, isInstagramMediaUrl } from "./client";
import { describeInstagramError, InstagramApiError } from "./errors";
import { instantOf, meSchema, webhookEventSchema } from "./schemas";

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

function client(handler: InstagramHandler, accessToken: string = IG_TEST.accessToken) {
  const fake = fakeInstagramFetch(handler);
  return { calls: fake.calls, api: createInstagramClient({ accessToken, ...fake.deps }) };
}

async function failure(run: () => Promise<unknown>): Promise<InstagramApiError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof InstagramApiError) return error;
    throw error;
  }
  throw new Error("La llamada tendría que haber fallado.");
}

describe("fitting a reply to Instagram's 1,000 bytes [IG-05]", () => {
  it("a text that fits goes as it is", () => {
    expect(fitInstagramText("Hola, ¿qué tal?")).toBe("Hola, ¿qué tal?");
    expect(bytes("Hola, ¿qué tal?")).toBe(17);
    const exact = "a".repeat(INSTAGRAM_MAX_TEXT_BYTES);
    expect(fitInstagramText(exact)).toBe(exact);
  });

  it("counts bytes, not characters: accented letters weigh 2 and the cut ends in «…» [IG-05]", () => {
    const text = "á".repeat(600); // 600 characters, 1,200 bytes
    const fitted = fitInstagramText(text);
    expect(bytes(fitted)).toBeLessThanOrEqual(INSTAGRAM_MAX_TEXT_BYTES);
    expect(fitted.endsWith("…")).toBe(true);
    // «…» is 3 bytes: 997 left, so 498 letters of 2 bytes.
    expect(fitted).toBe(`${"á".repeat(498)}…`);
  });

  it("never splits a character: an emoji (4 bytes) is kept whole or left out [IG-05]", () => {
    const text = `${"a".repeat(995)}😀😀`;
    const fitted = fitInstagramText(text);
    expect(fitted).toBe(`${"a".repeat(995)}…`);
    expect(fitted.isWellFormed()).toBe(true);
    const emojis = fitInstagramText("😀".repeat(300));
    expect(emojis.isWellFormed()).toBe(true);
    expect(bytes(emojis)).toBeLessThanOrEqual(INSTAGRAM_MAX_TEXT_BYTES);
    expect(emojis).toBe(`${"😀".repeat(249)}…`);
  });
});

describe("addresses of the customers' files [IG-03]", () => {
  it("only https on Instagram's CDN, or the configured base (the test mock)", () => {
    expect(isInstagramMediaUrl(`${FAKE_INSTAGRAM_CDN}/v/t51/foto.jpg`, FAKE_INSTAGRAM_BASE_URL)).toBe(true);
    expect(isInstagramMediaUrl("https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1", FAKE_INSTAGRAM_BASE_URL)).toBe(true);
    expect(isInstagramMediaUrl(`${FAKE_INSTAGRAM_BASE_URL}/cdn/foto.jpg`, FAKE_INSTAGRAM_BASE_URL)).toBe(true);
    for (const url of [
      "http://scontent.cdninstagram.com/foto.jpg",
      "https://cdninstagram.com.evil.example/foto.jpg",
      "https://evilcdninstagram.com/foto.jpg",
      "https://user:pass@scontent.cdninstagram.com/foto.jpg",
      "https://example.com/foto.jpg",
      "no es una url",
    ]) {
      expect(isInstagramMediaUrl(url, FAKE_INSTAGRAM_BASE_URL), url).toBe(false);
    }
  });
});

describe("Instagram Graph client (docs/integracion-instagram.md)", () => {
  it("calls <base>/v25.0/<path> with the token as a Bearer header, never in the URL [IG-01]", async () => {
    const { api, calls } = client(connectedAccountRoutes());
    const me = await api.getMe();
    expect(me).toMatchObject({ user_id: IG_TEST.accountId, username: IG_TEST.username, name: IG_TEST.accountName });
    expect(INSTAGRAM_GRAPH_VERSION).toBe("v25.0");
    expect(calls[0]).toMatchObject({ httpMethod: "GET", route: "me", version: "v25.0" });
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${IG_TEST.accessToken}`);
    expect(calls[0].url.searchParams.has("access_token")).toBe(false);
    expect(calls[0].url.searchParams.get("fields")).toBe("user_id,username,name,account_type");
  });

  it("/me may come wrapped in `data` (the guide's example) or plain (the reference) [IG-01]", () => {
    expect(meSchema.parse({ data: [meResponse()] })).toMatchObject({ user_id: IG_TEST.accountId });
    expect(meSchema.parse(meResponse({ user_id: 9000000000000002 }))).toMatchObject({ user_id: "9000000000000002" });
  });

  it("subscribes the account to messages, reactions and «seen» [IG-01]", async () => {
    const { api, calls } = client(connectedAccountRoutes());
    expect(await api.subscribeApp()).toBe(true);
    expect(calls[0]).toMatchObject({ httpMethod: "POST", route: "me/subscribed_apps", version: "v25.0" });
    expect(calls[0].url.searchParams.get("subscribed_fields")).toBe(INSTAGRAM_WEBHOOK_FIELDS.join(","));
  });

  it("sends one text to the customer's id, already fitted, and returns its mid [IG-03] [IG-05]", async () => {
    const { api, calls } = client(connectedAccountRoutes({ "POST me/messages": () => igOk(sentResponse("m_1")) }));
    const sent = await api.sendText({ recipientId: IG_TEST.customer.id, text: "é".repeat(800) });
    expect(sent.message_id).toBe("m_1");
    expect(calls).toHaveLength(1);
    const body = calls[0].body as { recipient: { id: string }; message: { text: string } };
    expect(body.recipient).toEqual({ id: IG_TEST.customer.id });
    expect(bytes(body.message.text)).toBeLessThanOrEqual(INSTAGRAM_MAX_TEXT_BYTES);
    expect(calls[0].headers.get("content-type")).toBe("application/json");
  });

  it("an id that is not digits never reaches a path", async () => {
    const { api, calls } = client(connectedAccountRoutes());
    await expect(api.sendText({ recipientId: "../me", text: "hola" })).rejects.toBeInstanceOf(InstagramApiError);
    await expect(api.getUserProfile("me?fields=x")).rejects.toBeInstanceOf(InstagramApiError);
    expect(calls).toHaveLength(0);
  });

  it("renews with GET /refresh_access_token?grant_type=ig_refresh_token, without a version [IG-09]", async () => {
    const { api, calls } = client(connectedAccountRoutes());
    const renewed = await api.refreshToken();
    expect(renewed).toMatchObject({ access_token: IG_TEST.renewedToken, expires_in: SIXTY_DAYS_S });
    expect(calls[0]).toMatchObject({ httpMethod: "GET", route: "refresh_access_token", version: null });
    expect(calls[0].url.searchParams.get("grant_type")).toBe("ig_refresh_token");
    // The one documented call with the token in the query (§2.2).
    expect(calls[0].url.searchParams.get("access_token")).toBe(IG_TEST.accessToken);
  });

  it("reads a customer's name and user name [IG-08]", async () => {
    const { api, calls } = client(connectedAccountRoutes());
    expect(await api.getUserProfile(IG_TEST.customer.id)).toEqual({ name: IG_TEST.customer.name, username: IG_TEST.customer.username });
    expect(calls[0]).toMatchObject({ route: IG_TEST.customer.id, version: "v25.0" });
    expect(calls[0].url.searchParams.get("fields")).toBe("name,username");
  });

  it("downloads a customer's file from the CDN without the token, and refuses other hosts and big files [IG-03]", async () => {
    const { api, calls } = client(instagramRoutes({ "GET file": () => igFile(JPEG_BYTES, "image/jpeg") }));
    const file = await api.downloadFile(`${FAKE_INSTAGRAM_CDN}/v/t51/foto.jpg`);
    expect(file.bytes).toEqual(JPEG_BYTES);
    expect(file.contentType).toBe("image/jpeg");
    expect(calls[0].headers.get("authorization")).toBeNull();
    await expect(api.downloadFile("https://example.com/foto.jpg")).rejects.toBeInstanceOf(InstagramApiError);
    const big = await failure(() => api.downloadFile(`${FAKE_INSTAGRAM_CDN}/v/t51/foto.jpg`, { maxBytes: 4 }));
    expect(big.retryable).toBe(false);
  });

  it("a redirect off Instagram's hosts is refused [IG-03]", async () => {
    const { api } = client(instagramRoutes({ "GET file": () => new Response(null, { status: 302, headers: { location: "https://example.com/robado" } }) }));
    await expect(api.downloadFile(`${FAKE_INSTAGRAM_CDN}/v/t51/foto.jpg`)).rejects.toBeInstanceOf(InstagramApiError);
  });
});

describe("Instagram errors in Spanish, by code and subcode [IG-12]", () => {
  it("window closed (10/2534022 and 10/2018278): final, and marked as the window [IG-04]", async () => {
    for (const subcode of [2534022, 2018278]) {
      const { api } = client(connectedAccountRoutes({ "POST me/messages": () => igError(10, subcode) }));
      const error = await failure(() => api.sendText({ recipientId: IG_TEST.customer.id, text: "hola" }));
      expect(error).toMatchObject({ code: 10, subcode, window: true, retryable: false, account: false });
      expect(error.userMessage).toBe("Han pasado más de 24 horas desde el último mensaje del cliente: Instagram no deja responder hasta que vuelva a escribir.");
    }
  });

  it("an invalid token (190) is the account's problem, never retried [IG-09]", async () => {
    const { api } = client(connectedAccountRoutes({ "GET me": () => igError(190, undefined, 401) }));
    const error = await failure(() => api.getMe());
    expect(error).toMatchObject({ code: 190, account: true, retryable: false });
    expect(error.userMessage).toMatch(/token de Instagram no es válido/);
  });

  it("a rate limit (4, 613/2534040) or a transient error is retried; an unavailable customer is not [IG-12]", () => {
    expect(describeInstagramError(4).retryable).toBe(true);
    expect(describeInstagramError(613, 2534040).retryable).toBe(true);
    expect(describeInstagramError(551, 1545041)).toMatchObject({ retryable: false, message: "Esta persona no puede recibir mensajes de la cuenta ahora mismo." });
    expect(describeInstagramError(200, 2534041)).toMatchObject({ retryable: false, account: true });
    // An unknown one says its code and is final.
    expect(describeInstagramError(12345)).toMatchObject({ message: "Instagram ha devuelto un error (código 12345).", retryable: false });
  });

  it("`is_transient` makes any error worth another try", async () => {
    const { api } = client(connectedAccountRoutes({ "POST me/messages": () => igError(100, undefined, 400, { is_transient: true }) }));
    const error = await failure(() => api.sendText({ recipientId: IG_TEST.customer.id, text: "hola" }));
    expect(error.retryable).toBe(true);
  });

  it("a network failure never carries the URL (nor the token in it)", async () => {
    const fake = fakeInstagramFetch(() => {
      throw new Error(`fallo en ${FAKE_INSTAGRAM_BASE_URL}/refresh_access_token?access_token=${IG_TEST.accessToken}`);
    });
    const api = createInstagramClient({ accessToken: IG_TEST.accessToken, ...fake.deps });
    const error = await failure(() => api.refreshToken());
    expect(error.retryable).toBe(true);
    expect(JSON.stringify({ message: error.message, user: error.userMessage, action: error.action })).not.toContain(IG_TEST.accessToken);
  });
});

describe("webhook shapes (§5)", () => {
  it("the documented signature vectors are reproduced with both secrets [IG-02]", () => {
    const body = '{"object":"instagram","entry":[]}';
    expect(computeMetaSignature(IG_TEST.metaAppSecret, body)).toBe("sha256=4c166c139fb15bf4adbda063a21a4c7d870270ce3473257f03812313995045bd");
    expect(computeMetaSignature(IG_TEST.appSecret, body)).toBe("sha256=2ce531a1c56b981f54fafa24190ed44731977a6b46fdc9d00c1798033cfba254");
  });

  it("timestamps of 13 digits are milliseconds and of 10, seconds", () => {
    expect(instantOf(1_760_600_000_123).toISOString()).toBe("2025-10-16T07:33:20.123Z");
    expect(instantOf(1_760_600_000).toISOString()).toBe("2025-10-16T07:33:20.000Z");
  });

  it("an event's ids may come as numbers and become text", () => {
    const parsed = webhookEventSchema.parse({ sender: { id: 1100000000000003 }, recipient: { id: IG_TEST.accountId }, timestamp: 1, message: { mid: "m", text: "hola" } });
    expect(parsed.sender.id).toBe("1100000000000003");
  });
});
