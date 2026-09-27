import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { businessSettings, channels, contactIdentities, contacts, conversations, handoffEvents, jobs, messages, notifications, realtimeEvents, userRoles } from "@/db/schema";
import { registerChannelAdapter, unregisterChannelAdapter } from "@/server/channels/registry";
import { ChannelSendError, type ChannelAdapter } from "@/server/channels/types";
import { replyDedupeKey, REPLY_JOB } from "@/server/engine/schedule";
import { AuthError, ConflictError, ValidationError } from "@/server/errors";
import { sendOutbound } from "@/server/outbound/send";
import { createAgentRow, createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";
import { approveDraft, canViewMessageMedia, discardDraft, listMessages, retryFailedMessage, sendHumanMessage } from "./messages";

let users: Record<"owner" | "supervisor" | "agentA" | "viewer", TestUser>;
let channelA: string;
let channelB: string;
let inA: typeof conversations.$inferSelect;
let inB: typeof conversations.$inferSelect;

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}
const forbidden = async (promise: Promise<unknown>) => expect(await errorOf(promise)).toBeInstanceOf(AuthError);
const row = async (id: string) => (await db.select().from(conversations).where(eq(conversations.id, id)))[0];
const outbound = (conversationId: string) => db.select().from(messages).where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "outbound")));

beforeAll(async () => {
  await createBusiness({ aiPauseHours: 12 });
  await db.delete(userRoles);
  channelA = (await createChannel({ name: "Web A" })).id;
  channelB = (await createChannel({ name: "Web B" })).id;
  users = {
    owner: await createUser("owner", { name: "Olga" }),
    supervisor: await createUser("supervisor", { name: "Susana" }),
    agentA: await createUser("agent", { name: "Aitor", channelIds: [channelA] }),
    viewer: await createUser("viewer"),
  };
});

beforeEach(async () => {
  for (const table of [notifications, handoffEvents, messages, conversations, contactIdentities, contacts, jobs, realtimeEvents]) await db.delete(table);
  await db.update(channels).set({ status: "connected" });
  const ana = await createContactWithIdentity("webchat", { name: "Ana" });
  const bruno = await createContactWithIdentity("webchat", { name: "Bruno" });
  inA = await createConversation(channelA, ana.contact.id, { unreadCount: 3 });
  inB = await createConversation(channelB, bruno.contact.id);
  await createMessage(inA, { text: "Hola", createdAt: new Date(Date.now() - 60_000) });
  await createMessage(inB, { text: "Hola", createdAt: new Date(Date.now() - 60_000) });
});

afterEach(() => unregisterChannelAdapter("whatsapp"));

describe("a person replies from the inbox [BAN-11] [BAN-05]", () => {
  it("sends it through the channel, pauses the AI 12 h with the reason and marks the conversation read", async () => {
    const before = Date.now();
    const result = await sendHumanMessage(users.agentA.actor, { conversationId: inA.id, text: "  Hola Ana, soy Aitor  " });
    expect(result).toMatchObject({ status: "sent", error: null });
    const [message] = await outbound(inA.id);
    expect(message).toMatchObject({ senderType: "human", senderUserId: users.agentA.userId, senderName: "Aitor", text: "Hola Ana, soy Aitor", status: "sent" });
    const conversation = await row(inA.id);
    expect(conversation.pauseReason).toBe("Ha respondido Aitor");
    expect(conversation.unreadCount).toBe(0);
    const pause = (conversation.aiPausedUntil?.getTime() ?? 0) - before;
    expect(pause).toBeGreaterThanOrEqual(12 * 3_600_000 - 1_000);
    expect(pause).toBeLessThanOrEqual(12 * 3_600_000 + 5_000);
    expect(result.aiPausedUntil).toEqual(conversation.aiPausedUntil);
  });

  it("the pause lasts what the business set (editable)", async () => {
    await db.update(businessSettings).set({ aiPauseHours: 2 });
    const before = Date.now();
    await sendHumanMessage(users.owner.actor, { conversationId: inA.id, text: "Hola" });
    const pause = ((await row(inA.id)).aiPausedUntil?.getTime() ?? 0) - before;
    expect(pause).toBeLessThanOrEqual(2 * 3_600_000 + 5_000);
    await db.update(businessSettings).set({ aiPauseHours: 12 });
  });

  it("drops the pending AI reply", async () => {
    await db.insert(jobs).values({ type: REPLY_JOB, runAt: new Date(), dedupeKey: replyDedupeKey(inA.id), payload: { conversationId: inA.id } });
    await sendHumanMessage(users.owner.actor, { conversationId: inA.id, text: "Ya te atiendo yo" });
    const [job] = await db.select().from(jobs).where(eq(jobs.dedupeKey, replyDedupeKey(inA.id)));
    expect(job.status).toBe("cancelled");
  });

  it("the first reply after a hand-off is timed [TRA-06]", async () => {
    await db.insert(handoffEvents).values({ conversationId: inA.id, trigger: "ai_tool", requestedAt: new Date(Date.now() - 120_000) });
    const { messageId } = await sendHumanMessage(users.supervisor.actor, { conversationId: inA.id, text: "Aquí estoy" });
    const [event] = await db.select().from(handoffEvents);
    expect(event.firstHumanMessageId).toBe(messageId);
    expect(event.firstHumanResponseAt).not.toBeNull();
  });

  it("empty or too long texts are rejected", async () => {
    expect(await errorOf(sendHumanMessage(users.owner.actor, { conversationId: inA.id, text: "   " }))).toBeInstanceOf(ValidationError);
    expect(await errorOf(sendHumanMessage(users.owner.actor, { conversationId: inA.id, text: "x".repeat(4_097) }))).toBeInstanceOf(ValidationError);
  });

  it("a disabled channel does not send [CAN-16]", async () => {
    await db.update(channels).set({ status: "disabled" }).where(eq(channels.id, channelA));
    expect(await errorOf(sendHumanMessage(users.owner.actor, { conversationId: inA.id, text: "Hola" }))).toBeInstanceOf(ConflictError);
    expect(await outbound(inA.id)).toHaveLength(0);
  });

  it("outside WhatsApp's 24 h window only a template can be sent [BAN-08] [WA-43]", async () => {
    const wa = await createChannel({ name: "WA", type: "whatsapp", isDemo: true });
    const { contact } = await createContactWithIdentity("whatsapp");
    const conversation = await createConversation(wa.id, contact.id, { lastInboundAt: new Date(Date.now() - 25 * 3_600_000) });
    expect(await errorOf(sendHumanMessage(users.owner.actor, { conversationId: conversation.id, text: "Hola" }))).toBeInstanceOf(ConflictError);
  });

  it("Solo lectura and agents of other channels cannot reply [PER-02] [PER-03]", async () => {
    await forbidden(sendHumanMessage(users.viewer.actor, { conversationId: inA.id, text: "Hola" }));
    await forbidden(sendHumanMessage(users.agentA.actor, { conversationId: inB.id, text: "Hola" }));
    expect(await outbound(inA.id)).toHaveLength(0);
    expect(await outbound(inB.id)).toHaveLength(0);
  });
});

describe("failed sends [BAN-13]", () => {
  const failing = (errors: number): ChannelAdapter & { calls: number } => {
    const adapter = {
      calls: 0,
      type: "whatsapp" as const,
      capabilities: () => ({ audio: false, images: false, documents: false, templates: false, window24h: false, typing: false, readReceipts: false, html: false, drafts: false }),
      validateAndConnect: async () => ({ ok: true }),
      healthCheck: async () => ({ checkedAt: new Date().toISOString(), checks: [] }),
      handleWebhook: async () => [],
      send: async () => {
        adapter.calls++;
        if (adapter.calls <= errors) throw new ChannelSendError("El número no es válido.", false, 131026);
        return { externalId: `wamid.${adapter.calls}`, status: "sent" as const };
      },
      downloadMedia: async () => ({ bytes: new Uint8Array(), mimeType: "text/plain" }),
      disconnect: async () => {},
    };
    return adapter;
  };

  it("shows the error and «Reintentar» sends it again", async () => {
    const adapter = failing(1);
    registerChannelAdapter(adapter);
    const wa = await createChannel({ name: "WA real", type: "whatsapp" });
    const { contact } = await createContactWithIdentity("whatsapp");
    const conversation = await createConversation(wa.id, contact.id);
    const sent = await sendHumanMessage(users.owner.actor, { conversationId: conversation.id, text: "Hola" });
    expect(sent).toMatchObject({ status: "failed", error: { code: 131026, message: "El número no es válido." } });
    // A permanent error is not retried on its own.
    expect(adapter.calls).toBe(1);
    await forbidden(retryFailedMessage(users.viewer.actor, sent.messageId));
    const retried = await retryFailedMessage(users.owner.actor, sent.messageId);
    expect(retried).toMatchObject({ messageId: sent.messageId, status: "sent", error: null });
    const [message] = await outbound(conversation.id);
    expect(message.externalId).toBe("wamid.2");
    expect(await errorOf(retryFailedMessage(users.owner.actor, sent.messageId))).toBeInstanceOf(ConflictError);
  });
});

describe("drafts of the AI: approve, edit or discard [CAN-07] [MOT-14] [PER-02] [PER-03]", () => {
  async function draftIn(conversation: typeof inA): Promise<string> {
    const agent = await createAgentRow({ name: "Recepción" });
    const draft = await sendOutbound({ conversationId: conversation.id, sender: { type: "ai", agentId: agent.id, agentName: agent.name }, text: "Borrador de la IA", draft: true });
    expect(draft.status).toBe("draft");
    return draft.messageId;
  }
  const message = async (id: string) => (await db.select().from(messages).where(eq(messages.id, id)))[0];

  it("approving sends the draft through the channel as the agent wrote it, with who approved it; the AI is not paused", async () => {
    const id = await draftIn(inA);
    expect(await approveDraft(users.supervisor.actor, { messageId: id })).toMatchObject({ messageId: id, status: "sent", error: null });
    expect(await message(id)).toMatchObject({
      status: "sent",
      text: "Borrador de la IA",
      senderType: "ai",
      agentName: "Recepción",
      metadata: { approvedByUserId: users.supervisor.userId, approvedByName: "Susana" },
    });
    expect((await row(inA.id)).aiPausedUntil).toBeNull();
    // Approving twice sends it once.
    expect(await errorOf(approveDraft(users.owner.actor, { messageId: id }))).toBeInstanceOf(ConflictError);
  });

  it("an edited draft leaves with the person's text", async () => {
    const id = await draftIn(inA);
    await approveDraft(users.agentA.actor, { messageId: id, text: "Hola Ana, te esperamos el jueves a las 17:00." });
    expect(await message(id)).toMatchObject({ status: "sent", text: "Hola Ana, te esperamos el jueves a las 17:00.", metadata: { editedBeforeSending: true } });
    expect(await errorOf(approveDraft(users.owner.actor, { messageId: await draftIn(inA), text: " " }))).toBeInstanceOf(ValidationError);
  });

  it("discarding removes it: it never reaches the customer", async () => {
    const id = await draftIn(inA);
    await discardDraft(users.owner.actor, { messageId: id });
    expect(await message(id)).toBeUndefined();
    expect(await errorOf(discardDraft(users.owner.actor, { messageId: id }))).toBeInstanceOf(AuthError);
  });

  it("only drafts, only people who may reply there, and never on a disabled channel", async () => {
    const id = await draftIn(inB);
    await forbidden(approveDraft(users.viewer.actor, { messageId: id }));
    await forbidden(discardDraft(users.viewer.actor, { messageId: id }));
    await forbidden(approveDraft(users.agentA.actor, { messageId: id }));
    await forbidden(approveDraft(users.owner.actor, { messageId: crypto.randomUUID() }));
    expect((await message(id)).status).toBe("draft");

    const [sent] = await outbound(inA.id);
    const human = sent ?? (await createMessage(inA, { direction: "outbound", senderType: "human", status: "sent", text: "Ya enviado" }));
    expect(await errorOf(approveDraft(users.owner.actor, { messageId: human.id }))).toBeInstanceOf(ConflictError);

    await db.update(channels).set({ status: "disabled" }).where(eq(channels.id, channelB));
    expect(await errorOf(approveDraft(users.owner.actor, { messageId: id }))).toBeInstanceOf(ConflictError);
    expect((await message(id)).status).toBe("draft");
  });
});

describe("reading messages [BAN-05] [MED-08]", () => {
  it("oldest first, with the author of each message, and pages back", async () => {
    await createMessage(inA, { direction: "outbound", senderType: "ai", agentName: "Recepción", status: "delivered", text: "¡Hola!", createdAt: new Date(Date.now() - 30_000) });
    await createMessage(inA, { direction: "outbound", senderType: "human", senderName: "Olga", status: "read", text: "Soy Olga", createdAt: new Date(Date.now() - 10_000) });
    const page = await listMessages(users.viewer.actor, { conversationId: inA.id, limit: 2 });
    expect(page.items.map((message) => [message.senderType, message.authorName, message.status])).toEqual([
      ["ai", "Recepción", "delivered"],
      ["human", "Olga", "read"],
    ]);
    expect(page.hasMore).toBe(true);
    const older = await listMessages(users.viewer.actor, { conversationId: inA.id, before: page.items[0].id });
    expect(older.items.map((message) => message.text)).toEqual(["Hola"]);
    await forbidden(listMessages(users.agentA.actor, { conversationId: inB.id }));
  });

  it("files are only for people who may see that conversation", async () => {
    const key = "media/2026/09/5a5a5a5a-aaaa-4bbb-8ccc-123456789abc.png";
    await createMessage(inB, { contentType: "image", text: null, media: { fileKey: key, mimeType: "image/png", size: 10 } });
    const [item] = (await listMessages(users.owner.actor, { conversationId: inB.id })).items.filter((message) => message.contentType === "image");
    expect(item.media?.url).toBe(`/api/files/${key}`);
    expect(await canViewMessageMedia(users.owner.actor, key)).toBe(true);
    expect(await canViewMessageMedia(users.viewer.actor, key)).toBe(true);
    expect(await canViewMessageMedia(users.agentA.actor, key)).toBe(false);
    expect(await canViewMessageMedia(users.owner.actor, "media/2026/09/00000000-aaaa-4bbb-8ccc-123456789abc.png")).toBe(false);
  });
});
