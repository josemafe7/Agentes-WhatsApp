// Bajas ([CUM-03], [CUM-04], [CUM-13], [CTO-08]) end to end through the real pieces: the ingest pipeline opts out a
// customer who writes only «BAJA» or «STOP» (by email, the first line of the body alone, from its sender) and queues ONE
// confirmation; from then on only a person reaches them in that channel — never the AI, an approved AI draft, a notice
// of the platform or a retry of those — until a person lifts it. The channel is a WhatsApp number whose adapter only
// records what would leave.
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liftOptOut } from "@/data/consents";
import { approveDraft, sendHumanMessage } from "@/data/messages";
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
import { PgJobQueue } from "@/server/adapters/job-queue";
import { ingestInboundEmail } from "@/server/channels/email/ingest";
import { parseRawEmail } from "@/server/channels/email/parse";
import { buildRawEmail, type RawEmailInput } from "@/server/channels/email/test-helpers";
import { registerChannelAdapter, unregisterChannelAdapter } from "@/server/channels/registry";
import type { ChannelAdapter, ChannelRecord, OutboundMessage } from "@/server/channels/types";
import { processReplyJob } from "@/server/engine/reply";
import { REPLY_JOB, replyJobPayload } from "@/server/engine/schedule";
import { ingestEvents } from "@/server/inbound/ingest";
import { tick } from "@/server/jobs/tick";
import { resendOutbound, sendOutbound } from "@/server/outbound/send";
import { chatCompletion, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog } from "@/test/fake-openrouter";
import { createAgentRow, createBusiness, createChannel, createMessage, createUser, type TestUser } from "@/test/factories";
import {
  isOptedOut,
  isOptOutKeyword,
  OPT_OUT_CONFIRMATION_JOB,
  OPT_OUT_CONFIRMATION_TEXT,
  OPTED_OUT_SEND_ERROR,
  optOutConfirmationPayload,
} from "./opt-out";
import { sendOptOutConfirmation } from "./opt-out-confirmation";

const NOW = new Date("2026-09-30T09:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const CUSTOMER = "ES.10000000000000000001";

const leaving: OutboundMessage[] = [];
const recordingWhatsApp: ChannelAdapter = {
  type: "whatsapp",
  capabilities: () => ({ audio: true, images: true, documents: true, templates: true, window24h: true, typing: false, readReceipts: false, html: false, drafts: false }),
  validateAndConnect: async () => ({ ok: true }),
  healthCheck: async () => ({ checkedAt: NOW.toISOString(), checks: [] }),
  handleWebhook: async () => [],
  send: async (_channel, message) => {
    leaving.push(message);
    return { externalId: `wamid.${message.messageId}`, status: "sent" };
  },
  downloadMedia: async () => ({ bytes: new Uint8Array(), mimeType: "text/plain" }),
  disconnect: async () => {},
};

const openRouter = fakeFetch(
  routes({
    "GET /models/user": () => jsonResponse({ data: sampleCatalog() }),
    "POST /chat/completions": () => jsonResponse(chatCompletion({ content: "No debería salir." })),
  }),
);
const chatCalls = () => openRouter.calls.filter((call) => call.path === "/chat/completions").length;

let channel: ChannelRecord;
let owner: TestUser;

/** A customer's WhatsApp text through the real ingest pipeline. */
async function receive(text: string, options: { when?: Date; to?: ChannelRecord } = {}) {
  const when = options.when ?? NOW;
  const result = await ingestEvents(
    options.to ?? channel,
    [{ kind: "inbound_message", externalId: `wamid.${crypto.randomUUID()}`, sender: { externalIds: [CUSTOMER], phone: "34600111222", displayName: "Ana" }, contentType: "text", text, sentAt: when }],
    { now: when },
  );
  const [message] = result.messages;
  return { result, conversationId: message.conversationId ?? "", contactId: message.contactId ?? "" };
}

const confirmationJobs = () => db.select().from(jobs).where(eq(jobs.type, OPT_OUT_CONFIRMATION_JOB));
const outboundOf = (conversationId: string) =>
  db.select().from(messages).where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "outbound"))).orderBy(asc(messages.createdAt));
const conversationRow = async (id: string) => (await db.select().from(conversations).where(eq(conversations.id, id)))[0];

async function confirm(): Promise<void> {
  const [job] = await confirmationJobs();
  await sendOptOutConfirmation(optOutConfirmationPayload.parse(job.payload), { now: at(1_000), retryDelayMs: 0 });
}

async function runReply(conversationId: string, when: Date) {
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, REPLY_JOB), eq(jobs.status, "pending"), eq(jobs.dedupeKey, `reply:${conversationId}`)));
  const context = { job, rescheduleAt: () => undefined, remainingMs: () => 120_000 };
  return processReplyJob(replyJobPayload.parse(job.payload), context, { fetchImpl: openRouter.fetch, now: when, retryDelayMs: 0 });
}

beforeEach(async () => {
  for (const table of [notifications, handoffEvents, aiRuns, messages, conversations, consents, contactIdentities, contacts, jobs, realtimeEvents, appKv, auditLog]) {
    await db.delete(table);
  }
  await db.update(channels).set({ activeAgentId: null });
  await db.delete(channels);
  await db.delete(agents);
  await createBusiness({ name: "Peluquería Lola", timezone: "Europe/Madrid" });
  await ensureSettingsRows();
  await db.update(integrationSettings).set({ zdr: false });
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
  openRouter.calls.length = 0;
  leaving.length = 0;
  registerChannelAdapter(recordingWhatsApp);
  const agent = await createAgentRow({ name: "Recepción" });
  channel = await createChannel({ type: "whatsapp", name: "WhatsApp Lola", status: "connected", isDemo: false, activeAgentId: agent.id });
  owner = await createUser("owner", { name: "Olga" });
  // Only Date is faked (a person's reply uses the time of the request): timers and the database run normally.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at(5_000));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  unregisterChannelAdapter("whatsapp");
});

describe("«BAJA» or «STOP», and nothing else, is an opt-out [CUM-03]", () => {
  it.each(["BAJA", "baja", "Baja.", "¡¡BAJA!!", "  stop  ", "STOP 🙏", "Bája", "ＢＡＪＡ", "«Baja»", "baja\n"])("«%s» is one", (text) => {
    expect(isOptOutKeyword(text)).toBe(true);
  });

  it.each(["BAJA por favor", "Quiero darme de baja", "stop spam", "B A J A", "bajas", "stopp", "", "   ", null, undefined])("«%s» is not", (text) => {
    expect(isOptOutKeyword(text)).toBe(false);
  });
});

describe("the customer opts out by writing it [CUM-03] [CUM-13]", () => {
  it("the opt-out goes into the contact's consents with its date and channel, and ONE confirmation is queued instead of an AI reply", async () => {
    const { result, contactId } = await receive("¡Baja!");
    const [consent] = await db.select().from(consents);
    expect(consent).toMatchObject({ contactId, channelId: channel.id, channelType: "whatsapp", type: "opt_out", source: "keyword", createdAt: NOW });
    expect(await isOptedOut(contactId, channel.id)).toBe(true);

    const queued = await db.select().from(jobs);
    expect(queued.map((job) => job.type)).toEqual([OPT_OUT_CONFIRMATION_JOB]);
    // Due at once: the route that received the message runs the queue for it, as for a reply.
    expect(result.replyRunAt).toEqual(queued[0].runAt);

    // The activity log says it happened, without anything personal.
    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({ actorType: "system", action: "consent.opted_out", targetType: "contact", targetId: contactId });
    expect(entry.metadata).toEqual({ channelId: channel.id, source: "keyword" });
  });

  it("the customer gets one confirmation through the channel, even if its job runs twice", async () => {
    const { conversationId } = await receive("STOP");
    await confirm();
    await confirm();
    expect(leaving.map((message) => message.text)).toEqual([OPT_OUT_CONFIRMATION_TEXT]);
    const outbound = await outboundOf(conversationId);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]).toMatchObject({ senderType: "system", status: "sent", text: OPT_OUT_CONFIRMATION_TEXT });
  });

  it("the queue runs the confirmation job on its own", async () => {
    const { conversationId } = await receive("baja");
    const summary = await tick({ budgetMs: 30_000, queue: new PgJobQueue({ now: () => at(5_000) }) });
    expect(summary.completed).toBe(1);
    expect((await outboundOf(conversationId)).map((message) => message.text)).toEqual([OPT_OUT_CONFIRMATION_TEXT]);
    expect(leaving).toHaveLength(1);
  });

  it("writing it again while opted out records nothing new and sends no second confirmation; it waits for a person [CUM-04]", async () => {
    const { conversationId, contactId } = await receive("BAJA");
    await confirm();
    await receive("BAJA", { when: at(60_000) });
    expect(await db.select().from(consents)).toHaveLength(1);
    expect(await confirmationJobs()).toHaveLength(1);
    expect(await runReply(conversationId, at(70_000))).toEqual({ kind: "skipped", reason: "opted_out" });
    expect(leaving).toHaveLength(1);
    expect(await isOptedOut(contactId, channel.id)).toBe(true);
  });

  it("a message that only talks about it is an ordinary message", async () => {
    await receive("Quiero darme de baja de las promociones, pero no de las citas");
    expect(await db.select().from(consents)).toHaveLength(0);
    expect((await db.select().from(jobs)).map((job) => job.type)).toEqual([REPLY_JOB]);
  });

  it("no confirmation once a person lifted it, nor from a disabled channel [CAN-16]", async () => {
    const lifted = await receive("BAJA");
    await liftOptOut(owner.actor, { contactId: lifted.contactId, channelId: channel.id });
    await confirm();
    expect(leaving).toHaveLength(0);

    await db.delete(consents);
    await db.delete(jobs);
    await receive("BAJA", { when: at(60_000) });
    await db.update(channels).set({ status: "disabled" }).where(eq(channels.id, channel.id));
    await confirm();
    expect(leaving).toHaveLength(0);
  });
});

describe("only a person reaches an opted-out customer in that channel [CUM-03] [CUM-04]", () => {
  it("the AI does not answer: the new message waits in the inbox for a person", async () => {
    const { conversationId } = await receive("BAJA");
    await receive("Hola, ¿abrís mañana?", { when: at(60_000) });
    expect(await runReply(conversationId, at(70_000))).toEqual({ kind: "skipped", reason: "opted_out" });
    expect(chatCalls()).toBe(0);
    expect(await outboundOf(conversationId)).toHaveLength(0);
    expect((await conversationRow(conversationId)).unreadCount).toBe(2);
  });

  it("[CUM-04] a person can still answer them: the message reaches the customer, like any reply", async () => {
    const { conversationId } = await receive("BAJA");
    const sent = await sendHumanMessage(owner.actor, { conversationId, text: "¡Hola Ana! ¿Seguro?" });
    expect(sent).toMatchObject({ status: "sent", error: null });
    expect(leaving.map((message) => message.text)).toEqual(["¡Hola Ana! ¿Seguro?"]);
    expect((await outboundOf(conversationId)).map((message) => message.senderType)).toEqual(["human"]);
  });

  it("approving a draft of the AI is refused too, and the draft stays", async () => {
    const { conversationId } = await receive("Hola, ¿tenéis hueco?");
    const draft = await createMessage({ id: conversationId, channelId: channel.id }, { direction: "outbound", senderType: "ai", status: "draft", text: "Sí, mañana a las 10." });
    await receive("BAJA", { when: at(60_000) });
    await expect(approveDraft(owner.actor, { messageId: draft.id })).rejects.toMatchObject({ status: 409, userMessage: OPTED_OUT_SEND_ERROR });
    expect((await db.select().from(messages).where(eq(messages.id, draft.id)))[0].status).toBe("draft");
    expect(leaving).toHaveLength(0);
  });

  it("what the platform sends on its own (a notice, the AI) stays in the conversation as not sent, with the reason", async () => {
    const { conversationId } = await receive("BAJA");
    const before = await conversationRow(conversationId);
    const notice = await sendOutbound({ conversationId, sender: { type: "system" }, text: "Tu cita del jueves se ha movido a las 11:00.", now: at(60_000), retryDelayMs: 0 });
    const reply = await sendOutbound({ conversationId, sender: { type: "ai", agentId: channel.activeAgentId ?? "", agentName: "Recepción" }, text: "Hola", now: at(61_000), retryDelayMs: 0 });
    for (const result of [notice, reply]) expect(result).toMatchObject({ status: "failed", error: { code: "opted_out", message: OPTED_OUT_SEND_ERROR } });
    expect(leaving).toHaveLength(0);
    expect((await conversationRow(conversationId)).lastOutboundAt).toEqual(before.lastOutboundAt);
  });

  it("«Reintentar» an AI message that failed before sends nothing while the opt-out lasts; a person's message goes [BAN-13]", async () => {
    const { conversationId } = await receive("Hola");
    const failedAi = await createMessage({ id: conversationId, channelId: channel.id }, { direction: "outbound", senderType: "ai", agentName: "Recepción", status: "failed", text: "¡Hola! Sí, abrimos." });
    const failedHuman = await createMessage({ id: conversationId, channelId: channel.id }, { direction: "outbound", senderType: "human", senderName: "Olga", status: "failed", text: "Te esperamos." });
    await receive("BAJA", { when: at(60_000) });
    expect(await resendOutbound(failedAi.id, { retryDelayMs: 0 })).toMatchObject({ status: "failed", error: { code: "opted_out", message: OPTED_OUT_SEND_ERROR } });
    expect(await resendOutbound(failedHuman.id, { retryDelayMs: 0 })).toMatchObject({ status: "sent", error: null });
    expect(leaving.map((message) => message.text)).toEqual(["Te esperamos."]);
  });

  it("only in that channel: the same customer still gets messages in another one", async () => {
    await receive("BAJA");
    const other = await createChannel({ type: "whatsapp", name: "WhatsApp Lola 2", status: "connected", isDemo: false });
    const elsewhere = await receive("Hola, os escribo por el otro número", { to: other, when: at(60_000) });
    await sendHumanMessage(owner.actor, { conversationId: elsewhere.conversationId, text: "¡Hola Ana!" });
    expect(leaving.map((message) => message.text)).toEqual(["¡Hola Ana!"]);
  });

  it("once a person lifts it, at the customer's request, the business can write again [CTO-08]", async () => {
    const { conversationId, contactId } = await receive("BAJA");
    await liftOptOut(owner.actor, { contactId, channelId: channel.id, note: "Lo ha pedido por teléfono" });
    expect(await isOptedOut(contactId, channel.id)).toBe(false);
    await sendHumanMessage(owner.actor, { conversationId, text: "¡Hola de nuevo, Ana!" });
    expect(leaving.map((message) => message.text)).toEqual(["¡Hola de nuevo, Ana!"]);
  });
});

describe("«BAJA» or «STOP» by email: the body alone, and its sender [CUM-03]", () => {
  let mailbox: ChannelRecord;

  beforeEach(async () => {
    mailbox = await createChannel({ type: "email_imap", name: "Correo Lola", status: "connected", isDemo: false, config: { emailAddress: "hola@lola.test" } });
  });

  async function email(input: RawEmailInput, threadId = `t-${crypto.randomUUID()}`) {
    const parsed = await parseRawEmail(await buildRawEmail({ to: "hola@lola.test", ...input }));
    return ingestInboundEmail(mailbox, { providerId: `p-${crypto.randomUUID()}`, threadId, parsed, receivedAt: NOW }, { now: NOW });
  }

  async function optedOutByEmail(address: string): Promise<boolean> {
    const [identity] = await db.select({ contactId: contactIdentities.contactId }).from(contactIdentities).where(eq(contactIdentities.externalId, address));
    return identity ? isOptedOut(identity.contactId, mailbox.id) : false;
  }

  it("the body of a new email counts, not the subject line the app puts on top of it", async () => {
    await email({ from: "ana@cliente.test", subject: "Recordatorio de tu cita", text: "BAJA" });
    expect(await optedOutByEmail("ana@cliente.test")).toBe(true);
    expect((await db.select().from(jobs)).map((job) => job.type)).toEqual([OPT_OUT_CONFIRMATION_JOB]);
  });

  it("its first line counts, with a sign-off and the quoted email below it", async () => {
    await email({ from: "luis@cliente.test", subject: "Re: Tu cita", text: "Baja.\n\nUn saludo,\nLuis\n\nEl lun, 28 sept 2026, Peluquería Lola <hola@lola.test> escribió:\n> Te recordamos tu cita del martes." });
    expect(await optedOutByEmail("luis@cliente.test")).toBe(true);
  });

  it("a subject «BAJA» over other words, or a body that only talks about it, is not", async () => {
    await email({ from: "marta@cliente.test", subject: "BAJA", text: "¿Me dais cita el martes?" });
    await email({ from: "eva@cliente.test", subject: "Consulta", text: "Quiero darme de baja de las promociones" });
    expect(await optedOutByEmail("marta@cliente.test")).toBe(false);
    expect(await optedOutByEmail("eva@cliente.test")).toBe(false);
  });

  it("in a thread, whoever writes it opts out, not the thread's first contact", async () => {
    await email({ from: "pilar@cliente.test", messageId: "<h1@cliente.test>" }, "hilo-baja");
    await email({ from: "copia@cliente.test", subject: "Re: Consulta", inReplyTo: "<h1@cliente.test>", text: "STOP" }, "hilo-baja");
    expect(await optedOutByEmail("copia@cliente.test")).toBe(true);
    expect(await optedOutByEmail("pilar@cliente.test")).toBe(false);
  });
});
