// Who may use the web chat API: allowed domains (CORS), the visitor's own conversation only, disabled channels and
// rate limits ([WEB-08], [WEB-10], [WEB-11], [WEB-13], [SEG-04], [SEG-07]).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { db } from "@/db";
import { channels, consents, contactIdentities, contacts, conversations, jobs, messages, rateLimits, realtimeEvents } from "@/db/schema";
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
    // The app itself is always allowed, also when the list has domains.
    expect((await widgetApi.config(channelId, { origin: APP_ORIGIN })).status).toBe(200);
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

describe("tokens", () => {
  it("a token issued for this channel works for its visitor", async () => {
    const token = issueVisitorToken({ channelId, visitorId: crypto.randomUUID() });
    expect((await widgetApi.poll(channelId, "0", { token })).status).toBe(200);
  });
});
