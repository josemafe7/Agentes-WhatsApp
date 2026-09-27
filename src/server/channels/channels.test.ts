import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appKv, channels, jobs, messages } from "@/db/schema";
import { getJobQueue } from "@/server/adapters/job-queue";
import "@/server/jobs/handlers";
import { getJobRegistration } from "@/server/jobs/registry";
import { releaseLease, tryAcquireLease } from "@/server/kv";
import { createChannel, createContactWithIdentity, createConversation, createMessage } from "@/test/factories";
import { DEFAULT_CAPABILITIES } from "./capabilities";
import { buildSimulatedEvent, demoAdapter, DEMO_STATUS_JOB, type DemoStatusJobPayload } from "./demo-adapter";
import { ChannelAdapterMissingError, getChannelAdapter, getSendAdapter } from "./registry";
import { encryptChannelSecrets, readChannelSecrets } from "./secrets";
import type { ChannelRecord } from "./types";
import { webchatAdapter, widgetMessageToEvent } from "./webchat-adapter";

beforeEach(async () => {
  await db.update(channels).set({ activeAgentId: null });
});

describe("adapters by channel type [CAN-02] [CAN-14]", () => {
  it("demo WhatsApp and email channels use the DemoAdapter; the web chat its own [ARR-11]", async () => {
    expect(getChannelAdapter({ type: "whatsapp", isDemo: true })).toBe(demoAdapter);
    expect(getChannelAdapter({ type: "email_gmail", isDemo: true })).toBe(demoAdapter);
    expect(getChannelAdapter({ type: "webchat", isDemo: true })).toBe(webchatAdapter);
    expect(getChannelAdapter({ type: "webchat", isDemo: false })).toBe(webchatAdapter);
  });

  it("a type whose adapter does not exist yet fails with a clear error", () => {
    expect(() => getChannelAdapter({ type: "telegram", isDemo: false })).toThrow(ChannelAdapterMissingError);
  });

  it("replies to simulated messages go through the DemoAdapter even on a real channel [AJU-13]", () => {
    expect(getSendAdapter({ type: "whatsapp", isDemo: false }, true)).toBe(demoAdapter);
    expect(getSendAdapter({ type: "webchat", isDemo: false }, true)).toBe(webchatAdapter);
  });

  it("capabilities: templates and 24 h window only in WhatsApp, drafts and HTML in email [CAN-14]", async () => {
    expect(DEFAULT_CAPABILITIES.whatsapp).toMatchObject({ templates: true, window24h: true, drafts: false });
    expect(DEFAULT_CAPABILITIES.email_outlook).toMatchObject({ templates: false, drafts: true, html: true });
    const web = await createChannel({ config: { voiceEnabled: true } });
    expect(webchatAdapter.capabilities(web)).toMatchObject({ audio: true, images: false, templates: false, window24h: false });
    const demo = await createChannel({ type: "email_imap", isDemo: true });
    expect(demoAdapter.capabilities(demo)).toEqual(DEFAULT_CAPABILITIES.email_imap);
  });
});

describe("normalized events", () => {
  it("the simulator builds a simulated inbound message [AJU-12] [AJU-13]", () => {
    const event = buildSimulatedEvent({ from: { id: "ES.bsuid-sim", name: "Ana" }, text: "Hola" }, new Date("2026-09-30T09:00:00Z"));
    expect(event).toMatchObject({ kind: "inbound_message", simulated: true, contentType: "text", text: "Hola", sender: { externalIds: ["ES.bsuid-sim"], displayName: "Ana" } });
    expect(() => buildSimulatedEvent({ from: { id: "x" }, contentType: "text", text: " " })).toThrow();
    expect(() => buildSimulatedEvent({ from: { id: "x" }, contentType: "image" })).toThrow();
  });

  it("the widget's message: the visitor id is the identity and the client id dedupes retries [WEB-04] [CAN-11]", () => {
    const visitorId = crypto.randomUUID();
    const clientMessageId = crypto.randomUUID();
    const event = widgetMessageToEvent({ visitorId, clientMessageId, text: "Hola" });
    expect(event).toMatchObject({ externalId: clientMessageId, sender: { externalIds: [visitorId] }, text: "Hola" });
    expect(() => widgetMessageToEvent({ visitorId: "no-uuid", clientMessageId, text: "Hola" })).toThrow();
    expect(() => widgetMessageToEvent({ visitorId, clientMessageId, text: "x".repeat(2_001) })).toThrow();
  });

  it("the web chat takes no webhooks: the visitor and their files only come from the signed token and receipt [WEB-11]", async () => {
    const channel = await createChannel({ type: "webchat", name: "Web" });
    const body = { visitorId: crypto.randomUUID(), clientMessageId: crypto.randomUUID(), contentType: "image", media: { fileKey: "media/otra.png", mimeType: "image/png", size: 1 } };
    await expect(webchatAdapter.handleWebhook(channel, { body })).rejects.toThrow();
  });
});

describe("channel secrets [CAN-17] [SEG-01]", () => {
  it("are stored encrypted and read back only with the right shape", () => {
    const stored = encryptChannelSecrets({ accessToken: "EAAG-token", appSecret: "shh" });
    expect(stored).not.toContain("EAAG-token");
    const schema = z.object({ accessToken: z.string(), appSecret: z.string() });
    expect(readChannelSecrets({ secretsEnc: stored }, schema)).toEqual({ accessToken: "EAAG-token", appSecret: "shh" });
    expect(readChannelSecrets({ secretsEnc: stored }, z.object({ pin: z.string() }))).toBeNull();
    expect(readChannelSecrets({ secretsEnc: null }, schema)).toBeNull();
    expect(readChannelSecrets({ secretsEnc: "v1:roto" }, schema)).toBeNull();
  });
});

describe("conversation lease [MOT-02]", () => {
  it("only one holder at a time; it can be renewed, released, and taken over once expired", async () => {
    await db.delete(appKv);
    const now = new Date("2026-09-30T09:00:00Z");
    expect(await tryAcquireLease("reply.lease:x", "a", 1_000, { now })).toBe(true);
    expect(await tryAcquireLease("reply.lease:x", "b", 1_000, { now })).toBe(false);
    expect(await tryAcquireLease("reply.lease:x", "a", 1_000, { now })).toBe(true);
    expect(await tryAcquireLease("reply.lease:x", "b", 1_000, { now: new Date(now.getTime() + 1_000) })).toBe(true);
    await releaseLease("reply.lease:x", "a");
    expect(await tryAcquireLease("reply.lease:x", "c", 1_000, { now: new Date(now.getTime() + 1_001) })).toBe(false);
    await releaseLease("reply.lease:x", "b");
    expect(await tryAcquireLease("reply.lease:x", "c", 1_000, { now })).toBe(true);
  });
});

describe("demo WhatsApp statuses [ARR-11] [WA-38]", () => {
  it("sending schedules «entregado» and «leído», and their job moves the message forward", async () => {
    const channel: ChannelRecord = await createChannel({ type: "whatsapp", isDemo: true });
    const { contact } = await createContactWithIdentity("whatsapp");
    const conversation = await createConversation(channel.id, contact.id);
    const message = await createMessage(conversation, { direction: "outbound", senderType: "ai", status: "queued", externalId: null });
    await db.delete(jobs);
    const sent = await demoAdapter.send(channel, {
      messageId: message.id,
      conversationId: conversation.id,
      recipient: { externalIds: [], phone: null, email: null, name: null },
      threadId: null,
      contentType: "text",
      text: "Hola",
    });
    expect(sent).toMatchObject({ externalId: `demo-${message.id}`, status: "sent" });
    await db.update(messages).set({ externalId: sent.externalId, status: "sent" }).where(eq(messages.id, message.id));
    const scheduled = await db.select().from(jobs).where(eq(jobs.type, DEMO_STATUS_JOB));
    expect(scheduled).toHaveLength(2);

    const registration = getJobRegistration(DEMO_STATUS_JOB);
    for (const job of scheduled.sort((a, b) => a.runAt.getTime() - b.runAt.getTime())) {
      const payload = job.payload as DemoStatusJobPayload;
      await registration?.handler(payload, { job, workerId: "w", queue: getJobQueue(), remainingMs: () => 10_000, rescheduleAt: () => {} });
    }
    const [row] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(row.status).toBe("read");
  });

  it("an email demo channel has no delivery receipts to simulate", async () => {
    const channel: ChannelRecord = await createChannel({ type: "email_gmail", isDemo: true });
    await db.delete(jobs);
    await demoAdapter.send(channel, {
      messageId: crypto.randomUUID(),
      conversationId: crypto.randomUUID(),
      recipient: { externalIds: [], phone: null, email: null, name: null },
      threadId: null,
      contentType: "text",
      text: "Hola",
    });
    expect(await db.select().from(jobs)).toHaveLength(0);
  });
});
