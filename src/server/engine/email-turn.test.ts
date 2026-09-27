// Email turns of the reply engine: a sender the receiving server did not vouch for — or someone other than the
// conversation's contact writing in its thread — gets no tools on existing bookings or contact data that turn, and the
// AI is told to offer a person ([COR-25], [HER-04], [PER-08]); the opt-out that counts is the one of whoever the reply
// goes to ([CUM-03]); and the daily caps are checked again right before sending ([COR-17]). Real ingest pipeline, a
// fake OpenRouter and an email adapter that only records what would leave.
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSettingsRows } from "@/data/settings";
import { db } from "@/db";
import {
  agents,
  aiRuns,
  appKv,
  auditLog,
  channels,
  consents,
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
import { imapAdapter } from "@/server/channels/email/adapter";
import { CAP_REASON_SENDER } from "@/server/channels/email/caps";
import { ingestInboundEmail } from "@/server/channels/email/ingest";
import { parseRawEmail } from "@/server/channels/email/parse";
import { buildRawEmail, verifiedEmail } from "@/server/channels/email/test-helpers";
import { registerChannelAdapter } from "@/server/channels/registry";
import type { ChannelAdapter, ChannelRecord, OutboundMessage } from "@/server/channels/types";
import { chatCompletion, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog, type FakeCall, type FakeHandler } from "@/test/fake-openrouter";
import { createAgentRow, createBusiness, createChannel, createConversation } from "@/test/factories";
import { SENDER_CHECKED_TOOLS, UNVERIFIED_SENDER_NOTE } from "./email-sender";
import { processReplyJob } from "./reply";
import { REPLY_JOB, replyJobPayload } from "./schedule";

const NOW = new Date("2026-09-30T09:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const OWN = "hola@negocio.test";
const ALL_TOOLS = ["transferir_a_humano", "listar_servicios", "consultar_disponibilidad", "crear_cita", "ver_citas_del_cliente", "cancelar_cita", "reprogramar_cita", "guardar_datos_contacto"];

const leaving: OutboundMessage[] = [];
const recordingMailbox: ChannelAdapter = {
  type: "email_imap",
  capabilities: () => ({ audio: true, images: true, documents: true, templates: false, window24h: false, typing: false, readReceipts: false, html: true, drafts: true }),
  validateAndConnect: async () => ({ ok: true }),
  healthCheck: async () => ({ checkedAt: NOW.toISOString(), checks: [] }),
  handleWebhook: async () => [],
  send: async (_channel, message) => {
    leaving.push(message);
    return { externalId: `<${message.messageId}@negocio.test>`, status: "sent" };
  },
  downloadMedia: async () => ({ bytes: new Uint8Array(), mimeType: "text/plain" }),
  disconnect: async () => {},
};

let chatHandler: FakeHandler = () => jsonResponse(chatCompletion({ content: "Hola, te ayudo con eso." }));
const openRouter = fakeFetch(routes({ "GET /models/user": () => jsonResponse({ data: sampleCatalog() }), "POST /chat/completions": (call) => chatHandler(call) }));
const chatCalls = () => openRouter.calls.filter((call) => call.path === "/chat/completions");
const toolsOffered = (call: FakeCall) => ((call.body as { tools?: { function: { name: string } }[] }).tools ?? []).map((tool) => tool.function.name);
const systemPrompt = (call: FakeCall) => (call.body as { messages: { role: string; content: string }[] }).messages[0].content;

let channel: ChannelRecord;

async function receive(raw: Buffer, threadId: string, when = NOW) {
  const email = { providerId: `p-${crypto.randomUUID()}`, threadId, parsed: await parseRawEmail(raw), receivedAt: when };
  const outcome = await ingestInboundEmail(channel, email, { now: when });
  if (outcome.kind !== "ingested") throw new Error("El correo no se ha guardado");
  return outcome.conversationId;
}

async function runReply(conversationId: string, when = at(10_000)) {
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, REPLY_JOB), eq(jobs.status, "pending"), eq(jobs.dedupeKey, `reply:${conversationId}`)));
  const context = { job, rescheduleAt: () => undefined, remainingMs: () => 120_000 };
  return processReplyJob(replyJobPayload.parse(job.payload), context, { fetchImpl: openRouter.fetch, now: when, retryDelayMs: 0 });
}

const contactOf = async (address: string) =>
  (await db.select({ contactId: contactIdentities.contactId }).from(contactIdentities).where(eq(contactIdentities.externalId, address)))[0]?.contactId ?? null;

async function optOut(address: string) {
  const contactId = await contactOf(address);
  if (!contactId) throw new Error("Contacto no encontrado");
  await db.insert(consents).values({ contactId, channelId: channel.id, channelType: "email_imap", type: "opt_out", source: "keyword", createdAt: NOW, updatedAt: NOW });
}

beforeEach(async () => {
  for (const table of [notifications, handoffEvents, aiRuns, messages, conversations, consents, contactIdentities, contacts, jobs, realtimeEvents, appKv, auditLog]) await db.delete(table);
  await db.update(channels).set({ activeAgentId: null });
  await db.delete(channels);
  await db.delete(agents);
  await createBusiness({ name: "Peluquería Lola", timezone: "Europe/Madrid" });
  await ensureSettingsRows();
  await db.update(integrationSettings).set({ zdr: false });
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
  openRouter.calls.length = 0;
  leaving.length = 0;
  chatHandler = () => jsonResponse(chatCompletion({ content: "Hola, te ayudo con eso." }));
  registerChannelAdapter(recordingMailbox);
  const agent = await createAgentRow({ name: "Recepción", systemTools: ALL_TOOLS });
  channel = await createChannel({ type: "email_imap", name: "Correo", status: "connected", replyMode: "auto", activeAgentId: agent.id, config: { emailAddress: OWN } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  registerChannelAdapter(imapAdapter);
});

describe("[COR-25] a sender the receiving server did not vouch for", () => {
  it("gets no tools on existing bookings or contact data that turn, and the AI is told to offer a person", async () => {
    const conversationId = await receive(await buildRawEmail({ to: OWN, text: "Cancela mi cita del jueves, por favor." }), "hilo-1");
    expect(await runReply(conversationId)).toMatchObject({ kind: "replied" });
    const [call] = chatCalls();
    const offered = toolsOffered(call);
    for (const tool of SENDER_CHECKED_TOOLS) expect(offered).not.toContain(tool);
    expect(offered).toEqual(expect.arrayContaining(["transferir_a_humano", "crear_cita", "consultar_disponibilidad"]));
    expect(systemPrompt(call)).toContain(UNVERIFIED_SENDER_NOTE);
    // It may still answer general questions.
    expect(leaving).toHaveLength(1);
  });

  it("a verified sender gets every tool of the agent", async () => {
    const conversationId = await receive(await verifiedEmail({ to: OWN, text: "¿Qué citas tengo?" }), "hilo-2");
    await runReply(conversationId);
    const [call] = chatCalls();
    expect(toolsOffered(call)).toEqual(expect.arrayContaining(ALL_TOOLS));
    expect(systemPrompt(call)).not.toContain(UNVERIFIED_SENDER_NOTE);
  });

  it("[HER-04] someone else writing in the contact's thread, even verified, cannot act on the contact's bookings", async () => {
    const conversationId = await receive(await verifiedEmail({ to: OWN, messageId: "<a1@cliente.test>" }), "hilo-3");
    // A person of the team answers; then someone copied in the thread writes: same conversation, another contact.
    await db.insert(messages).values({ conversationId, channelId: channel.id, direction: "outbound", senderType: "human", status: "sent", text: "Hola Ana", createdAt: at(1_000), updatedAt: at(1_000) });
    await receive(await verifiedEmail({ to: OWN, from: "luis@otro.test", messageId: "<b1@otro.test>", inReplyTo: "<a1@cliente.test>", text: "Anula la cita de Ana." }), "hilo-3", at(2_000));
    await runReply(conversationId, at(12_000));
    const [call] = chatCalls();
    for (const tool of SENDER_CHECKED_TOOLS) expect(toolsOffered(call)).not.toContain(tool);
    expect(systemPrompt(call)).toContain(UNVERIFIED_SENDER_NOTE);
  });
});

describe("[CUM-03] the opt-out of whoever the reply goes to", () => {
  it("someone who opted out writes in another contact's thread: the AI stays quiet", async () => {
    const conversationId = await receive(await verifiedEmail({ to: OWN, messageId: "<a2@cliente.test>" }), "hilo-4");
    await db.insert(messages).values({ conversationId, channelId: channel.id, direction: "outbound", senderType: "human", status: "sent", text: "Hola", createdAt: at(1_000), updatedAt: at(1_000) });
    await receive(await verifiedEmail({ to: OWN, from: "luis@otro.test", messageId: "<b2@otro.test>", inReplyTo: "<a2@cliente.test>" }), "hilo-4", at(2_000));
    await optOut("luis@otro.test");
    expect(await runReply(conversationId, at(12_000))).toEqual({ kind: "skipped", reason: "opted_out" });
    expect(chatCalls()).toHaveLength(0);
    expect(leaving).toHaveLength(0);
  });

  it("the contact of the thread opted out, but the one who writes now did not: the AI answers them", async () => {
    const conversationId = await receive(await verifiedEmail({ to: OWN, messageId: "<a3@cliente.test>" }), "hilo-5");
    await optOut("ana@cliente.test");
    await db.insert(messages).values({ conversationId, channelId: channel.id, direction: "outbound", senderType: "human", status: "sent", text: "Hola", createdAt: at(1_000), updatedAt: at(1_000) });
    await receive(await verifiedEmail({ to: OWN, from: "luis@otro.test", messageId: "<b3@otro.test>", inReplyTo: "<a3@cliente.test>" }), "hilo-5", at(2_000));
    expect(await runReply(conversationId, at(12_000))).toMatchObject({ kind: "replied" });
    expect(leaving).toHaveLength(1);
  });
});

describe("[COR-17] the daily caps, checked again by the reply job", () => {
  async function secondThreadOfAna() {
    const contactId = await contactOf("ana@cliente.test");
    return createConversation(channel.id, contactId, { externalThreadId: "hilo-otro" });
  }

  it("reached before the model is called (another thread of the same sender): nothing is asked nor sent, and the conversation waits", async () => {
    await db.update(channels).set({ config: { emailAddress: OWN, dailyCapPerSender: 1 } }).where(eq(channels.id, channel.id));
    [channel] = await db.select().from(channels).where(eq(channels.id, channel.id));
    const conversationId = await receive(await verifiedEmail({ to: OWN }), "hilo-6");
    const other = await secondThreadOfAna();
    await db.insert(messages).values({ conversationId: other.id, channelId: channel.id, direction: "outbound", senderType: "ai", status: "sent", text: "Hola", createdAt: at(1_000), updatedAt: at(1_000) });
    expect(await runReply(conversationId)).toEqual({ kind: "skipped", reason: "paused" });
    expect(chatCalls()).toHaveLength(0);
    expect(leaving).toHaveLength(0);
    expect((await db.select().from(conversations).where(eq(conversations.id, conversationId)))[0].pauseReason).toBe(CAP_REASON_SENDER);
  });

  it("reached while the model was answering: the reply is not sent", async () => {
    await db.update(channels).set({ config: { emailAddress: OWN, dailyCapPerSender: 1 } }).where(eq(channels.id, channel.id));
    [channel] = await db.select().from(channels).where(eq(channels.id, channel.id));
    const conversationId = await receive(await verifiedEmail({ to: OWN }), "hilo-7");
    const other = await secondThreadOfAna();
    chatHandler = async () => {
      // Another reply to the same sender went out meanwhile.
      await db.insert(messages).values({ conversationId: other.id, channelId: channel.id, direction: "outbound", senderType: "ai", status: "sent", text: "Hola", createdAt: at(5_000), updatedAt: at(5_000) });
      return jsonResponse(chatCompletion({ content: "Hola, te ayudo con eso." }));
    };
    expect(await runReply(conversationId)).toEqual({ kind: "skipped", reason: "paused" });
    expect(chatCalls()).toHaveLength(1);
    expect(leaving).toHaveLength(0);
    expect(await db.select().from(messages).where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "outbound")))).toHaveLength(0);
    expect((await db.select().from(conversations).where(eq(conversations.id, conversationId)))[0].pauseReason).toBe(CAP_REASON_SENDER);
  });
});
