// [BAN-16] A person turns the AI of a conversation back on by hand (after a hand-off, a pause or switching it off) and
// the customer's last message is still unanswered: the AI answers it a few seconds later, as it would a new message,
// through the reply job and every check of [MOT-03]. Nothing is scheduled when there is nothing to answer, when a
// draft of the AI already waits for review, or when the AI is paused or switched off instead.
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConversationAi } from "@/data/conversation-actions";
import { ensureSettingsRows } from "@/data/settings";
import { db } from "@/db";
import {
  agents,
  aiRuns,
  appKv,
  auditLog,
  channels,
  contactIdentities,
  contacts,
  conversations,
  handoffEvents,
  integrationSettings,
  jobs,
  messages,
  notifications,
  realtimeEvents,
} from "@/db/schema";
import type { ChannelRecord } from "@/server/channels/types";
import { handoffService } from "@/server/handoff/service";
import { ingestEvents } from "@/server/inbound/ingest";
import { chatCompletion, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog, type FakeCall } from "@/test/fake-openrouter";
import { createAgentRow, createBusiness, createChannel, createUser, type TestUser } from "@/test/factories";
import { processReplyJob, type ReplyOutcome } from "./reply";
import { REPLY_DEBOUNCE_MAX_MS, REPLY_DEBOUNCE_MIN_MS, REPLY_JOB, replyJobPayload } from "./schedule";

const NOW = new Date("2026-09-30T09:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

const openRouter = fakeFetch(
  routes({
    "GET /models/user": () => jsonResponse({ data: sampleCatalog() }),
    "POST /chat/completions": () => jsonResponse(chatCompletion({ content: "Sí, aquí estamos: ¿en qué te ayudo?" })),
  }),
);
const chatCalls = () => openRouter.calls.filter((call) => call.path === "/chat/completions");
const lastUserTurn = (call: FakeCall) => (call.body as { messages: { role: string; content: string }[] }).messages.filter((message) => message.role === "user").at(-1)?.content;

let channel: ChannelRecord;
let owner: TestUser;

async function receive(text: string, when: Date): Promise<{ conversationId: string; messageId: string }> {
  const result = await ingestEvents(
    channel,
    [{ kind: "inbound_message", externalId: crypto.randomUUID(), sender: { externalIds: ["visitor-1"], displayName: "Ana" }, contentType: "text", text, sentAt: when }],
    { now: when },
  );
  const [message] = result.messages;
  return { conversationId: message.conversationId ?? "", messageId: message.messageId ?? "" };
}

const pendingReplyJobs = (conversationId: string) =>
  db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, REPLY_JOB), eq(jobs.status, "pending"), eq(jobs.dedupeKey, `reply:${conversationId}`)));

/** Runs the pending reply job as the queue would, and takes it out of the queue as done. */
async function runReply(conversationId: string, when: Date): Promise<ReplyOutcome> {
  const [job] = await pendingReplyJobs(conversationId);
  const context = { job, rescheduleAt: () => undefined, remainingMs: () => 120_000 };
  const outcome = await processReplyJob(replyJobPayload.parse(job.payload), context, { fetchImpl: openRouter.fetch, now: when, retryDelayMs: 0 });
  await db.update(jobs).set({ status: "done" }).where(eq(jobs.id, job.id));
  return outcome;
}

const aiReplies = (conversationId: string) =>
  db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.senderType, "ai")))
    .orderBy(asc(messages.createdAt));

beforeEach(async () => {
  for (const table of [notifications, handoffEvents, aiRuns, messages, conversations, contactIdentities, contacts, jobs, realtimeEvents, appKv, auditLog]) {
    await db.delete(table);
  }
  await db.update(channels).set({ activeAgentId: null });
  await db.delete(channels);
  await db.delete(agents);
  await createBusiness({ name: "Peluquería Lola", timezone: "Europe/Madrid", handoff: { assignment: "unassigned" } });
  await ensureSettingsRows();
  await db.update(integrationSettings).set({ zdr: false });
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
  openRouter.calls.length = 0;
  const agent = await createAgentRow({ name: "Recepción" });
  channel = await createChannel({ type: "webchat", name: "Web", activeAgentId: agent.id });
  owner = await createUser("owner", { name: "Olga" });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at(120_000));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("reactivating the AI answers what the customer left unanswered [BAN-16]", () => {
  it("after a hand-off: the message that came meanwhile gets the AI's answer a few seconds later", async () => {
    const { conversationId } = await receive("Hola", NOW);
    expect((await runReply(conversationId, at(10_000))).kind).toBe("replied");
    await handoffService.requestHandoff({ conversationId, agentId: null, trigger: "human", reason: "A mano", summary: "", urgency: "normal", customerMessage: null, requestedAt: at(20_000) });
    const waiting = await receive("¿Sigue ahí alguien?", at(60_000));
    expect(await runReply(conversationId, at(70_000))).toEqual({ kind: "skipped", reason: "human_mode" });

    await setConversationAi(owner.actor, { conversationId, mode: "on" });
    const [job] = await pendingReplyJobs(conversationId);
    expect(job.payload).toEqual({ conversationId, lastInboundMessageId: waiting.messageId });
    const wait = job.runAt.getTime() - at(120_000).getTime();
    expect(wait).toBeGreaterThanOrEqual(REPLY_DEBOUNCE_MIN_MS);
    expect(wait).toBeLessThanOrEqual(REPLY_DEBOUNCE_MAX_MS);

    expect((await runReply(conversationId, at(130_000))).kind).toBe("replied");
    expect(lastUserTurn(chatCalls()[1])).toBe("¿Sigue ahí alguien?");
    expect(await aiReplies(conversationId)).toHaveLength(2);
  });

  it("after switching it off by hand, the same", async () => {
    const { conversationId } = await receive("Hola", NOW);
    await runReply(conversationId, at(10_000));
    await setConversationAi(owner.actor, { conversationId, mode: "off" });
    await receive("¿Me confirmáis la cita?", at(60_000));
    expect(await runReply(conversationId, at(70_000))).toEqual({ kind: "skipped", reason: "human_mode" });
    await setConversationAi(owner.actor, { conversationId, mode: "on" });
    expect((await runReply(conversationId, at(130_000))).kind).toBe("replied");
    expect(lastUserTurn(chatCalls()[1])).toBe("¿Me confirmáis la cita?");
  });

  it("with nothing unanswered, nothing is scheduled", async () => {
    const { conversationId } = await receive("Hola", NOW);
    await runReply(conversationId, at(10_000));
    await setConversationAi(owner.actor, { conversationId, mode: "off" });
    await setConversationAi(owner.actor, { conversationId, mode: "on" });
    expect(await pendingReplyJobs(conversationId)).toHaveLength(0);
  });

  it("a draft of the AI already waiting for review is not prepared twice", async () => {
    await db.update(channels).set({ replyMode: "draft" }).where(eq(channels.id, channel.id));
    channel = { ...channel, replyMode: "draft" };
    const { conversationId } = await receive("Hola, ¿tenéis hueco el sábado?", NOW);
    await runReply(conversationId, at(10_000));
    expect((await aiReplies(conversationId)).map((message) => message.status)).toEqual(["draft"]);
    await setConversationAi(owner.actor, { conversationId, mode: "off" });
    await setConversationAi(owner.actor, { conversationId, mode: "on" });
    expect(await pendingReplyJobs(conversationId)).toHaveLength(0);
  });

  it("pausing or switching it off schedules nothing", async () => {
    const { conversationId } = await receive("Hola", NOW);
    await db.update(jobs).set({ status: "done" });
    await setConversationAi(owner.actor, { conversationId, mode: "pause", until: at(3_600_000) });
    await setConversationAi(owner.actor, { conversationId, mode: "off" });
    expect(await pendingReplyJobs(conversationId)).toHaveLength(0);
  });
});
