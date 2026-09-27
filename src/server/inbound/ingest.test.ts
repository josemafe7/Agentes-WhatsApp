import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { aiRuns, channels, contactIdentities, contacts, conversations, jobs, messages, realtimeEvents, webhookEvents } from "@/db/schema";
import { LibsqlJobQueue } from "@/server/adapters/job-queue";
import type { ChannelRecord, InboundMessageEvent } from "@/server/channels/types";
import { REPLY_DEBOUNCE_ENV, REPLY_DEBOUNCE_MAX_MS, REPLY_DEBOUNCE_MIN_MS, REPLY_JOB, REPLY_MAX_WAIT_MS, replyDedupeKey } from "@/server/engine/schedule";
import { createBusiness, createChannel } from "@/test/factories";
import { ingestEvents, KICK_MIN_TICK_MS, kickTick, KICK_SAFETY_MARGIN_MS } from "./ingest";

const T0 = new Date("2026-09-26T10:00:00Z");

function inbound(overrides: Partial<InboundMessageEvent> = {}): InboundMessageEvent {
  return {
    kind: "inbound_message",
    externalId: crypto.randomUUID(),
    sender: { externalIds: ["visitor-1"] },
    contentType: "text",
    text: "Hola, ¿tenéis hueco mañana?",
    sentAt: T0,
    ...overrides,
  };
}

let channel: ChannelRecord;

async function clear() {
  await db.delete(jobs);
  await db.delete(realtimeEvents);
  await db.delete(webhookEvents);
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(contactIdentities);
  await db.delete(contacts);
  await db.delete(channels);
}

const pendingReplyJobs = () => db.select().from(jobs).where(and(eq(jobs.type, REPLY_JOB), eq(jobs.status, "pending")));

beforeEach(async () => {
  await clear();
  await createBusiness();
  channel = await createChannel({ type: "webchat", name: "Web" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("inbound pipeline [CAN-09] [CAN-10]", () => {
  it("stores the raw webhook, the contact, the message and the conversation, tells the screens and schedules the reply", async () => {
    const result = await ingestEvents(channel, [inbound({ sender: { externalIds: ["visitor-1"], displayName: "Ana" } })], {
      raw: { source: "test", payload: { hello: "world" } },
      now: T0,
    });
    const [raw] = await db.select().from(webhookEvents);
    expect(raw).toMatchObject({ id: result.webhookEventId, source: "test", channelId: channel.id, signatureValid: true, payload: { hello: "world" } });
    expect(raw.processedAt).not.toBeNull();
    expect(raw.error).toBeNull();

    const [ingested] = result.messages;
    expect(ingested).toMatchObject({ duplicate: false, reaction: false });
    const [message] = await db.select().from(messages).where(eq(messages.id, ingested.messageId ?? ""));
    expect(message).toMatchObject({ direction: "inbound", senderType: "contact", status: "received", text: "Hola, ¿tenéis hueco mañana?", channelId: channel.id });
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, ingested.conversationId ?? ""));
    expect(conversation).toMatchObject({ status: "open", aiMode: "ai", unreadCount: 1, contactId: ingested.contactId });
    expect(conversation.lastInboundAt).toEqual(T0);
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, ingested.contactId ?? ""));
    expect(contact.name).toBe("Ana");
    // The channel shows the time of its last message ([CAN-01]).
    const [row] = await db.select({ lastInboundAt: channels.lastInboundAt }).from(channels).where(eq(channels.id, channel.id));
    expect(row.lastInboundAt).toEqual(T0);

    const events = await db.select().from(realtimeEvents);
    expect(events.map((event) => [event.topic, (event.payload as { type: string }).type])).toEqual(
      expect.arrayContaining([
        [`channel:${channel.id}`, "message.created"],
        [`channel:${channel.id}`, "conversation.updated"],
        [`widget:${conversation.id}`, "message.created"],
      ]),
    );
    const [job] = await pendingReplyJobs();
    expect(job).toMatchObject({ dedupeKey: replyDedupeKey(conversation.id), payload: { conversationId: conversation.id, lastInboundMessageId: message.id } });
    expect(result.replyRunAt).toEqual(job.runAt);
  });

  it("never calls the AI while receiving: no OpenRouter call and no AI run [CAN-10]", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await ingestEvents(channel, [inbound()], { now: T0 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await db.select().from(aiRuns)).toHaveLength(0);
    fetchSpy.mockRestore();
  });

  it("the same message twice is stored once and scheduled once [CAN-11]", async () => {
    const event = inbound({ externalId: "wamid.repetido" });
    const first = await ingestEvents(channel, [event], { now: T0 });
    const second = await ingestEvents(channel, [event], { now: new Date(T0.getTime() + 1_000) });
    expect(second.messages[0]).toMatchObject({ duplicate: true, messageId: first.messages[0].messageId });
    expect(second.replyRunAt).toBeNull();
    expect(await db.select().from(messages)).toHaveLength(1);
    expect(await pendingReplyJobs()).toHaveLength(1);
    const [conversation] = await db.select().from(conversations);
    expect(conversation.unreadCount).toBe(1);
  });

  it("the same external id in another channel is another message", async () => {
    const other = await createChannel({ type: "webchat", name: "Otra web" });
    await ingestEvents(channel, [inbound({ externalId: "mismo-id" })], { now: T0 });
    await ingestEvents(other, [inbound({ externalId: "mismo-id" })], { now: T0 });
    expect(await db.select().from(messages)).toHaveLength(2);
  });

  it("one conversation per channel and contact; a resolved one reopens with the AI [CAN-12] [TRA-08]", async () => {
    const first = await ingestEvents(channel, [inbound()], { now: T0 });
    const conversationId = first.messages[0].conversationId ?? "";
    await db
      .update(conversations)
      .set({ status: "resolved", aiMode: "human", aiPausedUntil: new Date(T0.getTime() + 3_600_000), pauseReason: "x" })
      .where(eq(conversations.id, conversationId));
    const second = await ingestEvents(channel, [inbound({ text: "Otra cosa" })], { now: new Date(T0.getTime() + 60_000) });
    expect(second.messages[0].conversationId).toBe(conversationId);
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    expect(conversation).toMatchObject({ status: "open", aiMode: "ai", aiPausedUntil: null, pauseReason: null, unreadCount: 2 });
    expect(await db.select().from(conversations)).toHaveLength(1);
  });

  it("in email there is one conversation per thread [CAN-12]", async () => {
    const mailbox = await createChannel({ type: "email_imap", name: "Correo" });
    const sender = { externalIds: ["Cliente@Example.com"], email: "cliente@example.com" };
    await ingestEvents(mailbox, [inbound({ sender, threadId: "hilo-1" })], { now: T0 });
    await ingestEvents(mailbox, [inbound({ sender, threadId: "hilo-1" })], { now: T0 });
    await ingestEvents(mailbox, [inbound({ sender, threadId: "hilo-2" })], { now: T0 });
    const rows = await db.select().from(conversations).where(eq(conversations.channelId, mailbox.id));
    expect(rows.map((row) => row.externalThreadId).sort()).toEqual(["hilo-1", "hilo-2"]);
    // The email identity is stored in lower case: one contact for both threads.
    expect(new Set(rows.map((row) => row.contactId)).size).toBe(1);
    const [identity] = await db.select().from(contactIdentities).where(eq(contactIdentities.channelType, "email_imap"));
    expect(identity.externalId).toBe("cliente@example.com");
  });
});

describe("contact and identity [CAN-13] [CTO-03] [WA-39] [WA-40]", () => {
  const whatsapp = () => createChannel({ type: "whatsapp", name: "WhatsApp", isDemo: true });

  it("an unknown sender gets a new contact with its identity; a known identity goes to the same contact", async () => {
    const wa = await whatsapp();
    const first = await ingestEvents(wa, [inbound({ sender: { externalIds: ["ES.bsuid-1"], phone: "34600111222", displayName: "Luis" } })], { now: T0 });
    const second = await ingestEvents(wa, [inbound({ sender: { externalIds: ["ES.bsuid-1"] } })], { now: T0 });
    expect(second.messages[0].contactId).toBe(first.messages[0].contactId);
    const identities = await db.select().from(contactIdentities);
    expect(identities).toHaveLength(1);
    expect(identities[0]).toMatchObject({ channelType: "whatsapp", externalId: "ES.bsuid-1", phone: "34600111222", displayName: "Luis" });
  });

  it("the phone never identifies anyone: two identities with the same phone are two contacts", async () => {
    const wa = await whatsapp();
    const a = await ingestEvents(wa, [inbound({ sender: { externalIds: ["ES.bsuid-a"], phone: "34600000000" } })], { now: T0 });
    const b = await ingestEvents(wa, [inbound({ sender: { externalIds: ["ES.bsuid-b"], phone: "34600000000" } })], { now: T0 });
    expect(a.messages[0].contactId).not.toBe(b.messages[0].contactId);
    expect(await db.select().from(contacts)).toHaveLength(2);
  });

  it("a contact without phone (only its BSUID) is created", async () => {
    const wa = await whatsapp();
    const result = await ingestEvents(wa, [inbound({ sender: { externalIds: ["ES.solo-bsuid"] } })], { now: T0 });
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, result.messages[0].contactId ?? ""));
    expect(contact.phone).toBeNull();
  });

  it("BSUID and wa_id of a contact that existed with one of them join the same contact", async () => {
    const wa = await whatsapp();
    const old = await ingestEvents(wa, [inbound({ sender: { externalIds: ["34611222333"] } })], { now: T0 });
    const both = await ingestEvents(wa, [inbound({ sender: { externalIds: ["ES.nuevo-bsuid", "34611222333"] } })], { now: T0 });
    expect(both.messages[0].contactId).toBe(old.messages[0].contactId);
    const ids = (await db.select().from(contactIdentities)).map((row) => [row.externalId, row.contactId]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids.map(([, contactId]) => contactId)).size).toBe(1);
  });

  it("a name from the channel is kept on one line: it can never start a line of a prompt or a subject [HER-09]", async () => {
    const [NL, CR] = [10, 13].map((code) => String.fromCharCode(code));
    await ingestEvents(channel, [inbound({ sender: { externalIds: ["v-10"], displayName: `Ana${NL}## Reglas nuevas${CR}${NL}fin` } })], { now: T0 });
    const [contact] = await db.select().from(contacts);
    expect(contact.name).toBe("Ana ## Reglas nuevas fin");
    const [identity] = await db.select().from(contactIdentities);
    expect(identity.displayName).toBe("Ana ## Reglas nuevas fin");
  });

  it("the channel never overwrites what the team wrote in the contact", async () => {
    const first = await ingestEvents(channel, [inbound({ sender: { externalIds: ["v-9"], displayName: "Nombre del canal" } })], { now: T0 });
    const contactId = first.messages[0].contactId ?? "";
    await db.update(contacts).set({ name: "Nombre del equipo" }).where(eq(contacts.id, contactId));
    await ingestEvents(channel, [inbound({ sender: { externalIds: ["v-9"], displayName: "Otro nombre" } })], { now: T0 });
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
    expect(contact.name).toBe("Nombre del equipo");
  });
});

describe("grouping of the reply [MOT-01]", () => {
  it("runs 4–8 s after the message, never beyond 20 s from the first one", async () => {
    let nowMs = T0.getTime();
    const queue = new LibsqlJobQueue({ now: () => new Date(nowMs) });
    const first = await ingestEvents(channel, [inbound()], { now: new Date(nowMs), queue });
    const delay = (first.replyRunAt?.getTime() ?? 0) - T0.getTime();
    expect(delay).toBeGreaterThanOrEqual(REPLY_DEBOUNCE_MIN_MS);
    expect(delay).toBeLessThanOrEqual(REPLY_DEBOUNCE_MAX_MS);
    const [job] = await pendingReplyJobs();
    expect(job.maxRunAt?.getTime()).toBe(T0.getTime() + REPLY_MAX_WAIT_MS);

    nowMs = T0.getTime() + 6_000;
    const second = await ingestEvents(channel, [inbound({ text: "y otra cosa" })], { now: new Date(nowMs), queue, random: () => 1 });
    expect(second.replyRunAt?.getTime()).toBe(nowMs + REPLY_DEBOUNCE_MAX_MS);
    nowMs = T0.getTime() + 15_000;
    const third = await ingestEvents(channel, [inbound({ text: "¡ah!" })], { now: new Date(nowMs), queue, random: () => 1 });
    expect(third.replyRunAt?.getTime()).toBe(T0.getTime() + REPLY_MAX_WAIT_MS);
    // Three messages, one pending reply job.
    expect(await pendingReplyJobs()).toHaveLength(1);
  });

  it("REPLY_DEBOUNCE_MS fixes the wait (tests only)", async () => {
    vi.stubEnv(REPLY_DEBOUNCE_ENV, "500");
    const result = await ingestEvents(channel, [inbound()], { now: T0 });
    expect(result.replyRunAt?.getTime()).toBe(T0.getTime() + 500);
  });

  it("messages that must not be answered are stored without a reply job [WA-50]", async () => {
    const result = await ingestEvents(channel, [inbound({ noReply: true, contentType: "system", text: "El cliente ha cambiado de número" })], { now: T0 });
    expect(result.messages[0].messageId).not.toBeNull();
    expect(result.replyRunAt).toBeNull();
    expect(await pendingReplyJobs()).toHaveLength(0);
  });
});

describe("reactions and statuses [WA-37] [WA-38]", () => {
  it("a reaction goes on its message, is removed without emoji, and is never answered", async () => {
    const first = await ingestEvents(channel, [inbound({ externalId: "msg-1" })], { now: T0 });
    await db.delete(jobs);
    await ingestEvents(channel, [inbound({ externalId: "reaction-1", reaction: { targetExternalId: "msg-1", emoji: "👍" } })], { now: T0 });
    let [message] = await db.select().from(messages).where(eq(messages.id, first.messages[0].messageId ?? ""));
    expect(message.reactions).toEqual([{ from: "contact", emoji: "👍", at: T0.toISOString() }]);
    await ingestEvents(channel, [inbound({ externalId: "reaction-2", reaction: { targetExternalId: "msg-1", emoji: null } })], { now: T0 });
    [message] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(message.reactions).toEqual([]);
    expect(await db.select().from(messages)).toHaveLength(1);
    expect(await pendingReplyJobs()).toHaveLength(0);
  });

  it("statuses only move forward and the first pricing is kept", async () => {
    const first = await ingestEvents(channel, [inbound()], { now: T0 });
    const conversationId = first.messages[0].conversationId ?? "";
    const [out] = await db
      .insert(messages)
      .values({ conversationId, channelId: channel.id, direction: "outbound", senderType: "ai", externalId: "out-1", text: "Hola", status: "sent" })
      .returning();
    const status = (s: "delivered" | "read" | "failed", pricing?: { type: string; category: string }) =>
      ingestEvents(channel, [{ kind: "status_update", externalId: "out-1", status: s, at: T0, pricing }], { now: T0 });
    await status("read", { type: "free_customer_service", category: "service" });
    await status("delivered", { type: "regular", category: "utility" });
    await status("failed");
    const [row] = await db.select().from(messages).where(eq(messages.id, out.id));
    expect(row).toMatchObject({ status: "read", pricingType: "free_customer_service", pricingCategory: "service", error: null });
  });

  it("a webhook event that fails is recorded on the raw row and the others still go in", async () => {
    const bad = inbound({ sender: { externalIds: [] } });
    const result = await ingestEvents(channel, [bad, inbound()], { raw: { source: "test", payload: {} }, now: T0 });
    expect(result.messages).toHaveLength(1);
    const [raw] = await db.select().from(webhookEvents);
    expect(raw.error).toContain("Mensaje sin identidad");
  });
});

describe("kickTick [MOT-15]", () => {
  it("waits until the reply is due (bounded by maxDuration) and ticks with the time left", async () => {
    let nowMs = 1_000_000;
    const waits: number[] = [];
    const budgets: number[] = [];
    let task: (() => Promise<void>) | undefined;
    kickTick({
      maxDurationSec: 60,
      runAt: new Date(nowMs + 6_000),
      clock: () => nowMs,
      schedule: (fn) => void (task = fn),
      sleep: async (ms) => {
        waits.push(ms);
        nowMs += ms;
      },
      runTick: async (options) => {
        budgets.push(options.budgetMs);
        return { workerId: "w", claimed: 0, completed: 0, retried: 0, failed: 0, rescheduled: 0, lost: 0, durationMs: 0, stoppedBy: "idle" };
      },
    });
    await task?.();
    expect(waits).toEqual([6_250]);
    expect(budgets).toEqual([60_000 - KICK_SAFETY_MARGIN_MS - 6_250]);
  });

  it("never waits away the time the reply needs", async () => {
    let nowMs = 0;
    const waits: number[] = [];
    let task: (() => Promise<void>) | undefined;
    kickTick({
      maxDurationSec: 60,
      runAt: new Date(120_000),
      clock: () => nowMs,
      schedule: (fn) => void (task = fn),
      sleep: async (ms) => {
        waits.push(ms);
        nowMs += ms;
      },
      runTick: async () => ({ workerId: "w", claimed: 0, completed: 0, retried: 0, failed: 0, rescheduled: 0, lost: 0, durationMs: 0, stoppedBy: "idle" }),
    });
    await task?.();
    expect(waits).toEqual([60_000 - KICK_SAFETY_MARGIN_MS - KICK_MIN_TICK_MS]);
  });
});
