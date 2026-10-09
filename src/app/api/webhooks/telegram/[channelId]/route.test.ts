import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduled = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("next/server", () => ({ after: (callback: () => Promise<void>) => void scheduled.push(callback) }));

import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, jobs, messages, rateLimits, realtimeEvents, webhookEvents } from "@/db/schema";
import { encryptTelegramSecrets } from "@/server/channels/telegram/config";
import { TELEGRAM_SECRET_HEADER, TELEGRAM_WEBHOOK_MAX_BYTES } from "@/server/channels/telegram/webhook";
import { createAgentRow, createBusiness, createChannel } from "@/test/factories";
import { textUpdate, TG_TEST, voiceUpdate } from "@/test/fixtures/telegram";
import { maxDuration, POST, runtime, WEBHOOK_REJECTED_LIMIT } from "./route";

let ipCounter = 0;
const nextIp = () => `203.0.113.${(ipCounter += 1)}`;
let channelId: string;

function request(body: unknown, options: { secret?: string | null; ip?: string; id?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json", "x-forwarded-for": options.ip ?? nextIp() });
  if (options.secret !== null) headers.set(TELEGRAM_SECRET_HEADER, options.secret ?? TG_TEST.webhookSecret);
  const id = options.id ?? channelId;
  return [
    new Request(`http://localhost:3000/api/webhooks/telegram/${id}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ channelId: id }) },
  ] as const;
}

beforeEach(async () => {
  scheduled.length = 0;
  for (const table of [messages, conversations, contactIdentities, contacts, webhookEvents, jobs, realtimeEvents, rateLimits]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
  const agent = await createAgentRow();
  const channel = await createChannel({
    type: "telegram",
    name: "Telegram",
    status: "connected",
    activeAgentId: agent.id,
    config: { botId: TG_TEST.botId, botUsername: TG_TEST.botUsername, receiveMode: "webhook" },
    secretsEnc: encryptTelegramSecrets({ botToken: TG_TEST.botToken, webhookSecret: TG_TEST.webhookSecret }),
  });
  channelId = channel.id;
});

describe("/api/webhooks/telegram/[channelId]", () => {
  it("runs on Node with an explicit maxDuration", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(60);
  });

  it("with the channel's secret it answers 200 at once, never calls the AI, and kicks the queue after [CAN-09] [CAN-10]", async () => {
    const response = await POST(...request(textUpdate("Hola")));
    expect(response.status).toBe(200);
    expect(await db.select().from(messages)).toHaveLength(1);
    // The reply runs later, in the job queue: only a kick was scheduled.
    expect(scheduled).toHaveLength(1);
  });

  it("a voice note kicks the queue twice: its download now and the reply when it is due [TG-11]", async () => {
    expect((await POST(...request(voiceUpdate()))).status).toBe(200);
    expect(scheduled).toHaveLength(2);
  });

  it("without the secret or with a wrong one it answers 401 and stores nothing [TG-02]", async () => {
    expect((await POST(...request(textUpdate(), { secret: null }))).status).toBe(401);
    expect((await POST(...request(textUpdate(), { secret: "otro" }))).status).toBe(401);
    expect((await POST(...request(textUpdate(), { id: crypto.randomUUID() }))).status).toBe(401);
    expect(await db.select().from(messages)).toHaveLength(0);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
    expect(scheduled).toHaveLength(0);
  });

  it("a body that is not an update is 400, and one bigger than any update, 413", async () => {
    expect((await POST(...request("no es json"))).status).toBe(400);
    expect((await POST(...request("x".repeat(TELEGRAM_WEBHOOK_MAX_BYTES + 1)))).status).toBe(413);
  });

  it("an address that keeps sending refused requests is stopped for a while [SEG-07]", async () => {
    const ip = nextIp();
    for (let attempt = 0; attempt < WEBHOOK_REJECTED_LIMIT; attempt++) {
      expect((await POST(...request(textUpdate(), { secret: "otro", ip }))).status).toBe(401);
    }
    // Even a right request waits now; another address is not affected.
    expect((await POST(...request(textUpdate(), { ip }))).status).toBe(429);
    expect((await POST(...request(textUpdate()))).status).toBe(200);
  });
});
