// [WA-46] When an AI reply fails for good — the send itself, or later with Meta's «fallido» status — the message stays
// «fallido» and, if the channel has «Pasar a una persona si falla un envío» on, the conversation goes to a person;
// otherwise the team is told. The engine, the ingest pipeline and the hand-off are real; the channel adapter is a fake.
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSettingsRows } from "@/data/settings";
import { db } from "@/db";
import { agents, aiRuns, appKv, auditLog, channels, contactIdentities, contacts, conversations, handoffEvents, integrationSettings, jobs, messages, notifications, realtimeEvents } from "@/db/schema";
import { registerChannelAdapter, unregisterChannelAdapter } from "@/server/channels/registry";
import { ChannelSendError, type ChannelRecord } from "@/server/channels/types";
import { applyWhatsAppStatuses } from "@/server/channels/whatsapp/statuses";
import { ingestEvents } from "@/server/inbound/ingest";
import { chatCompletion, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog } from "@/test/fake-openrouter";
import { createAgentRow, createBusiness, createChannel, createUser, type TestUser } from "@/test/factories";
import { processReplyJob } from "./reply";
import { REPLY_JOB, replyJobPayload, type ReplyJobPayload } from "./schedule";

const NOW = new Date("2026-09-30T09:00:00Z");
const PERMANENT = new ChannelSendError("Meta no puede entregar este mensaje.", false, 131026);

let owner: TestUser;
let channel: ChannelRecord;
let sends = 0;

/** A WhatsApp channel whose sends Meta refuses for good. */
function refusingWhatsApp() {
  registerChannelAdapter({
    type: "whatsapp",
    capabilities: () => ({ audio: false, images: false, documents: false, templates: false, window24h: false, typing: false, readReceipts: false, html: false, drafts: false }),
    validateAndConnect: async () => ({ ok: true }),
    healthCheck: async () => ({ checkedAt: NOW.toISOString(), checks: [] }),
    handleWebhook: async () => [],
    send: async () => {
      sends++;
      throw PERMANENT;
    },
    downloadMedia: async () => ({ bytes: new Uint8Array(), mimeType: "text/plain" }),
    disconnect: async () => {},
  });
}

async function setup(handoffOnSendFailure: boolean) {
  const agent = await createAgentRow({ name: "Recepción" });
  channel = await createChannel({ type: "whatsapp", name: "WhatsApp", activeAgentId: agent.id, config: { handoffOnSendFailure } });
}

/** «Hola» from a customer through the real ingest, and the AI's turn run with a fake OpenRouter. */
async function customerWritesAndAiAnswers(): Promise<string> {
  const [message] = (
    await ingestEvents(channel, [{ kind: "inbound_message", externalId: crypto.randomUUID(), sender: { externalIds: ["ES.bsuid-46"], displayName: "Ana" }, contentType: "text", text: "Hola", sentAt: new Date(NOW.getTime() - 5_000) }], {
      now: new Date(NOW.getTime() - 5_000),
    })
  ).messages;
  const conversationId = message.conversationId ?? "";
  const [job] = await db.select().from(jobs).where(and(eq(jobs.type, REPLY_JOB), eq(jobs.status, "pending"), eq(jobs.dedupeKey, `reply:${conversationId}`)));
  const openRouter = fakeFetch(routes({ "GET /models/user": () => jsonResponse({ data: sampleCatalog() }), "POST /chat/completions": () => jsonResponse(chatCompletion({ content: "¡Hola! ¿En qué te ayudo?" })) }));
  const context = { job, rescheduleAt: () => undefined, remainingMs: () => 120_000 };
  await processReplyJob(replyJobPayload.parse(job.payload) as ReplyJobPayload, context, { fetchImpl: openRouter.fetch, now: NOW, retryDelayMs: 0 });
  return conversationId;
}

const conversationOf = async (id: string) => (await db.select().from(conversations).where(eq(conversations.id, id)))[0];
const aiMessagesOf = (conversationId: string) =>
  db.select().from(messages).where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "outbound"))).orderBy(asc(messages.createdAt));

beforeEach(async () => {
  for (const table of [notifications, handoffEvents, aiRuns, messages, conversations, contactIdentities, contacts, jobs, realtimeEvents, appKv, auditLog]) await db.delete(table);
  await db.update(channels).set({ activeAgentId: null });
  await db.delete(channels);
  await db.delete(agents);
  await createBusiness({ name: "Peluquería Lola", timezone: "Europe/Madrid" });
  await ensureSettingsRows();
  await db.update(integrationSettings).set({ zdr: false });
  owner = await createUser("owner");
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
  sends = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  unregisterChannelAdapter("whatsapp");
});

describe("hand-off after a failed AI reply [WA-46]", () => {
  it("a send Meta refuses for good is not retried, stays «fallido» and, with the switch on, a person takes the conversation", async () => {
    refusingWhatsApp();
    await setup(true);
    const conversationId = await customerWritesAndAiAnswers();
    expect(sends).toBe(1);
    const [failed] = await aiMessagesOf(conversationId);
    expect(failed).toMatchObject({ senderType: "ai", status: "failed", error: { code: 131026, message: "Meta no puede entregar este mensaje." } });
    expect(await conversationOf(conversationId)).toMatchObject({ status: "pending_human", aiMode: "human" });
    const [handoff] = await db.select().from(handoffEvents).where(eq(handoffEvents.conversationId, conversationId));
    expect(handoff).toMatchObject({ trigger: "rule", rule: "send_failed" });
    expect(handoff.reason).toContain("Meta no puede entregar este mensaje.");
    // Nothing else tries to reach the customer through a channel that is failing.
    expect(sends).toBe(1);
  });

  it("with the switch off the conversation stays with the AI and the owner and admins are told", async () => {
    refusingWhatsApp();
    await setup(false);
    const conversationId = await customerWritesAndAiAnswers();
    expect(await conversationOf(conversationId)).toMatchObject({ status: "open" });
    expect(await db.select().from(handoffEvents)).toEqual([]);
    expect((await db.select().from(notifications).where(eq(notifications.userId, owner.userId))).map((notice) => notice.event)).toContain("channel_error");
  });

  it("an AI reply that Meta later reports as «fallido» also goes to a person with the switch on", async () => {
    await setup(true);
    const agentId = channel.activeAgentId;
    const [received] = (
      await ingestEvents(channel, [{ kind: "inbound_message", externalId: crypto.randomUUID(), sender: { externalIds: ["ES.bsuid-47"], displayName: "Luis" }, contentType: "text", text: "Hola", sentAt: NOW }], { now: NOW })
    ).messages;
    const conversationId = received.conversationId ?? "";
    await db.insert(messages).values({ conversationId, channelId: channel.id, direction: "outbound", senderType: "ai", agentId, status: "sent", text: "¡Hola!", externalId: "wamid.FALLIDO_46" });
    await applyWhatsAppStatuses(channel, [{ kind: "status_update", externalId: "wamid.FALLIDO_46", status: "failed", at: NOW, error: { code: 131026, message: "Mensaje no entregable." } }], NOW);
    expect(await conversationOf(conversationId)).toMatchObject({ status: "pending_human" });
    const [handoff] = await db.select().from(handoffEvents).where(eq(handoffEvents.conversationId, conversationId));
    expect(handoff).toMatchObject({ trigger: "rule", rule: "send_failed" });
  });
});
