// Phase 2 acceptance (3), end to end through the real pieces: a person answers from the inbox (src/data/messages.ts),
// the AI of that conversation pauses for the hours of Ajustes and says so; while paused, a new customer message gets no
// AI call; after those hours, or as soon as someone turns the AI back on, the AI answers again by itself ([BAN-10],
// [BAN-11], [MOT-03]).
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConversationAi } from "@/data/conversation-actions";
import { sendHumanMessage } from "@/data/messages";
import { ensureSettingsRows } from "@/data/settings";
import { db } from "@/db";
import {
  agents,
  aiRuns,
  appKv,
  auditLog,
  businessHours,
  businessSettings,
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
import type { Job } from "@/server/adapters/job-queue";
import type { ChannelRecord } from "@/server/channels/types";
import { ingestEvents } from "@/server/inbound/ingest";
import { chatCompletion, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog } from "@/test/fake-openrouter";
import { createAgentRow, createBusiness, createChannel, createUser, type TestUser } from "@/test/factories";
import { processReplyJob, type ReplyOutcome } from "./reply";
import { REPLY_JOB, replyJobPayload } from "./schedule";

const NOW = new Date("2026-09-30T09:00:00Z");
const PAUSE_HOURS = 2;
const HOUR_MS = 60 * 60_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

const fake = fakeFetch(
  routes({
    "GET /models/user": () => jsonResponse({ data: sampleCatalog() }),
    "POST /chat/completions": () => jsonResponse(chatCompletion({ content: "Claro, te ayudo." })),
  }),
);
const chatCalls = () => fake.calls.filter((call) => call.path === "/chat/completions").length;

let channel: ChannelRecord;
let owner: TestUser;

async function receive(text: string, when: Date): Promise<string> {
  const result = await ingestEvents(
    channel,
    [{ kind: "inbound_message", externalId: crypto.randomUUID(), sender: { externalIds: ["visitor-1"], displayName: "Ana" }, contentType: "text", text, sentAt: when }],
    { now: when },
  );
  return result.messages[0].conversationId ?? "";
}

/** Runs the pending reply job of the conversation as the queue would, at `when`. */
async function runReply(conversationId: string, when: Date): Promise<ReplyOutcome> {
  const [job] = (await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, REPLY_JOB), eq(jobs.status, "pending"), eq(jobs.dedupeKey, `reply:${conversationId}`)))) as Job[];
  const ctx = { job, rescheduleAt: () => undefined, remainingMs: () => 120_000 };
  return processReplyJob(replyJobPayload.parse(job.payload), ctx, { fetchImpl: fake.fetch, now: when, retryDelayMs: 0 });
}

const conversationRow = async (id: string) => (await db.select().from(conversations).where(eq(conversations.id, id)))[0];

beforeEach(async () => {
  for (const table of [notifications, handoffEvents, aiRuns, messages, conversations, contactIdentities, contacts, jobs, realtimeEvents, appKv, auditLog]) {
    await db.delete(table);
  }
  await db.update(channels).set({ activeAgentId: null });
  await db.delete(channels);
  await db.delete(agents);
  await db.delete(businessHours);
  await createBusiness({ name: "Peluquería Lola", timezone: "Europe/Madrid" });
  await ensureSettingsRows();
  await db.update(businessSettings).set({ aiPauseHours: PAUSE_HOURS });
  await db.update(integrationSettings).set({ zdr: false });
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
  fake.calls.length = 0;
  const agent = await createAgentRow({ name: "Recepción" });
  channel = await createChannel({ type: "webchat", name: "Web", activeAgentId: agent.id });
  owner = await createUser("owner", { name: "Eva" });
  // Only Date is faked: «now» of the inbox reply is NOW, while timers and the database keep running normally.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("a person answers from the inbox: the AI pauses and comes back [BAN-10] [BAN-11] [MOT-03]", () => {
  async function conversationPausedByEva(): Promise<string> {
    const conversationId = await receive("Hola, ¿hacéis mechas?", at(-60_000));
    expect((await runReply(conversationId, at(-50_000))).kind).toBe("replied");
    expect(chatCalls()).toBe(1);

    const sent = await sendHumanMessage(owner.actor, { conversationId, text: "Hola, soy Eva. Sí, las hacemos." });
    // «IA en pausa hasta …» for the hours of Ajustes, with who caused it.
    expect(sent.aiPausedUntil).toEqual(at(PAUSE_HOURS * HOUR_MS));
    expect(await conversationRow(conversationId)).toMatchObject({ aiMode: "ai", aiPausedUntil: at(PAUSE_HOURS * HOUR_MS), pauseReason: "Ha respondido Eva" });
    return conversationId;
  }

  it("while paused the customer's next message waits for a person; after the configured hours the AI answers by itself", async () => {
    const conversationId = await conversationPausedByEva();

    await receive("El jueves por la tarde", at(60_000));
    expect(await runReply(conversationId, at(70_000))).toEqual({ kind: "skipped", reason: "paused" });
    expect(chatCalls()).toBe(1);

    // The hours have passed: nobody touched anything and the AI is back for the next message.
    await receive("¿Sigue en pie lo del jueves?", at(PAUSE_HOURS * HOUR_MS + 60_000));
    expect((await runReply(conversationId, at(PAUSE_HOURS * HOUR_MS + 70_000))).kind).toBe("replied");
    expect(chatCalls()).toBe(2);
    expect(await conversationRow(conversationId)).toMatchObject({ aiPausedUntil: null, pauseReason: null });
  });

  it("turning the AI back on ends the pause at once", async () => {
    const conversationId = await conversationPausedByEva();
    await setConversationAi(owner.actor, { conversationId, mode: "on" });
    expect(await conversationRow(conversationId)).toMatchObject({ aiMode: "ai", aiPausedUntil: null, pauseReason: null });

    await receive("Gracias, ¿y el precio?", at(60_000));
    expect((await runReply(conversationId, at(70_000))).kind).toBe("replied");
    expect(chatCalls()).toBe(2);
  });
});
