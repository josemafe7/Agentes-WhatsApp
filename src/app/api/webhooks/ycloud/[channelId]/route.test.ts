import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduled = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("next/server", () => ({ after: (callback: () => Promise<void>) => void scheduled.push(callback) }));

import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, jobs, messages, rateLimits, realtimeEvents, webhookEvents } from "@/db/schema";
import { YCLOUD_SIGNATURE_HEADER } from "@/lib/ycloud/signature";
import { encryptYCloudSecrets, ycloudPhoneNumberId } from "@/server/channels/ycloud/config";
import { YCLOUD_WEBHOOK_MAX_BYTES } from "@/server/channels/ycloud/webhook";
import { createAgentRow, createBusiness, createChannel } from "@/test/factories";
import { inboundText, inboundVoice, signedEvent, YC_TEST } from "@/test/fixtures/ycloud";
import { maxDuration, POST, runtime, WEBHOOK_REJECTED_LIMIT } from "./route";

let ipCounter = 0;
const nextIp = () => `203.0.113.${(ipCounter += 1)}`;
let channelId: string;

function request(body: unknown, options: { secret?: string; signature?: string | null; ip?: string; id?: string } = {}) {
  const signed = signedEvent(body, options.secret ?? YC_TEST.webhookSecret, new Date());
  const headers = new Headers({ "content-type": "application/json", "x-forwarded-for": options.ip ?? nextIp() });
  if (options.signature !== null) headers.set(YCLOUD_SIGNATURE_HEADER, options.signature ?? signed.signature);
  const id = options.id ?? channelId;
  return [new Request(`http://localhost:3000/api/webhooks/ycloud/${id}`, { method: "POST", headers, body: signed.raw }), { params: Promise.resolve({ channelId: id }) }] as const;
}

beforeEach(async () => {
  scheduled.length = 0;
  for (const table of [messages, conversations, contactIdentities, contacts, webhookEvents, jobs, realtimeEvents, rateLimits]) await db.delete(table);
  await db.delete(channels);
  await createBusiness();
  const agent = await createAgentRow();
  const channel = await createChannel({
    type: "whatsapp",
    connectionMode: "ycloud",
    name: "WhatsApp YCloud",
    status: "connected",
    activeAgentId: agent.id,
    phoneNumberId: ycloudPhoneNumberId(YC_TEST.phoneNumber),
    wabaId: YC_TEST.wabaId,
    config: { ycloudPhoneNumber: YC_TEST.phoneNumber, ycloudWebhookEndpointId: YC_TEST.endpointId },
    secretsEnc: encryptYCloudSecrets({ apiKey: YC_TEST.apiKey, webhookSecret: YC_TEST.webhookSecret }),
  });
  channelId = channel.id;
});

describe("/api/webhooks/ycloud/[channelId]", () => {
  it("runs on Node with an explicit maxDuration", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(60);
  });

  it("with the channel's signature it answers 200 at once, never calls the AI, and kicks the queue after [CAN-09] [CAN-10]", async () => {
    const response = await POST(...request(inboundText("Hola")));
    expect(response.status).toBe(200);
    expect(await db.select().from(messages)).toHaveLength(1);
    // The reply runs later, in the job queue: only a kick was scheduled.
    expect(scheduled).toHaveLength(1);
  });

  it("a voice note kicks the queue twice: its download now and the reply when it is due [YC-06]", async () => {
    expect((await POST(...request(inboundVoice()))).status).toBe(200);
    expect(scheduled).toHaveLength(2);
  });

  it("without the signature, with another secret or for another channel it answers 401 and stores nothing [YC-05]", async () => {
    expect((await POST(...request(inboundText(), { signature: null }))).status).toBe(401);
    expect((await POST(...request(inboundText(), { secret: "otro-secreto" }))).status).toBe(401);
    expect((await POST(...request(inboundText(), { id: crypto.randomUUID() }))).status).toBe(401);
    expect(await db.select().from(messages)).toHaveLength(0);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
    expect(scheduled).toHaveLength(0);
  });

  it("a signed body that is not an event is 400, and one bigger than any event, 413", async () => {
    expect((await POST(...request("no es json"))).status).toBe(400);
    expect((await POST(...request("x".repeat(YCLOUD_WEBHOOK_MAX_BYTES + 1)))).status).toBe(413);
  });

  it("an address that keeps sending refused requests is stopped for a while [SEG-07]", async () => {
    const ip = nextIp();
    for (let attempt = 0; attempt < WEBHOOK_REJECTED_LIMIT; attempt++) {
      expect((await POST(...request(inboundText(), { secret: "otro-secreto", ip }))).status).toBe(401);
    }
    // Even a right request waits now; another address is not affected.
    expect((await POST(...request(inboundText(), { ip }))).status).toBe(429);
    expect((await POST(...request(inboundText()))).status).toBe(200);
  });
});
