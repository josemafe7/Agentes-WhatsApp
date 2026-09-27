import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduled = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("next/server", () => ({ after: (callback: () => Promise<void>) => void scheduled.push(callback) }));

import { readWhatsAppVerifyToken } from "@/data/whatsapp";
import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, jobs, messages, rateLimits, realtimeEvents, webhookEvents } from "@/db/schema";
import { encryptWhatsAppSecrets } from "@/server/channels/whatsapp/config";
import { WEBHOOK_MAX_BYTES } from "@/server/channels/whatsapp/webhook";
import { createAgentRow, createBusiness, createChannel } from "@/test/factories";
import { fixtureText, signedWebhookRequest, WA_TEST } from "@/test/fixtures/whatsapp";
import { GET, maxDuration, POST, runtime, WEBHOOK_RATE_LIMIT, WEBHOOK_REJECTED_LIMIT } from "./route";

let ipCounter = 0;
const nextIp = () => `203.0.113.${(ipCounter += 1)}`;

beforeEach(async () => {
  scheduled.length = 0;
  for (const table of [messages, conversations, contactIdentities, contacts, webhookEvents, jobs, realtimeEvents, rateLimits]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
  const agent = await createAgentRow();
  await createChannel({
    type: "whatsapp",
    name: "WhatsApp",
    status: "connected",
    phoneNumberId: WA_TEST.phoneNumberId,
    wabaId: WA_TEST.wabaId,
    metaAppId: WA_TEST.appId,
    activeAgentId: agent.id,
    secretsEnc: encryptWhatsAppSecrets({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: null }),
  });
});

describe("/api/webhooks/whatsapp", () => {
  it("runs on Node with an explicit maxDuration", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(60);
  });

  it("GET answers Meta's challenge as plain text with the right verify token, 403 otherwise [WA-31]", async () => {
    const token = await readWhatsAppVerifyToken();
    const url = (verifyToken: string) =>
      `http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=1158201444&hub.verify_token=${encodeURIComponent(verifyToken)}`;
    const ok = await GET(new Request(url(token), { headers: { "x-forwarded-for": nextIp() } }));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("1158201444");
    expect(ok.headers.get("content-type")).toContain("text/plain");
    expect((await GET(new Request(url("otro"), { headers: { "x-forwarded-for": nextIp() } }))).status).toBe(403);
  });

  it("POST with a valid signature answers 200 at once, never calls the AI, and kicks the queue after [CAN-09] [CAN-10]", async () => {
    const response = await POST(signedWebhookRequest(fixtureText("text"), { ip: nextIp() }));
    expect(response.status).toBe(200);
    expect(await db.select().from(messages)).toHaveLength(1);
    // The reply runs later, in the job queue: only a kick was scheduled.
    expect(scheduled).toHaveLength(1);
  });

  it("answers within Meta's target: median ≤ 250 ms and none above 1 s [CAN-09]", async () => {
    const durations: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const text = fixtureText("text").replace("wamid.TEST_IN_TEXT_0001", `wamid.TEST_IN_TEXT_LAT_${index}`);
      const started = performance.now();
      const response = await POST(signedWebhookRequest(text, { ip: nextIp() }));
      durations.push(performance.now() - started);
      expect(response.status).toBe(200);
    }
    const sorted = [...durations].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThanOrEqual(250);
    expect(Math.max(...durations)).toBeLessThan(1_000);
  });

  it("a voice note also starts its download right after answering [WA-41]", async () => {
    await POST(signedWebhookRequest(fixtureText("voice"), { ip: nextIp() }));
    expect(scheduled).toHaveLength(2);
  });

  it("a wrong or missing signature is 401 and stores nothing [WA-32]", async () => {
    expect((await POST(signedWebhookRequest(fixtureText("text"), { appSecret: WA_TEST.otherAppSecret, ip: nextIp() }))).status).toBe(401);
    expect((await POST(signedWebhookRequest(fixtureText("text"), { signature: null, ip: nextIp() }))).status).toBe(401);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
    expect(scheduled).toHaveLength(0);
  });

  it("accepts bodies of up to 3 MB and refuses bigger ones without reading them all [WA-35]", async () => {
    const text = fixtureText("text");
    const padded = text.replace('"object"', `"padding": "${"x".repeat(3 * 1024 * 1024 - text.length - 100)}", "object"`);
    expect(new TextEncoder().encode(padded).byteLength).toBeLessThanOrEqual(WEBHOOK_MAX_BYTES);
    expect((await POST(signedWebhookRequest(padded, { ip: nextIp() }))).status).toBe(200);
    const huge = `{"object":"whatsapp_business_account","entry":[],"x":"${"x".repeat(WEBHOOK_MAX_BYTES)}"}`;
    expect((await POST(signedWebhookRequest(huge, { ip: nextIp() }))).status).toBe(413);
  });

  it("a body that is not JSON is refused with 401 and stores nothing, signed or not: the signature is checked first [WA-32]", async () => {
    expect((await POST(signedWebhookRequest("not json", { ip: nextIp() }))).status).toBe(401);
    expect((await POST(signedWebhookRequest("not json", { appSecret: WA_TEST.otherAppSecret, ip: nextIp() }))).status).toBe(401);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
    expect(scheduled).toHaveLength(0);
  });

  it("a signed body that is not a WhatsApp webhook is refused with 400 and stores nothing", async () => {
    expect((await POST(signedWebhookRequest(JSON.stringify({ hola: "mundo" }), { ip: nextIp() }))).status).toBe(400);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
  });

  it("requests that end refused (400, 401, 413) have a lower limit of their own per IP; accepted ones do not count [SEG-07]", async () => {
    const ip = nextIp();
    const key = `wa-webhook:rejected:ip:${ip}`;
    expect((await POST(signedWebhookRequest(fixtureText("text"), { appSecret: WA_TEST.otherAppSecret, ip }))).status).toBe(401);
    expect((await POST(signedWebhookRequest("not json", { ip }))).status).toBe(401);
    expect((await POST(signedWebhookRequest(fixtureText("text"), { ip }))).status).toBe(200);
    expect((await db.select().from(rateLimits).where(eq(rateLimits.key, key)))[0].count).toBe(2);

    await db.update(rateLimits).set({ count: WEBHOOK_REJECTED_LIMIT }).where(eq(rateLimits.key, key));
    // Over it, even a valid body waits: nothing is parsed, checked or stored.
    const text = fixtureText("text").replace("wamid.TEST_IN_TEXT_0001", "wamid.TEST_IN_TEXT_LIMITED");
    expect((await POST(signedWebhookRequest(text, { ip }))).status).toBe(429);
    expect(await db.select().from(messages).where(eq(messages.externalId, "wamid.TEST_IN_TEXT_LIMITED"))).toHaveLength(0);
    // Meta's other addresses are not affected.
    expect((await POST(signedWebhookRequest(text, { ip: nextIp() }))).status).toBe(200);
    expect(WEBHOOK_REJECTED_LIMIT).toBeLessThan(WEBHOOK_RATE_LIMIT);
  });

  it("is rate limited per IP, wide enough for Meta's bursts [SEG-07]", async () => {
    const ip = nextIp();
    await db.insert(rateLimits).values({ key: `wa-webhook:ip:${ip}`, count: WEBHOOK_RATE_LIMIT, windowStart: new Date() });
    expect((await POST(signedWebhookRequest(fixtureText("text"), { ip }))).status).toBe(429);
    expect(await db.select().from(messages)).toHaveLength(0);
    const [limit] = await db.select().from(rateLimits).where(eq(rateLimits.key, `wa-webhook:ip:${ip}`));
    expect(limit.count).toBe(WEBHOOK_RATE_LIMIT + 1);
  });
});
