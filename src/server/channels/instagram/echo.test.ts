import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, jobs, messages, realtimeEvents } from "@/db/schema";
import { getJobQueue } from "@/server/adapters/job-queue";
import { replyDedupeKey } from "@/server/engine/schedule";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage } from "@/test/factories";
import { IG_TEST } from "@/test/fixtures/instagram";
import type { ChannelRecord } from "../types";
import { INSTAGRAM_FILE_ECHO_TEXT, INSTAGRAM_PAUSE_REASON, INSTAGRAM_SENDER_NAME, runInstagramEcho } from "./echo";
import type { InstagramEchoPayload } from "./schedule";

const T0 = new Date("2026-10-16T08:00:20Z");
let channel: ChannelRecord;

const echo = (overrides: Partial<InstagramEchoPayload> = {}): InstagramEchoPayload => ({
  channelId: channel.id,
  userId: IG_TEST.customer.id,
  mid: "m-echo-1",
  text: "Sí, a las 17:00",
  hasAttachment: false,
  sentAt: "2026-10-16T08:00:05.000Z",
  ...overrides,
});

beforeEach(async () => {
  for (const table of [messages, conversations, contactIdentities, contacts, jobs, realtimeEvents]) await db.delete(table);
  await db.delete(channels);
  await createBusiness({ aiPauseHours: 12 });
  channel = await createChannel({ type: "instagram", name: "Instagram", status: "connected", config: { accountId: IG_TEST.accountId } });
});

describe("the echo: what the business answers from Instagram [IG-06]", () => {
  it("an echo of a message the app sent (same id) changes nothing", async () => {
    const { contact } = await createContactWithIdentity("instagram", { externalId: IG_TEST.customer.id });
    const conversation = await createConversation(channel.id, contact.id);
    await createMessage(conversation, { direction: "outbound", senderType: "ai", externalId: "m-echo-1", status: "sent", text: "Sí, a las 17:00" });
    expect(await runInstagramEcho(echo(), { now: T0 })).toBe("own");
    expect(await db.select().from(messages)).toHaveLength(1);
    const [row] = await db.select().from(conversations).where(eq(conversations.id, conversation.id));
    expect(row.aiPausedUntil).toBeNull();
  });

  it("an echo of the app's own text moments before is the app's too, even before its id is stored (not verified by Meta, §12) [IG-06]", async () => {
    const { contact } = await createContactWithIdentity("instagram", { externalId: IG_TEST.customer.id });
    const conversation = await createConversation(channel.id, contact.id);
    // Still «en cola»: Instagram has not confirmed it yet, so its id is not stored.
    await createMessage(conversation, { direction: "outbound", senderType: "ai", externalId: null, status: "queued", text: "Sí, a las 17:00", createdAt: new Date("2026-10-16T08:00:04Z") });
    expect(await runInstagramEcho(echo(), { now: T0 })).toBe("own");
    expect(await db.select().from(messages)).toHaveLength(1);
    // The same text written in Instagram long after is the business's.
    expect(await runInstagramEcho(echo({ mid: "m-later", sentAt: "2026-10-16T09:00:00.000Z" }), { now: T0 })).toBe("recorded");
  });

  it("anything else joins the conversation «Desde Instagram», pauses the AI and drops a pending reply [IG-06] [BAN-11]", async () => {
    const { contact } = await createContactWithIdentity("instagram", { externalId: IG_TEST.customer.id });
    const conversation = await createConversation(channel.id, contact.id);
    await createMessage(conversation, { text: "¿Tenéis cita?" });
    await getJobQueue().enqueue({ type: "reply", payload: { conversationId: conversation.id }, dedupeKey: replyDedupeKey(conversation.id), runAt: new Date(T0.getTime() + 5_000) });
    expect(await runInstagramEcho(echo(), { now: T0 })).toBe("recorded");
    const [message] = await db.select().from(messages).where(eq(messages.externalId, "m-echo-1"));
    expect(message).toMatchObject({ conversationId: conversation.id, direction: "outbound", senderType: "human", senderName: INSTAGRAM_SENDER_NAME, text: "Sí, a las 17:00", status: "sent" });
    expect(message.metadata).toMatchObject({ sentFromInstagram: true });
    const [row] = await db.select().from(conversations).where(eq(conversations.id, conversation.id));
    expect(row.aiPausedUntil?.getTime()).toBe(T0.getTime() + 12 * 60 * 60_000);
    expect(row.pauseReason).toBe(INSTAGRAM_PAUSE_REASON);
    const [reply] = await db.select().from(jobs).where(eq(jobs.dedupeKey, replyDedupeKey(conversation.id)));
    expect(reply.status).toBe("cancelled");
    // The same echo again (a retry of Meta's) is not recorded twice.
    expect(await runInstagramEcho(echo(), { now: T0 })).toBe("own");
    expect(await db.select().from(messages).where(eq(messages.externalId, "m-echo-1"))).toHaveLength(1);
  });

  it("a file sent from Instagram shows as such; an echo with nothing to show is skipped", async () => {
    expect(await runInstagramEcho(echo({ mid: "m-file", text: null, hasAttachment: true }), { now: T0 })).toBe("recorded");
    const [message] = await db.select().from(messages).where(eq(messages.externalId, "m-file"));
    expect(message.text).toBe(INSTAGRAM_FILE_ECHO_TEXT);
    // To someone who never wrote before: their contact is made by their Instagram id, never by phone.
    const [identity] = await db.select().from(contactIdentities);
    expect(identity).toMatchObject({ channelType: "instagram", externalId: IG_TEST.customer.id, phone: null });
    expect(await runInstagramEcho(echo({ mid: "m-empty", text: null, hasAttachment: false }), { now: T0 })).toBe("skipped");
  });

  it("a demo channel or another type never takes echoes [ARR-11]", async () => {
    const demo = await createChannel({ type: "instagram", isDemo: true });
    const webchat = await createChannel();
    expect(await runInstagramEcho(echo({ channelId: demo.id }), { now: T0 })).toBe("skipped");
    expect(await runInstagramEcho(echo({ channelId: webchat.id }), { now: T0 })).toBe("skipped");
    expect(await db.select().from(messages)).toHaveLength(0);
  });
});
