// Who may use the web chat API: allowed domains (CORS), the visitor's own conversation only, disabled channels and
// rate limits ([WEB-08], [WEB-10], [WEB-11], [WEB-13], [SEG-04], [SEG-07]).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ afterTasks: [] as (() => unknown)[], storageDir: "" }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  // The reply runs after the response: collected here, never run by these tests.
  after: (task: () => unknown) => void state.afterTasks.push(task),
}));
vi.mock("@/server/adapters/file-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/adapters/file-storage")>();
  let storage: InstanceType<typeof actual.DiskStorage> | undefined;
  return { ...actual, getFileStorage: () => (storage ??= new actual.DiskStorage(state.storageDir)) };
});

import { eq } from "drizzle-orm";
import { db, getDb } from "@/db";
import { channels, consents, contactIdentities, contacts, conversations, jobs, messages, rateLimits, realtimeEvents } from "@/db/schema";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { aiDailyCapKeys, DAILY_CAP_MESSAGE, WIDGET_AI_DAILY_CAP, WIDGET_LIMITS } from "@/server/channels/webchat/limits";
import { issueVisitorToken } from "@/server/channels/webchat/tokens";
import { createBusiness, createChannel } from "@/test/factories";
import { APP_ORIGIN, newVisitor, PNG, SITE, widgetApi } from "./test-client";

let channelId: string;

const webchatConfig = (overrides: Record<string, unknown> = {}) => ({ allowedDomains: ["www.mipeluqueria.es"], imagesEnabled: true, ...overrides });

beforeAll(() => {
  state.storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-widget-access-"));
});

afterAll(() => fs.rmSync(state.storageDir, { recursive: true, force: true }));

beforeEach(async () => {
  for (const table of [jobs, realtimeEvents, rateLimits, consents, messages, conversations, contactIdentities, contacts, channels]) await db.delete(table);
  state.afterTasks = [];
  await createBusiness();
  channelId = (await createChannel({ type: "webchat", name: "Web", config: webchatConfig() })).id;
});

describe("allowed domains [WEB-10]", () => {
  it("answers a listed domain with its own origin, never '*'", async () => {
    const result = await widgetApi.config(channelId, { origin: SITE });
    expect(result.status).toBe(200);
    expect(result.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(result.headers.get("vary")).toContain("Origin");
  });

  it("refuses any other site without CORS headers, so the browser shows nothing", async () => {
    for (const origin of ["https://otra-web.es", "https://www.mipeluqueria.es.evil.com", "null"]) {
      const result = await widgetApi.config(channelId, { origin });
      expect(result.status).toBe(403);
      expect(result.headers.get("access-control-allow-origin")).toBeNull();
    }
    const session = await widgetApi.session(channelId, {}, { origin: "https://otra-web.es" });
    expect(session.status).toBe(403);
    expect(await db.select().from(contacts)).toEqual([]);
  });

  it("refuses a request that says nothing about its page", async () => {
    expect((await widgetApi.config(channelId, { origin: null })).status).toBe(403);
  });

  it("with an empty list, only works inside the app (/widget-demo), also for same-origin GETs without Origin", async () => {
    const onlyApp = (await createChannel({ type: "webchat", name: "Solo app", config: webchatConfig({ allowedDomains: [] }) })).id;
    expect((await widgetApi.config(onlyApp, { origin: SITE })).status).toBe(403);
    expect((await widgetApi.config(onlyApp, { origin: APP_ORIGIN })).status).toBe(200);
    expect((await widgetApi.config(onlyApp, { origin: null, referer: `${APP_ORIGIN}/widget-demo` })).status).toBe(200);
    // Any page of the app, like step 6 of the setup wizard.
    expect((await widgetApi.config(onlyApp, { origin: APP_ORIGIN, referer: `${APP_ORIGIN}/setup` })).status).toBe(200);
  });

  it("with domains in the list, the app itself only serves the chat to /widget-demo (signed-in outside the demo)", async () => {
    for (const refused of [
      { origin: APP_ORIGIN },
      { origin: APP_ORIGIN, referer: `${APP_ORIGIN}/setup` },
      { origin: null, referer: `${APP_ORIGIN}/bandeja` },
      // Another site cannot pass for /widget-demo.
      { origin: "https://otra-web.es", referer: `${APP_ORIGIN}/widget-demo` },
    ]) {
      const result = await widgetApi.config(channelId, refused);
      expect(result.status, JSON.stringify(refused)).toBe(403);
      expect(result.headers.get("access-control-allow-origin")).toBeNull();
    }
    const demo = await widgetApi.config(channelId, { origin: APP_ORIGIN, referer: `${APP_ORIGIN}/widget-demo?canal=${channelId}` });
    expect(demo.status).toBe(200);
    expect(demo.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    expect((await widgetApi.config(channelId, { origin: null, referer: `${APP_ORIGIN}/widget-demo` })).status).toBe(200);
  });

  it("answers the preflight only for allowed origins", async () => {
    const allowed = await widgetApi.preflight("messages", channelId, { origin: SITE });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(allowed.headers.get("access-control-allow-methods")).toContain("POST");
    expect(allowed.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");

    const refused = await widgetApi.preflight("messages", channelId, { origin: "https://otra-web.es" });
    expect(refused.status).toBe(403);
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("does not exist for unknown ids or channels that are not a web chat", async () => {
    const whatsapp = (await createChannel({ type: "whatsapp", name: "WhatsApp" })).id;
    for (const id of [crypto.randomUUID(), "no-es-un-id", whatsapp]) {
      const result = await widgetApi.config(id, { origin: SITE });
      expect(result.status).toBe(404);
      expect(result.headers.get("access-control-allow-origin")).toBeNull();
    }
  });
});

describe("a visitor only reads their own conversation [WEB-11]", () => {
  async function visitorWithImage() {
    const visitor = await newVisitor(channelId);
    const upload = await widgetApi.upload(channelId, PNG, { token: visitor.token });
    const sent = await widgetApi.send(channelId, { clientMessageId: crypto.randomUUID(), text: "Mi DNI es 12345678Z" }, { token: visitor.token });
    const image = await widgetApi.send(channelId, { clientMessageId: crypto.randomUUID(), upload: upload.body.upload }, { token: visitor.token });
    expect([sent.status, image.status]).toEqual([201, 201]);
    const media = (image.body.message as { media: { key: string } }).media;
    return { ...visitor, fileKey: media.key };
  }

  it("another visitor gets nothing of it: not in the history, not by polling, not its files", async () => {
    const ana = await visitorWithImage();
    const luis = await newVisitor(channelId);
    // Luis has a conversation of his own in the same chat.
    await widgetApi.send(channelId, { clientMessageId: crypto.randomUUID(), text: "Hola, soy Luis" }, { token: luis.token });

    const session = await widgetApi.session(channelId, { token: luis.token });
    expect((session.body.messages as { text: string }[]).map((message) => message.text)).toEqual(["Hola, soy Luis"]);
    const poll = await widgetApi.poll(channelId, "0", { token: luis.token });
    expect(poll.status).toBe(200);
    expect((poll.body.messages as { text: string }[]).map((message) => message.text)).toEqual(["Hola, soy Luis"]);
    expect(JSON.stringify(poll.body)).not.toContain("12345678Z");

    const media = await widgetApi.media(channelId, ana.fileKey, { token: luis.token });
    expect(media.status).toBe(404);
    expect((await widgetApi.media(channelId, ana.fileKey, { token: ana.token })).status).toBe(200);
  });

  it("rejects a forged token that claims the other visitor's id", async () => {
    const ana = await visitorWithImage();
    const luis = await newVisitor(channelId);
    const [version, body, signature] = luis.token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    const forged = [version, Buffer.from(JSON.stringify({ ...payload, v: ana.visitorId })).toString("base64url"), signature].join(".");

    for (const result of [
      await widgetApi.poll(channelId, "0", { token: forged }),
      await widgetApi.send(channelId, { clientMessageId: crypto.randomUUID(), text: "Hola" }, { token: forged }),
      await widgetApi.media(channelId, ana.fileKey, { token: forged }),
      await widgetApi.upload(channelId, PNG, { token: forged }),
    ]) {
      expect(result.status).toBe(401);
      expect(JSON.stringify(result.body)).not.toContain("12345678Z");
    }
    // A forged session token only ever starts a new, empty visitor.
    const session = await widgetApi.session(channelId, { token: forged });
    expect(session.body.visitorId).not.toBe(ana.visitorId);
    expect(session.body.messages).toEqual([]);
  });

  it("a token of one web chat is useless in another", async () => {
    const other = (await createChannel({ type: "webchat", name: "Otra web", config: webchatConfig() })).id;
    const ana = await visitorWithImage();
    const poll = await widgetApi.poll(other, "0", { token: ana.token });
    expect(poll.status).toBe(401);
    expect((await widgetApi.media(other, ana.fileKey, { token: ana.token })).status).toBe(401);
  });

  it("never accepts a visitor id chosen by the browser: the server creates it", async () => {
    const chosen = crypto.randomUUID();
    const session = await widgetApi.session(channelId, { visitorId: chosen });
    expect(session.status).toBe(200);
    expect(session.body.visitorId).not.toBe(chosen);
  });

  it("needs the token for everything but the public config", async () => {
    expect((await widgetApi.poll(channelId, "0")).status).toBe(401);
    expect((await widgetApi.send(channelId, { clientMessageId: crypto.randomUUID(), text: "Hola" })).status).toBe(401);
    expect((await widgetApi.upload(channelId, PNG)).status).toBe(401);
    expect(await db.select().from(messages)).toEqual([]);
  });
});

describe("disabled channel [WEB-13] [CAN-16]", () => {
  it("says it is not available and refuses to open, send, poll or upload", async () => {
    const visitor = await newVisitor(channelId);
    await db.update(channels).set({ status: "disabled" }).where(eq(channels.id, channelId));

    const config = await widgetApi.config(channelId);
    expect(config.status).toBe(200);
    expect(config.body.available).toBe(false);

    for (const result of [
      await widgetApi.session(channelId, { token: visitor.token }),
      await widgetApi.send(channelId, { clientMessageId: crypto.randomUUID(), text: "Hola" }, { token: visitor.token }),
      await widgetApi.poll(channelId, visitor.cursor, { token: visitor.token }),
      await widgetApi.upload(channelId, PNG, { token: visitor.token }),
    ]) {
      expect(result.status).toBe(403);
      expect(result.body.code).toBe("channel_disabled");
      expect(result.body.error).toBe("El chat no está disponible en este momento.");
      // The widget can read why (CORS headers on the error).
      expect(result.headers.get("access-control-allow-origin")).toBe(SITE);
    }
    expect(await db.select().from(messages)).toEqual([]);
  });
});

describe("rate limits [WEB-08] [SEG-07]", () => {
  it("per visitor: over the limit the chat says «Demasiados mensajes, espera un momento» and stores nothing", async () => {
    const visitor = await newVisitor(channelId, { ip: "198.51.100.1" });
    const send = () => widgetApi.send(channelId, { clientMessageId: crypto.randomUUID(), text: "Hola" }, { token: visitor.token, ip: "198.51.100.1" });
    for (let i = 0; i < 15; i++) expect((await send()).status).toBe(201);
    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("Demasiados mensajes, espera un momento.");
    expect(blocked.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(await db.select().from(messages)).toHaveLength(15);
  });

  it("per IP: many visitors from one address are limited together, other addresses are not", async () => {
    const ip = "198.51.100.2";
    const visitors = await Promise.all([1, 2, 3, 4, 5].map(() => newVisitor(channelId, { ip })));
    let accepted = 0;
    let lastStatus = 0;
    for (const visitor of visitors) {
      for (let i = 0; i < 13; i++) {
        lastStatus = (await widgetApi.send(channelId, { clientMessageId: crypto.randomUUID(), text: "Hola" }, { token: visitor.token, ip })).status;
        if (lastStatus === 201) accepted++;
      }
    }
    expect(accepted).toBe(60);
    expect(lastStatus).toBe(429);
    const elsewhere = await widgetApi.send(channelId, { clientMessageId: crypto.randomUUID(), text: "Hola" }, { token: visitors[0].token, ip: "198.51.100.3" });
    expect(elsewhere.status).toBe(201);
  });

  it("limits new visitors per IP", async () => {
    const ip = "198.51.100.4";
    for (let i = 0; i < 30; i++) expect((await widgetApi.session(channelId, {}, { ip })).status).toBe(200);
    expect((await widgetApi.session(channelId, {}, { ip })).status).toBe(429);
    expect((await widgetApi.session(channelId, {}, { ip: "198.51.100.5" })).status).toBe(200);
  });

  it("limits uploads per visitor", async () => {
    const visitor = await newVisitor(channelId, { ip: "198.51.100.6" });
    for (let i = 0; i < 10; i++) expect((await widgetApi.upload(channelId, PNG, { token: visitor.token, ip: "198.51.100.6" })).status).toBe(201);
    expect((await widgetApi.upload(channelId, PNG, { token: visitor.token, ip: "198.51.100.6" })).status).toBe(429);
  });
});

describe("limits come before any read of the database [SEG-07]", () => {
  /** Counts the database reads (SELECT) made while `run` answers. */
  async function readsDuring(run: () => Promise<{ status: number }>): Promise<{ status: number; reads: number }> {
    const select = vi.spyOn(getDb(), "select");
    try {
      const { status } = await run();
      return { status, reads: select.mock.calls.length };
    } finally {
      select.mockRestore();
    }
  }

  it("a flood of the public config stops at the IP limit without reading the channel", async () => {
    const ip = "198.51.100.30";
    for (let i = 0; i < WIDGET_LIMITS.config.ip.limit; i++) expect((await widgetApi.config(channelId, { ip })).status).toBe(200);
    expect(await readsDuring(() => widgetApi.config(channelId, { ip }))).toEqual({ status: 429, reads: 0 });
    // Not even for chats that do not exist.
    expect(await readsDuring(() => widgetApi.config(crypto.randomUUID(), { ip }))).toEqual({ status: 429, reads: 0 });
  });

  it("preflights too", async () => {
    const ip = "198.51.100.31";
    for (let i = 0; i < WIDGET_LIMITS.preflight.ip.limit; i++) expect((await widgetApi.preflight("messages", channelId, { ip })).status).toBe(204);
    const blocked = await readsDuring(() => widgetApi.preflight("messages", channelId, { ip }));
    expect(blocked).toEqual({ status: 429, reads: 0 });
  });

  it("a visitor over the message limit is stopped before anything is read, and the widget can still say why [WEB-08]", async () => {
    const ip = "198.51.100.32";
    const visitor = await newVisitor(channelId, { ip });
    const send = () => widgetApi.send(channelId, { clientMessageId: crypto.randomUUID(), text: "Hola" }, { token: visitor.token, ip });
    for (let i = 0; i < WIDGET_LIMITS.message.visitor.limit; i++) expect((await send()).status).toBe(201);
    const select = vi.spyOn(getDb(), "select");
    const blocked = await send();
    const reads = select.mock.calls.length;
    select.mockRestore();
    expect(blocked.status).toBe(429);
    expect(reads).toBe(0);
    expect(blocked.body.error).toBe("Demasiados mensajes, espera un momento.");
    // Its token was handed out on an allowed page: the answer carries that page's CORS headers.
    expect(blocked.headers.get("access-control-allow-origin")).toBe(SITE);
  });

  it("without a valid token, a request stopped by a limit gets nothing the page can read", async () => {
    const ip = "198.51.100.33";
    for (let i = 0; i < WIDGET_LIMITS.session.ip.limit; i++) await widgetApi.session(channelId, {}, { ip, origin: "https://otra-web.es" });
    const blocked = await widgetApi.session(channelId, {}, { ip, origin: "https://otra-web.es" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("the logo route too", async () => {
    const ip = "198.51.100.34";
    for (let i = 0; i < WIDGET_LIMITS.media.ip.limit; i++) await widgetApi.logo(channelId, { ip });
    expect(await readsDuring(() => widgetApi.logo(channelId, { ip }))).toEqual({ status: 429, reads: 0 });
  });
});

describe("daily caps of messages that make the AI answer [SEG-07] [WEB-08]", () => {
  let now = new Date("2026-09-27T09:00:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
  });

  afterEach(() => vi.useRealTimers());

  /** Sends `count` messages from `ip`, a new visitor every 15 (the per-visitor limit) and a minute apart when needed. */
  async function sendMany(chat: string, ip: string, count: number): Promise<number[]> {
    const statuses: number[] = [];
    let visitor = await newVisitor(chat, { ip });
    for (let i = 0; i < count; i++) {
      if (i > 0 && i % WIDGET_LIMITS.message.visitor.limit === 0) {
        now += 60_000;
        vi.setSystemTime(now);
        visitor = await newVisitor(chat, { ip });
      }
      statuses.push((await widgetApi.send(chat, { clientMessageId: crypto.randomUUID(), text: `Mensaje ${i}` }, { token: visitor.token, ip })).status);
    }
    return statuses;
  }

  it("per IP: over its daily cap the visitor reads the reason in Spanish and the message is not stored", async () => {
    const ip = "198.51.100.40";
    const statuses = await sendMany(channelId, ip, WIDGET_AI_DAILY_CAP.perIp);
    expect(statuses.every((status) => status === 201)).toBe(true);
    const stored = (await db.select().from(messages)).length;
    const visitor = await newVisitor(channelId, { ip });
    const blocked = await widgetApi.send(channelId, { clientMessageId: crypto.randomUUID(), text: "Uno más" }, { token: visitor.token, ip });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: DAILY_CAP_MESSAGE, code: "daily_limit" });
    expect(blocked.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(await db.select().from(messages)).toHaveLength(stored);
    // Another address still writes; the same one can again the next day.
    const other = await newVisitor(channelId, { ip: "198.51.100.41" });
    expect((await widgetApi.send(channelId, { clientMessageId: crypto.randomUUID(), text: "Hola" }, { token: other.token, ip: "198.51.100.41" })).status).toBe(201);
    now += WIDGET_AI_DAILY_CAP.windowMs;
    vi.setSystemTime(now);
    const tomorrow = await newVisitor(channelId, { ip });
    expect((await widgetApi.send(channelId, { clientMessageId: crypto.randomUUID(), text: "Hola" }, { token: tomorrow.token, ip })).status).toBe(201);
  });

  it("per chat: once the whole web used the chat's daily cap, nobody's message is stored", async () => {
    await getRateLimiter().hit(aiDailyCapKeys.channel(channelId), WIDGET_AI_DAILY_CAP.perChannel, WIDGET_AI_DAILY_CAP.windowMs);
    await db.update(rateLimits).set({ count: WIDGET_AI_DAILY_CAP.perChannel }).where(eq(rateLimits.key, aiDailyCapKeys.channel(channelId)));
    const visitor = await newVisitor(channelId, { ip: "198.51.100.42" });
    const blocked = await widgetApi.send(channelId, { clientMessageId: crypto.randomUUID(), text: "Hola" }, { token: visitor.token, ip: "198.51.100.42" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe(DAILY_CAP_MESSAGE);
    expect(await db.select().from(messages)).toEqual([]);
    // Another chat has its own cap.
    const other = (await createChannel({ type: "webchat", name: "Otra web", config: webchatConfig() })).id;
    const elsewhere = await newVisitor(other, { ip: "198.51.100.42" });
    expect((await widgetApi.send(other, { clientMessageId: crypto.randomUUID(), text: "Hola" }, { token: elsewhere.token, ip: "198.51.100.42" })).status).toBe(201);
  });

  it("a chat with its AI off (only people answer) has no daily cap", async () => {
    await db.update(channels).set({ aiEnabled: false }).where(eq(channels.id, channelId));
    await getRateLimiter().hit(aiDailyCapKeys.ip("198.51.100.43"), WIDGET_AI_DAILY_CAP.perIp, WIDGET_AI_DAILY_CAP.windowMs);
    await db.update(rateLimits).set({ count: WIDGET_AI_DAILY_CAP.perIp }).where(eq(rateLimits.key, aiDailyCapKeys.ip("198.51.100.43")));
    const visitor = await newVisitor(channelId, { ip: "198.51.100.43" });
    expect((await widgetApi.send(channelId, { clientMessageId: crypto.randomUUID(), text: "Hola" }, { token: visitor.token, ip: "198.51.100.43" })).status).toBe(201);
  });
});

describe("tokens", () => {
  it("a token issued for this channel works for its visitor", async () => {
    const token = issueVisitorToken({ channelId, visitorId: crypto.randomUUID() });
    expect((await widgetApi.poll(channelId, "0", { token })).status).toBe(200);
  });
});
