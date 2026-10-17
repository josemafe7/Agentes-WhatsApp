// What the inbox sends by Instagram long after it was written: an approved draft of the AI and «Reintentar» on a failed
// message ([IG-05], [IG-06], [CAN-07], [BAN-13]). Like Meta, the fake Instagram posts the signed echo of each send to the
// webhook BEFORE it answers the send, so the echo finds the message still «en cola», without its id.
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approveDraft, retryFailedMessage } from "@/data/messages";
import { db } from "@/db";
import { agents, auditLog, channels, contactIdentities, contacts, conversations, handoffEvents, jobs, messages, realtimeEvents, webhookEvents } from "@/db/schema";
import { INSTAGRAM_MAX_TEXT_BYTES } from "@/lib/instagram/client";
import { REPLY_JOB } from "@/server/engine/schedule";
import { ValidationError } from "@/server/errors";
import { sendOutbound } from "@/server/outbound/send";
import { createAgentRow, createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";
import { connectedAccountRoutes, echoMessage, fakeInstagramFetch, IG_TEST, igOk, instagramWebhook, sentResponse, signedBody, textMessage } from "@/test/fixtures/instagram";
import { registerChannelAdapter } from "../registry";
import type { ChannelRecord } from "../types";
import { createInstagramAdapter, instagramAdapter } from "./adapter";
import { encryptInstagramSecrets } from "./config";
import { INSTAGRAM_SENDER_NAME } from "./echo";
import { processInstagramWebhook } from "./webhook";

const TEXT = "Te esperamos el jueves a las 17:00.";
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

let owner: TestUser;
let agent: typeof agents.$inferSelect;
let channel: ChannelRecord;
let conversation: typeof conversations.$inferSelect;

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

/**
 * The fake Instagram of this file: each send answers with a new `message_id`, after posting its echo to the webhook
 * (with that id, or another one: that they match is not verified, §12). `echoText` changes the echo's text.
 */
function instagramThatEchoes(options: { echoMid?: "same" | "other"; echoText?: (text: string) => string } = {}) {
  const state = { sent: [] as string[], messageIds: [] as string[], echoes: [] as ReturnType<typeof signedBody>[], recordedDuringSend: 0 };
  const fake = fakeInstagramFetch(
    connectedAccountRoutes({
      "POST me/messages": async (call) => {
        const text = (call.body as { message: { text: string } }).message.text;
        const messageId = `m_${crypto.randomUUID()}`;
        state.sent.push(text);
        state.messageIds.push(messageId);
        const echo = echoMessage({ text: options.echoText?.(text) ?? text }, { mid: options.echoMid === "other" ? `eco_${messageId}` : messageId, timestamp: Date.now() });
        const signed = signedBody(instagramWebhook([echo]));
        state.echoes.push(signed);
        expect((await processInstagramWebhook(channel.id, signed.raw, signed.signature)).status).toBe(200);
        state.recordedDuringSend += (await db.select().from(messages).where(eq(messages.senderName, INSTAGRAM_SENDER_NAME))).length;
        return igOk(sentResponse(messageId));
      },
    }),
  );
  registerChannelAdapter(createInstagramAdapter(fake.deps));
  return state;
}

/** Sent once, with Instagram's id; nothing «Desde Instagram»; the AI not paused by it; every echo handled. */
async function expectSentOnce(messageId: string, instagram: ReturnType<typeof instagramThatEchoes>) {
  const outbound = await db.select().from(messages).where(eq(messages.direction, "outbound"));
  expect(outbound).toHaveLength(1);
  expect(outbound[0]).toMatchObject({ id: messageId, status: "sent", externalId: instagram.messageIds[0] });
  expect(outbound.filter((row) => row.senderName === INSTAGRAM_SENDER_NAME)).toHaveLength(0);
  const [row] = await db.select().from(conversations).where(eq(conversations.id, conversation.id));
  expect(row.aiPausedUntil).toBeNull();
  expect(instagram.echoes).toHaveLength(1);
  expect((await db.select().from(webhookEvents)).map((raw) => raw.error)).toEqual([null]);
}

const aiDraft = (text: string = TEXT, now?: Date) =>
  sendOutbound({ conversationId: conversation.id, sender: { type: "ai", agentId: agent.id, agentName: agent.name }, text, draft: true, now });

beforeAll(async () => {
  await createBusiness({ aiPauseHours: 12 });
  owner = await createUser("owner", { name: "Olga" });
});

beforeEach(async () => {
  for (const table of [handoffEvents, messages, conversations, contactIdentities, contacts, webhookEvents, jobs, realtimeEvents, auditLog]) await db.delete(table);
  await db.delete(channels);
  agent = await createAgentRow({ name: "Recepción" });
  channel = await createChannel({
    type: "instagram",
    name: "Instagram Peluquería",
    status: "connected",
    activeAgentId: agent.id,
    config: { accountId: IG_TEST.accountId, username: IG_TEST.username },
    secretsEnc: encryptInstagramSecrets({ accessToken: IG_TEST.accessToken, appSecret: IG_TEST.appSecret, metaAppSecret: null, verifyToken: IG_TEST.verifyToken }),
  });
  const { contact } = await createContactWithIdentity("instagram", { externalId: IG_TEST.customer.id });
  // The customer wrote a moment ago: the 24 h window is open.
  conversation = await createConversation(channel.id, contact.id, { lastInboundAt: minutesAgo(1) });
});

afterEach(() => registerChannelAdapter(instagramAdapter));

describe("the echo of what the inbox sends long after it was written [IG-06]", () => {
  it("a draft written 10 minutes before is approved and its echo comes during the send: sent once with its id, nothing «Desde Instagram», the AI not paused [IG-06] [CAN-07]", async () => {
    const instagram = instagramThatEchoes();
    const draft = await aiDraft(TEXT, minutesAgo(10));
    expect(await approveDraft(owner.actor, { messageId: draft.messageId })).toMatchObject({ status: "sent", error: null });
    expect(instagram.recordedDuringSend).toBe(0);
    await expectSentOnce(draft.messageId, instagram);
  });

  it("«Reintentar» on a message that failed 10 minutes before, with its echo during the send: the same [IG-06] [BAN-13]", async () => {
    const instagram = instagramThatEchoes();
    const failed = await createMessage(conversation, {
      direction: "outbound",
      senderType: "ai",
      agentId: agent.id,
      agentName: agent.name,
      externalId: null,
      status: "failed",
      error: { message: "Instagram ha tardado demasiado en responder. Se reintentará." },
      text: TEXT,
      createdAt: minutesAgo(10),
      statusUpdatedAt: minutesAgo(10),
    });
    expect(await retryFailedMessage(owner.actor, failed.id)).toMatchObject({ status: "sent", error: null });
    expect(instagram.recordedDuringSend).toBe(0);
    await expectSentOnce(failed.id, instagram);
  });

  it("an echo whose id is not the send's (not verified by Meta, §12) is the app's too, during the send and when Meta repeats it later [IG-06]", async () => {
    const instagram = instagramThatEchoes({ echoMid: "other" });
    const draft = await aiDraft(TEXT, minutesAgo(10));
    await approveDraft(owner.actor, { messageId: draft.messageId });
    await expectSentOnce(draft.messageId, instagram);
    // Meta delivers the same echo again once the send has its id.
    const [again] = instagram.echoes;
    expect((await processInstagramWebhook(channel.id, again.raw, again.signature)).status).toBe(200);
    expect(await db.select().from(messages).where(eq(messages.direction, "outbound"))).toHaveLength(1);
    expect((await db.select().from(conversations).where(eq(conversations.id, conversation.id)))[0].aiPausedUntil).toBeNull();
  });

  it("an echo with the send's id but a text Instagram changed is taken for the business's, and undone when the send answers: one message, the pause it had [IG-06]", async () => {
    const personPause = new Date(Date.now() + 60 * 60_000);
    await db.update(conversations).set({ aiPausedUntil: personPause, pauseReason: "Ha respondido Olga" }).where(eq(conversations.id, conversation.id));
    const instagram = instagramThatEchoes({ echoText: (text) => `${text} ✔️` });
    const draft = await aiDraft(TEXT, minutesAgo(10));
    expect(await approveDraft(owner.actor, { messageId: draft.messageId })).toMatchObject({ status: "sent" });
    // During the send it was taken for one written in Instagram…
    expect(instagram.recordedDuringSend).toBe(1);
    // …and once Instagram answered with that same id, it is this message: no second one, and the AI keeps the pause it had.
    const outbound = await db.select().from(messages).where(eq(messages.direction, "outbound"));
    expect(outbound).toHaveLength(1);
    expect(outbound[0]).toMatchObject({ id: draft.messageId, status: "sent", externalId: instagram.messageIds[0] });
    const [row] = await db.select().from(conversations).where(eq(conversations.id, conversation.id));
    expect(row.aiPausedUntil?.getTime()).toBe(personPause.getTime());
    expect(row.pauseReason).toBe("Ha respondido Olga");
  });

  it("that echo had cancelled the AI's pending reply to a newer message of the customer: once undone, the reply is scheduled again [IG-06] [MOT-01]", async () => {
    const draft = await aiDraft(TEXT, minutesAgo(10));
    const question = signedBody(instagramWebhook([textMessage("¿Y el viernes?", { mid: "m-viernes" })]));
    expect((await processInstagramWebhook(channel.id, question.raw, question.signature)).status).toBe(200);
    const pendingReplies = () => db.select().from(jobs).where(and(eq(jobs.type, REPLY_JOB), eq(jobs.status, "pending")));
    expect(await pendingReplies()).toHaveLength(1);
    const instagram = instagramThatEchoes({ echoText: (text) => `${text} ✔️` });
    expect(await approveDraft(owner.actor, { messageId: draft.messageId })).toMatchObject({ status: "sent" });
    expect(instagram.recordedDuringSend).toBe(1);
    const [row] = await db.select().from(conversations).where(eq(conversations.id, conversation.id));
    expect(row.aiPausedUntil).toBeNull();
    const replies = await pendingReplies();
    expect(replies).toHaveLength(1);
    const [asked] = await db.select().from(messages).where(eq(messages.externalId, "m-viernes"));
    expect(replies[0].payload).toMatchObject({ conversationId: conversation.id, lastInboundMessageId: asked.id });
  });
});

describe("approving a draft longer than Instagram's 1,000 bytes [IG-05]", () => {
  it("the AI's draft as it was goes like any reply of the AI, cut with «…»; only a changed one is refused, never cut [IG-05]", async () => {
    const instagram = instagramThatEchoes();
    const long = "é".repeat(600);
    expect(bytes(long)).toBe(1_200);
    const asItWas = await aiDraft(long);
    expect(await approveDraft(owner.actor, { messageId: asItWas.messageId })).toMatchObject({ status: "sent" });
    // The form may send the draft's own text back: still unchanged.
    const sentBack = await aiDraft(long);
    expect(await approveDraft(owner.actor, { messageId: sentBack.messageId, text: long })).toMatchObject({ status: "sent" });
    expect(instagram.sent).toHaveLength(2);
    for (const text of instagram.sent) {
      expect(bytes(text)).toBeLessThanOrEqual(INSTAGRAM_MAX_TEXT_BYTES);
      expect(text.endsWith("…")).toBe(true);
    }
    const [unchanged] = await db.select().from(messages).where(eq(messages.id, sentBack.messageId));
    expect(unchanged.metadata).not.toHaveProperty("editedBeforeSending");

    const changed = await aiDraft("Hola");
    const error = await errorOf(approveDraft(owner.actor, { messageId: changed.messageId, text: "á".repeat(600) }));
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors?.text?.[0]).toMatch(/1\.000 bytes/);
    expect(instagram.sent).toHaveLength(2);
    expect((await db.select().from(messages).where(and(eq(messages.id, changed.messageId), eq(messages.status, "draft"))))).toHaveLength(1);
  });
});
