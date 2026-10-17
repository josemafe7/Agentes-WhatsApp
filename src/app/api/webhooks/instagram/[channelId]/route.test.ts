import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduled = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("next/server", () => ({ after: (callback: () => Promise<void>) => void scheduled.push(callback) }));

import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, jobs, messages, rateLimits, realtimeEvents, webhookEvents } from "@/db/schema";
import { META_SIGNATURE_HEADER } from "@/lib/meta/signature";
import { encryptInstagramSecrets, readInstagramConfig } from "@/server/channels/instagram/config";
import { INSTAGRAM_WEBHOOK_MAX_BYTES } from "@/server/channels/instagram/webhook";
import { REPLY_JOB } from "@/server/engine/schedule";
import { createAgentRow, createBusiness, createChannel } from "@/test/factories";
import { IG_TEST, instagramWebhook, signedBody, textMessage } from "@/test/fixtures/instagram";
import { GET, maxDuration, POST, runtime, WEBHOOK_REJECTED_LIMIT } from "./route";

let ipCounter = 0;
const nextIp = () => `203.0.113.${(ipCounter += 1)}`;
let channelId: string;

type PostOptions = { secret?: string; signature?: string | null; ip?: string; id?: string };

function post(body: unknown, options: PostOptions = {}) {
  const signed = signedBody(body, options.secret);
  const headers = new Headers({ "content-type": "application/json", "x-forwarded-for": options.ip ?? nextIp() });
  const signature = options.signature === undefined ? signed.signature : options.signature;
  if (signature !== null) headers.set(META_SIGNATURE_HEADER, signature);
  const id = options.id ?? channelId;
  return POST(new Request(`http://localhost:3000/api/webhooks/instagram/${id}`, { method: "POST", headers, body: signed.text }), { params: Promise.resolve({ channelId: id }) });
}

function verify(params: Record<string, string>, options: { id?: string; ip?: string } = {}) {
  const id = options.id ?? channelId;
  const query = new URLSearchParams(params);
  return GET(new Request(`http://localhost:3000/api/webhooks/instagram/${id}?${query.toString()}`, { headers: { "x-forwarded-for": options.ip ?? nextIp() } }), { params: Promise.resolve({ channelId: id }) });
}

const verification = (token: string = IG_TEST.verifyToken) => ({ "hub.mode": "subscribe", "hub.challenge": "1158201444", "hub.verify_token": token });
const config = async () => readInstagramConfig((await db.select().from(channels).where(eq(channels.id, channelId)))[0].config);

async function instagramChannel(overrides: Partial<typeof channels.$inferInsert> = {}) {
  const agent = await createAgentRow();
  return createChannel({
    type: "instagram",
    name: "Instagram",
    status: "connected",
    activeAgentId: agent.id,
    config: { accountId: IG_TEST.accountId, username: IG_TEST.username },
    secretsEnc: encryptInstagramSecrets({ accessToken: IG_TEST.accessToken, appSecret: IG_TEST.appSecret, metaAppSecret: IG_TEST.metaAppSecret, verifyToken: IG_TEST.verifyToken }),
    ...overrides,
  });
}

beforeEach(async () => {
  scheduled.length = 0;
  for (const table of [messages, conversations, contactIdentities, contacts, webhookEvents, jobs, realtimeEvents, rateLimits]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
  channelId = (await instagramChannel()).id;
});

describe("/api/webhooks/instagram/[channelId]", () => {
  it("runs on Node with an explicit maxDuration", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(60);
  });

  it("GET: Meta's check with the channel's verify token gets the challenge back as plain text, and the channel remembers it [IG-02]", async () => {
    const response = await verify(verification());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await response.text()).toBe("1158201444");
    expect((await config()).webhookVerifiedAt).not.toBeNull();
  });

  it("GET: another token, another mode, another channel or a demo one is refused and nothing is stored [IG-02]", async () => {
    const demo = await instagramChannel({ isDemo: true });
    const webchat = await createChannel();
    expect((await verify(verification("otro-token-de-verificacion"))).status).toBe(403);
    expect((await verify({ ...verification(), "hub.mode": "unsubscribe" })).status).toBe(403);
    expect((await verify({ "hub.mode": "subscribe", "hub.challenge": "1" })).status).toBe(403);
    for (const id of [demo.id, webchat.id, crypto.randomUUID(), "no-es-un-id"]) expect((await verify(verification(), { id })).status).toBe(403);
    expect((await config()).webhookVerifiedAt ?? null).toBeNull();
  });

  it("POST with a valid signature answers 200 at once, stores the message and never calls the AI [CAN-09] [CAN-10]", async () => {
    const response = await post(instagramWebhook([textMessage("Hola")]));
    expect(response.status).toBe(200);
    expect(await db.select().from(messages)).toHaveLength(1);
    const [raw] = await db.select().from(webhookEvents);
    expect(raw).toMatchObject({ source: "instagram", channelId, signatureValid: true });
    // The reply runs later, in the job queue: only a kick was scheduled (and the profile of someone new).
    expect(scheduled.length).toBeGreaterThan(0);
  });

  it("POST without a signature, with a wrong one or to another path is refused with 401 and nothing stored [IG-02]", async () => {
    const body = instagramWebhook([textMessage("Hola")]);
    expect((await post(body, { signature: null })).status).toBe(401);
    expect((await post(body, { secret: "otra_clave" })).status).toBe(401);
    expect((await post(body, { signature: "sha256=00" })).status).toBe(401);
    expect((await post(body, { id: crypto.randomUUID() })).status).toBe(401);
    expect(await db.select().from(messages)).toHaveLength(0);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
    expect(await db.select().from(contacts)).toHaveLength(0);
    expect(scheduled).toHaveLength(0);
  });

  it("either secret signs: the Instagram app secret or the Meta app secret, and the one that worked is remembered [IG-02]", async () => {
    expect((await post(instagramWebhook([textMessage("Uno")]), { secret: IG_TEST.metaAppSecret })).status).toBe(200);
    expect((await config()).signedWith).toBe("meta");
    expect((await post(instagramWebhook([textMessage("Dos")]), { secret: IG_TEST.appSecret })).status).toBe(200);
    expect((await config()).signedWith).toBe("instagram");
    expect(await db.select().from(messages)).toHaveLength(2);
  });

  it("entries of another account are acknowledged and ignored: nothing stored [IG-02]", async () => {
    const response = await post(instagramWebhook([textMessage("Hola")], IG_TEST.otherAccount.accountId));
    expect(response.status).toBe(200);
    expect(await db.select().from(messages)).toHaveLength(0);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
  });

  it("the same message twice is stored once and answered once [CAN-11]", async () => {
    const body = instagramWebhook([textMessage("Hola", { mid: IG_TEST.mid })]);
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    expect(await db.select().from(messages)).toHaveLength(1);
    expect(await db.select().from(jobs).where(eq(jobs.type, REPLY_JOB))).toHaveLength(1);
  });

  it("a signed body that is not JSON is 400, and one bigger than allowed, 413", async () => {
    expect((await post("no es json")).status).toBe(400);
    expect((await post("x".repeat(INSTAGRAM_WEBHOOK_MAX_BYTES + 1))).status).toBe(413);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
  });

  it("an address that keeps sending refused requests is stopped for a while [SEG-07]", async () => {
    const ip = nextIp();
    const body = instagramWebhook([textMessage("Hola")]);
    for (let attempt = 0; attempt < WEBHOOK_REJECTED_LIMIT; attempt++) expect((await post(body, { secret: "otra_clave", ip })).status).toBe(401);
    // Even a right request waits now, and so does a verification; another address is not affected.
    expect((await post(body, { ip })).status).toBe(429);
    expect((await verify(verification(), { ip })).status).toBe(429);
    expect((await post(body)).status).toBe(200);
  });
});
