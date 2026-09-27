// The running summary of long conversations ([MOT-13]): once enough messages fall out of the model's window, a job
// folds them into conversations.summary, and the next reply reads the summary instead of those messages.
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSettingsRows } from "@/data/settings";
import { db } from "@/db";
import {
  agents,
  aiRuns,
  appKv,
  auditLog,
  businessHours,
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
import type { ChatMessage } from "@/lib/openrouter/types";
import { ingestEvents } from "@/server/inbound/ingest";
import { chatCompletion, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog, type FakeCall } from "@/test/fake-openrouter";
import { createAgentRow, createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage } from "@/test/factories";
import { processReplyJob } from "./reply";
import { REPLY_JOB, replyJobPayload } from "./schedule";
import { processSummaryJob, REPLY_HISTORY_MESSAGES, scheduleSummaryIfNeeded, SUMMARY_BATCH, SUMMARY_JOB } from "./summary";

const T0 = new Date("2026-09-30T08:00:00Z");
const SUMMARY = "Ana quiere mechas; prefiere los jueves por la tarde y ya se le dio el precio (45 €).";

function openRouter() {
  return fakeFetch(
    routes({
      "GET /models/user": () => jsonResponse({ data: sampleCatalog() }),
      "POST /chat/completions": (call) => {
        const system = String((call.body as { messages: ChatMessage[] }).messages[0].content);
        return jsonResponse(chatCompletion({ content: system.startsWith("Resumes conversaciones") ? SUMMARY : "Perfecto, te lo reservo." }));
      },
    }),
  );
}
const chatCalls = (fake: ReturnType<typeof openRouter>) => fake.calls.filter((call) => call.path === "/chat/completions");
const bodyOf = (call: FakeCall) => call.body as { messages: ChatMessage[]; session_id?: string; provider?: { data_collection?: string } };
const textOf = (message: ChatMessage) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content));

let channelId: string;
let conversation: typeof conversations.$inferSelect;

/** `count` messages, customer and AI in turns, one minute apart from T0: «Mensaje 1», «Mensaje 2»… */
async function history(count: number) {
  for (let index = 1; index <= count; index++) {
    const fromCustomer = index % 2 === 1;
    await createMessage(conversation, {
      direction: fromCustomer ? "inbound" : "outbound",
      senderType: fromCustomer ? "contact" : "ai",
      agentName: fromCustomer ? null : "Recepción",
      status: fromCustomer ? "received" : "sent",
      text: `Mensaje ${index}`,
      createdAt: new Date(T0.getTime() + index * 60_000),
    });
  }
}

const row = async () => (await db.select().from(conversations).where(eq(conversations.id, conversation.id)))[0];
const summaryJobs = () => db.select().from(jobs).where(eq(jobs.type, SUMMARY_JOB));

beforeEach(async () => {
  for (const table of [notifications, handoffEvents, auditLog, aiRuns, messages, conversations, contactIdentities, contacts, jobs, realtimeEvents, appKv]) {
    await db.delete(table);
  }
  await db.update(channels).set({ activeAgentId: null });
  await db.delete(channels);
  await db.delete(agents);
  await db.delete(businessHours);
  await createBusiness({ timezone: "Europe/Madrid" });
  await ensureSettingsRows();
  await db.update(integrationSettings).set({ zdr: false });
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
  const agent = await createAgentRow({ name: "Recepción" });
  channelId = (await createChannel({ type: "webchat", name: "Web", activeAgentId: agent.id })).id;
  const { contact } = await createContactWithIdentity("webchat", { name: "Ana", externalId: "visitor-ana" });
  conversation = await createConversation(channelId, contact.id);
});

afterEach(() => vi.unstubAllEnvs());

describe("running summary of long conversations [MOT-13]", () => {
  it("a short conversation needs no summary", async () => {
    await history(20 + SUMMARY_BATCH - 1);
    expect(await scheduleSummaryIfNeeded(conversation.id)).toBe(false);
    expect(await summaryJobs()).toHaveLength(0);
  });

  it("once enough messages fall out of the window they are folded into the summary, privately and on record", async () => {
    await history(20 + SUMMARY_BATCH);
    expect(await scheduleSummaryIfNeeded(conversation.id)).toBe(true);
    expect(await summaryJobs()).toHaveLength(1);

    const fake = openRouter();
    expect(await processSummaryJob({ conversationId: conversation.id }, { fetchImpl: fake.fetch })).toBe("updated");
    const [call] = chatCalls(fake);
    const request = bodyOf(call);
    const asked = textOf(request.messages[1]);
    // The ten oldest, and none of the twenty the model still reads.
    expect(asked).toContain("[Cliente] Mensaje 1\n[IA (Recepción)] Mensaje 2");
    expect(asked).toContain("Mensaje 10\n</mensajes>");
    expect(asked).not.toContain("Mensaje 11");
    expect(request.session_id).toBe(conversation.id);
    expect(request.provider?.data_collection).toBe("deny");

    const updated = await row();
    expect(updated.summary).toBe(SUMMARY);
    expect(updated.metadata.summaryUntil).toBe(new Date(T0.getTime() + 10 * 60_000).toISOString());
    expect((await db.select({ kind: aiRuns.kind }).from(aiRuns)).map((run) => run.kind)).toEqual(["summary"]);
    // Up to date: nothing more to fold in.
    expect(await scheduleSummaryIfNeeded(conversation.id)).toBe(false);
  });

  it("a summary with a NUL character (or half a surrogate pair) is saved without it", async () => {
    await history(20 + SUMMARY_BATCH);
    const fake = fakeFetch(
      routes({
        "GET /models/user": () => jsonResponse({ data: sampleCatalog() }),
        "POST /chat/completions": () => jsonResponse(chatCompletion({ content: "Ana\u0000 quiere mechas\ud800." })),
      }),
    );
    expect(await processSummaryJob({ conversationId: conversation.id }, { fetchImpl: fake.fetch })).toBe("updated");
    expect((await row()).summary).toBe("Ana quiere mechas�.");
  });

  it("the next reply reads the summary instead of the folded messages", async () => {
    await history(20 + SUMMARY_BATCH);
    const fake = openRouter();
    await processSummaryJob({ conversationId: conversation.id }, { fetchImpl: fake.fetch });

    const channel = (await db.select().from(channels).where(eq(channels.id, channelId)))[0];
    const at = new Date(T0.getTime() + 60 * 60_000);
    await ingestEvents(
      channel,
      [{ kind: "inbound_message", externalId: crypto.randomUUID(), sender: { externalIds: ["visitor-ana"] }, contentType: "text", text: "¿Me lo reservas?", sentAt: at }],
      { now: at },
    );
    const [job] = await db.select().from(jobs).where(and(eq(jobs.type, REPLY_JOB), eq(jobs.status, "pending")));
    const ctx = { job, rescheduleAt: () => undefined, remainingMs: () => 120_000 };
    expect((await processReplyJob(replyJobPayload.parse(job.payload), ctx, { fetchImpl: fake.fetch, now: new Date(at.getTime() + 5_000), retryDelayMs: 0 })).kind).toBe("replied");

    const reply = bodyOf(chatCalls(fake).at(-1) as FakeCall);
    expect(textOf(reply.messages[0])).toContain("## Resumen de la conversación anterior");
    expect(textOf(reply.messages[0])).toContain(`> ${SUMMARY}`);
    const said = reply.messages.slice(1).map(textOf).join("\n");
    expect(said).not.toMatch(/Mensaje (1|2|10)\b/);
    expect(said).toContain("Mensaje 11");
    expect(said).toContain("¿Me lo reservas?");
    expect(reply.messages.length - 1).toBeLessThanOrEqual(REPLY_HISTORY_MESSAGES);
  });

  it("without an OpenRouter key nothing is sent and the conversation keeps going without a summary [ARR-14]", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    await history(20 + SUMMARY_BATCH);
    const fake = openRouter();
    expect(await processSummaryJob({ conversationId: conversation.id }, { fetchImpl: fake.fetch })).toBe("no_key");
    expect(fake.calls).toHaveLength(0);
    expect((await row()).summary).toBeNull();
  });
});
