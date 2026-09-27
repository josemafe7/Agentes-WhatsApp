// The AI notice ([CUM-01], art. 50 of the EU AI Act): the first message of the AI in each conversation starts with the
// channel's notice, or else the business's default of Ajustes › Privacidad y legal, or else the platform's; and the
// AI's emails end with a signature that says an AI wrote them (and whether a person reviewed it, [COR-21]). Through
// the real reply engine and the email composer, with OpenRouter faked (src/server/engine/reply.test.ts covers the
// channel's own notice and the platform default).
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_DISCLOSURE_TEXT } from "@/data/legal-texts";
import { approveDraft, discardDraft } from "@/data/messages";
import { ensureSettingsRows } from "@/data/settings";
import { db } from "@/db";
import {
  agents,
  aiRuns,
  appKv,
  auditLog,
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
import { AI_NOTICE_AUTOMATIC, AI_NOTICE_REVIEWED } from "@/server/channels/email/signature";
import { loadReplyContext } from "@/server/channels/email/reply-context";
import type { ChannelRecord, OutboundMessage } from "@/server/channels/types";
import { processReplyJob } from "@/server/engine/reply";
import { REPLY_JOB, replyJobPayload } from "@/server/engine/schedule";
import { ingestEvents } from "@/server/inbound/ingest";
import { chatCompletion, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog, sequence, type FakeHandler } from "@/test/fake-openrouter";
import { createAgentRow, createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser } from "@/test/factories";

const NOW = new Date("2026-09-30T09:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const BUSINESS_NOTICE = "Te atiende la IA de Peluquería Lola; si prefieres a una persona, dilo.";

const reply = (content: string): FakeHandler => () => jsonResponse(chatCompletion({ content }));
const openRouter = (...answers: string[]) =>
  fakeFetch(routes({ "GET /models/user": () => jsonResponse({ data: sampleCatalog() }), "POST /chat/completions": sequence(...answers.map(reply)) }));

let agent: typeof agents.$inferSelect;

async function receive(channel: ChannelRecord, text: string, when: Date, visitor = "visitor-1"): Promise<string> {
  const result = await ingestEvents(
    channel,
    [{ kind: "inbound_message", externalId: crypto.randomUUID(), sender: { externalIds: [visitor], displayName: "Ana" }, contentType: "text", text, sentAt: when }],
    { now: when },
  );
  return result.messages[0].conversationId ?? "";
}

async function runReply(conversationId: string, fake: ReturnType<typeof openRouter>, when: Date) {
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, REPLY_JOB), eq(jobs.status, "pending"), eq(jobs.dedupeKey, `reply:${conversationId}`)));
  const context = { job, rescheduleAt: () => undefined, remainingMs: () => 120_000 };
  return processReplyJob(replyJobPayload.parse(job.payload), context, { fetchImpl: fake.fetch, now: when, retryDelayMs: 0 });
}

const aiMessagesOf = (conversationId: string) =>
  db.select().from(messages).where(and(eq(messages.conversationId, conversationId), eq(messages.senderType, "ai"))).orderBy(asc(messages.createdAt));

beforeEach(async () => {
  for (const table of [notifications, handoffEvents, aiRuns, messages, conversations, contactIdentities, contacts, jobs, realtimeEvents, appKv, auditLog]) {
    await db.delete(table);
  }
  await db.update(channels).set({ activeAgentId: null });
  await db.delete(channels);
  await db.delete(agents);
  await createBusiness({ name: "Peluquería Lola", timezone: "Europe/Madrid", aiDisclosureText: BUSINESS_NOTICE });
  await ensureSettingsRows();
  await db.update(integrationSettings).set({ zdr: false });
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
  agent = await createAgentRow({ name: "Recepción" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("the AI notice goes in front of the first AI message of each conversation [CUM-01]", () => {
  it("with the business's default notice (Ajustes › Privacidad y legal) when the channel has none, and only once", async () => {
    const web = await createChannel({ type: "webchat", name: "Web", activeAgentId: agent.id, disclosureMessage: null });
    const conversationId = await receive(web, "Hola", NOW);
    const fake = openRouter("¡Hola! ¿En qué te ayudo?", "Abrimos a las 10.");
    await runReply(conversationId, fake, at(10_000));
    await receive(web, "¿A qué hora abrís?", at(60_000));
    await runReply(conversationId, fake, at(70_000));
    expect((await aiMessagesOf(conversationId)).map((message) => message.text)).toEqual([`${BUSINESS_NOTICE}\n\n¡Hola! ¿En qué te ayudo?`, "Abrimos a las 10."]);
  });

  it("the platform's own text when neither the channel nor the business has one", async () => {
    await db.update(businessSettings).set({ aiDisclosureText: null });
    const web = await createChannel({ type: "webchat", name: "Web", activeAgentId: agent.id });
    const conversationId = await receive(web, "Hola", NOW);
    await runReply(conversationId, openRouter("¿Qué necesitas?"), at(10_000));
    expect((await aiMessagesOf(conversationId))[0].text).toBe(`${DEFAULT_AI_DISCLOSURE_TEXT}\n\n¿Qué necesitas?`);
  });

  it("every conversation gets its own notice: the same customer in another channel is told again, with that channel's text", async () => {
    const first = await createChannel({ type: "webchat", name: "Web", activeAgentId: agent.id });
    const second = await createChannel({ type: "webchat", name: "Web de la tienda", activeAgentId: agent.id, disclosureMessage: "Soy la IA de la tienda." });
    const one = await receive(first, "Hola", NOW);
    await runReply(one, openRouter("¡Hola!"), at(10_000));
    const two = await receive(second, "Hola otra vez", at(60_000));
    await runReply(two, openRouter("¡Hola de nuevo!"), at(70_000));
    expect((await aiMessagesOf(two))[0].text).toBe("Soy la IA de la tienda.\n\n¡Hola de nuevo!");
  });

  it("«Borrador para revisar»: each draft keeps the notice until one reaches the customer, so whichever is approved first carries it", async () => {
    const web = await createChannel({ type: "webchat", name: "Web", activeAgentId: agent.id, replyMode: "draft" });
    const conversationId = await receive(web, "Hola", NOW);
    const fake = openRouter("¡Hola!", "El sábado abrimos de 9 a 14.");
    await runReply(conversationId, fake, at(10_000));
    await receive(web, "¿Y el sábado?", at(60_000));
    await runReply(conversationId, fake, at(70_000));
    const [firstDraft, secondDraft] = await aiMessagesOf(conversationId);
    expect([firstDraft.status, secondDraft.status]).toEqual(["draft", "draft"]);
    expect(secondDraft.text).toBe(`${BUSINESS_NOTICE}\n\nEl sábado abrimos de 9 a 14.`);

    // A person throws the first away and approves the second: the customer's first AI message carries the notice.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at(90_000));
    const owner = await createUser("owner");
    await discardDraft(owner.actor, { messageId: firstDraft.id });
    await approveDraft(owner.actor, { messageId: secondDraft.id });
    const sent = (await aiMessagesOf(conversationId)).filter((message) => message.status !== "draft");
    expect(sent.map((message) => message.text)).toEqual([`${BUSINESS_NOTICE}\n\nEl sábado abrimos de 9 a 14.`]);
  });

  it("once an AI message reached the customer, later drafts go without it", async () => {
    const web = await createChannel({ type: "webchat", name: "Web", activeAgentId: agent.id, replyMode: "draft" });
    const conversationId = await receive(web, "Hola", NOW);
    const fake = openRouter("¡Hola!", "Sí, los sábados abrimos.");
    await runReply(conversationId, fake, at(10_000));
    const [first] = await aiMessagesOf(conversationId);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at(20_000));
    await approveDraft((await createUser("owner")).actor, { messageId: first.id });
    await receive(web, "¿Abrís los sábados?", at(60_000));
    await runReply(conversationId, fake, at(70_000));
    expect((await aiMessagesOf(conversationId))[1].text).toBe("Sí, los sábados abrimos.");
  });
});

describe("the AI's emails end with the AI signature [CUM-01] [COR-21]", () => {
  async function emailWith(message: { senderType: "ai" | "human"; metadata?: Record<string, unknown> }) {
    const mailbox = await createChannel({
      type: "email_gmail",
      name: "Correo",
      isDemo: false,
      replyMode: "auto",
      config: { emailAddress: "hola@lola.test", signature: "Recepción · Peluquería Lola" },
    });
    const { contact } = await createContactWithIdentity("email_gmail", { name: "Ana", externalId: "ana@cliente.test", email: "ana@cliente.test" });
    const conversation = await createConversation(mailbox.id, contact.id, { externalThreadId: "<hilo-1@cliente.test>" });
    await createMessage(conversation, { text: "¿Tenéis hueco el martes?" });
    const row = await createMessage(conversation, {
      direction: "outbound",
      senderType: message.senderType,
      status: "queued",
      text: "Hola Ana, sí: el martes a las 10.",
      metadata: message.metadata ?? {},
    });
    const outbound: OutboundMessage = {
      messageId: row.id,
      conversationId: conversation.id,
      recipient: { externalIds: ["ana@cliente.test"], email: "ana@cliente.test", phone: null, name: "Ana" },
      threadId: conversation.externalThreadId,
      contentType: "text",
      text: row.text,
      metadata: row.metadata,
    };
    return loadReplyContext(mailbox, outbound);
  }

  it("an email the AI sends on its own says so under the signature, and is marked as an automatic reply", async () => {
    const context = await emailWith({ senderType: "ai" });
    expect(context.compose.text).toBe(`Hola Ana, sí: el martes a las 10.\n\n-- \nRecepción · Peluquería Lola\n${AI_NOTICE_AUTOMATIC}`);
    expect(context.compose.headers["Auto-Submitted"]).toBe("auto-replied");
  });

  it("a draft of the AI that a person approved says a person reviewed it", async () => {
    const context = await emailWith({ senderType: "ai", metadata: { approvedByUserId: crypto.randomUUID(), approvedAt: NOW.toISOString() } });
    expect(context.compose.text.endsWith(`-- \nRecepción · Peluquería Lola\n${AI_NOTICE_REVIEWED}`)).toBe(true);
    expect(context.compose.headers["Auto-Submitted"]).toBeUndefined();
  });

  it("a person's own email carries no AI notice", async () => {
    const context = await emailWith({ senderType: "human" });
    expect(context.compose.text).toBe("Hola Ana, sí: el martes a las 10.");
  });
});
