// [IG-04] [IG-03] The AI and Instagram's 24 h window, through the reply engine on a real (non-demo) Instagram channel:
// with the window closed nothing reaches Instagram (the turn is skipped, as in WhatsApp's [WA-43]); inside it, the
// customer gets exactly one reply. Instagram is the fake of src/test/fixtures/instagram, which records every call.
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSettingsRows } from "@/data/settings";
import { db } from "@/db";
import { agents, aiRuns, appKv, auditLog, channels, contactIdentities, contacts, conversations, handoffEvents, integrationSettings, jobs, messages, notifications, realtimeEvents } from "@/db/schema";
import { createInstagramAdapter, instagramAdapter } from "@/server/channels/instagram/adapter";
import { encryptInstagramSecrets } from "@/server/channels/instagram/config";
import { registerChannelAdapter } from "@/server/channels/registry";
import type { ChannelRecord } from "@/server/channels/types";
import { ingestEvents } from "@/server/inbound/ingest";
import { chatCompletion, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog } from "@/test/fake-openrouter";
import { createAgentRow, createBusiness, createChannel } from "@/test/factories";
import { connectedAccountRoutes, fakeInstagramFetch, IG_TEST } from "@/test/fixtures/instagram";
import { processReplyJob } from "./reply";
import { REPLY_JOB, replyDedupeKey, replyJobPayload, type ReplyJobPayload } from "./schedule";

const NOW = new Date("2026-10-16T09:00:00Z");
const HOUR = 60 * 60_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

let channel: ChannelRecord;

function openRouter() {
  return fakeFetch(
    routes({
      "GET /models/user": () => jsonResponse({ data: sampleCatalog() }),
      "POST /chat/completions": () => jsonResponse(chatCompletion({ content: "¡Hola! Sí, el viernes tenemos hueco." })),
    }),
  );
}

/** A customer's message that Instagram says was written at `sentAt`, through the real ingest pipeline. */
async function receive(sentAt: Date): Promise<string> {
  const result = await ingestEvents(
    channel,
    [{ kind: "inbound_message", externalId: crypto.randomUUID(), sender: { externalIds: [IG_TEST.customer.id] }, contentType: "text", text: "Hola, ¿tenéis cita el viernes?", sentAt }],
    { now: at(-5_000) },
  );
  return result.messages[0].conversationId ?? "";
}

async function runReply(conversationId: string, fake: ReturnType<typeof openRouter>) {
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, REPLY_JOB), eq(jobs.status, "pending"), eq(jobs.dedupeKey, replyDedupeKey(conversationId))));
  const ctx = { job, rescheduleAt: () => {}, remainingMs: () => 120_000 };
  return processReplyJob(replyJobPayload.parse(job.payload) as ReplyJobPayload, ctx, { fetchImpl: fake.fetch, now: NOW, retryDelayMs: 0 });
}

const outbound = (conversationId: string) => db.select().from(messages).where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "outbound")));

beforeEach(async () => {
  for (const table of [notifications, handoffEvents, aiRuns, messages, conversations, contactIdentities, contacts, jobs, realtimeEvents, appKv, auditLog]) await db.delete(table);
  await db.delete(channels);
  await db.delete(agents);
  await createBusiness({ name: "Peluquería Lola", timezone: "Europe/Madrid", aiDisclosureText: null });
  await ensureSettingsRows();
  await db.update(integrationSettings).set({ zdr: false });
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
  const agent = await createAgentRow({ name: "Recepción" });
  channel = await createChannel({
    type: "instagram",
    name: "Instagram Peluquería",
    status: "connected",
    activeAgentId: agent.id,
    config: { accountId: IG_TEST.accountId, username: IG_TEST.username },
    secretsEnc: encryptInstagramSecrets({ accessToken: IG_TEST.accessToken, appSecret: IG_TEST.appSecret, metaAppSecret: null, verifyToken: IG_TEST.verifyToken }),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  registerChannelAdapter(instagramAdapter);
});

/** Instagram as a fake that records every call; its sends are the replies that reached the customer. */
function instagram() {
  const fake = fakeInstagramFetch(connectedAccountRoutes());
  registerChannelAdapter(createInstagramAdapter(fake.deps));
  return { sends: () => fake.calls.filter((call) => call.httpMethod === "POST" && call.route === "me/messages") };
}

describe("the AI and Instagram's 24 h window [IG-04] [IG-03]", () => {
  it("with the window closed the AI is not asked and nothing is sent to Instagram [IG-04]", async () => {
    const { sends } = instagram();
    // The customer's last message was written 25 hours ago (Instagram's timestamp).
    const conversationId = await receive(at(-25 * HOUR));
    const fake = openRouter();
    expect(await runReply(conversationId, fake)).toEqual({ kind: "skipped", reason: "window_closed" });
    expect(fake.calls.filter((call) => call.path === "/chat/completions")).toHaveLength(0);
    expect(sends()).toHaveLength(0);
    expect(await outbound(conversationId)).toHaveLength(0);
  });

  it("inside the window the customer gets exactly one reply, to their Instagram id [IG-04] [IG-03]", async () => {
    const { sends } = instagram();
    const conversationId = await receive(at(-5_000));
    expect(await runReply(conversationId, openRouter())).toMatchObject({ kind: "replied", status: "sent" });
    expect(sends()).toHaveLength(1);
    expect(sends()[0].body).toMatchObject({ recipient: { id: IG_TEST.customer.id } });
    const sent = await outbound(conversationId);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ senderType: "ai", status: "sent" });
    expect(sent[0].externalId).toMatch(/^m_/);
  });
});
