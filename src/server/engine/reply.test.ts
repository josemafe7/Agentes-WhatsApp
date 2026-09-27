import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDiagnostics } from "@/data/diagnostics";
import { DEFAULT_AI_DISCLOSURE_TEXT } from "@/data/legal-texts";
import { ensureSettingsRows } from "@/data/settings";
import { db } from "@/db";
import {
  agentKnowledgeBases,
  agents,
  aiRuns,
  appKv,
  auditLog,
  businessHours,
  channels,
  consents,
  contactIdentities,
  contacts,
  conversations,
  handoffEvents,
  integrationSettings,
  jobs,
  kbChunks,
  kbDocuments,
  knowledgeBases,
  messageRetrievals,
  messages,
  notifications,
  realtimeEvents,
} from "@/db/schema";
import type { ChannelType } from "@/lib/enums";
import { PgJobQueue, type Job } from "@/server/adapters/job-queue";
import { registerChannelAdapter, unregisterChannelAdapter } from "@/server/channels/registry";
import { ChannelSendError, type ChannelAdapter, type ChannelRecord, type OutboundMessage } from "@/server/channels/types";
import { DEMO_STATUS_JOB } from "@/server/channels/demo-adapter";
import { ingestEvents } from "@/server/inbound/ingest";
import { registerJobHandler } from "@/server/jobs/registry";
import { tick } from "@/server/jobs/tick";
import { releaseLease, tryAcquireLease } from "@/server/kv";
import { chatCompletion, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog, sequence, type FakeCall, type FakeHandler } from "@/test/fake-openrouter";
import { actorFor, createAgentRow, createBusiness, createChannel, createUser } from "@/test/factories";
import { AI_FAILED_REASON, processReplyJob, replyLeaseKey, type ReplyDeps } from "./reply";
import { REPLY_DEBOUNCE_ENV, REPLY_JOB, replyJobPayload, type ReplyJobPayload } from "./schedule";

const NOW = new Date("2026-09-30T09:00:00Z");
const IN_HOURS = "Te paso con una persona del equipo ahora mismo.";
const OFF_HOURS = "Ahora estamos cerrados; te contestamos al abrir.";
const at = (ms: number) => new Date(NOW.getTime() + ms);

type Fake = ReturnType<typeof fakeFetch>;

function openRouter(...chat: FakeHandler[]): Fake {
  return fakeFetch(routes({ "GET /models/user": () => jsonResponse({ data: sampleCatalog() }), "POST /chat/completions": sequence(...chat) }));
}
const reply = (content: string): FakeHandler => () => jsonResponse(chatCompletion({ content }));
const chatCalls = (fake: Fake) => fake.calls.filter((call) => call.path === "/chat/completions");
const promptOf = (call: FakeCall) => (call.body as { messages: { role: string; content: string }[] }).messages;

async function clear() {
  // Children first (foreign keys are on): the knowledge fragments kept with a message, then the knowledge itself.
  for (const table of [messageRetrievals, agentKnowledgeBases, kbChunks, kbDocuments, knowledgeBases]) await db.delete(table);
  for (const table of [notifications, handoffEvents, aiRuns, messages, conversations, consents, contactIdentities, contacts, jobs, realtimeEvents, appKv, auditLog]) {
    await db.delete(table);
  }
  await db.update(channels).set({ activeAgentId: null });
  await db.delete(channels);
  await db.delete(agents);
  await db.delete(businessHours);
}

let agent: typeof agents.$inferSelect;
let channel: ChannelRecord;

async function setup(options: { type?: ChannelType; isDemo?: boolean; channel?: Partial<typeof channels.$inferInsert>; agent?: Partial<typeof agents.$inferInsert> } = {}) {
  agent = await createAgentRow({ name: "Recepción", handoff: { messageInHours: IN_HOURS, messageOffHours: OFF_HOURS }, ...options.agent });
  channel = await createChannel({ type: options.type ?? "webchat", name: "Web", isDemo: options.isDemo ?? false, activeAgentId: agent.id, ...options.channel });
}

/** A customer message arriving at `when` through the real ingest pipeline. */
async function receive(text: string, when: Date = at(-5_000), sender = "visitor-1", extra: { sentAt?: Date; simulated?: boolean } = {}) {
  const result = await ingestEvents(
    channel,
    [{ kind: "inbound_message", externalId: crypto.randomUUID(), sender: { externalIds: [sender], displayName: "Ana" }, contentType: "text", text, sentAt: extra.sentAt ?? when, simulated: extra.simulated }],
    { now: when },
  );
  return result.messages[0].conversationId ?? "";
}

async function pendingJob(conversationId: string): Promise<Job> {
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, REPLY_JOB), eq(jobs.status, "pending"), eq(jobs.dedupeKey, `reply:${conversationId}`)));
  return job;
}

function context(job: Job) {
  const state = { rescheduledAt: null as Date | null };
  return {
    state,
    ctx: { job, rescheduleAt: (runAt: Date) => void (state.rescheduledAt = runAt), remainingMs: () => 120_000 },
  };
}

async function runReply(conversationId: string, fake: Fake, deps: Partial<ReplyDeps> = {}) {
  const job = await pendingJob(conversationId);
  const { ctx, state } = context(job);
  const outcome = await processReplyJob(replyJobPayload.parse(job.payload) as ReplyJobPayload, ctx, { fetchImpl: fake.fetch, now: NOW, retryDelayMs: 0, ...deps });
  return { outcome, rescheduledAt: state.rescheduledAt };
}

const outbound = (conversationId: string) =>
  db.select().from(messages).where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "outbound"))).orderBy(asc(messages.createdAt));
const conversationRow = async (id: string) => (await db.select().from(conversations).where(eq(conversations.id, id)))[0];

beforeEach(async () => {
  await clear();
  await createBusiness({ name: "Peluquería Lola", timezone: "Europe/Madrid", aiDisclosureText: null });
  await ensureSettingsRows();
  await db.update(integrationSettings).set({ zdr: false });
  vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  unregisterChannelAdapter("whatsapp");
});

describe("one reply for the whole turn [MOT-01] [MOT-10]", () => {
  it("several quick messages make one job and get one single reply that answers all of them", async () => {
    vi.stubEnv(REPLY_DEBOUNCE_ENV, "0");
    await setup();
    const conversationId = await receive("Hola", at(-9_000));
    await receive("quería saber el precio", at(-8_000));
    await receive("de un corte", at(-7_000));
    expect(await db.select().from(jobs).where(eq(jobs.type, REPLY_JOB))).toHaveLength(1);

    const fake = openRouter(reply("Un corte cuesta 18 €."));
    registerJobHandler(REPLY_JOB, (payload, ctx) => processReplyJob(payload, ctx, { fetchImpl: fake.fetch, now: NOW, retryDelayMs: 0 }).then(() => undefined), {
      payload: replyJobPayload,
    });
    const summary = await tick({ budgetMs: 60_000, queue: new PgJobQueue({ now: () => NOW }) });
    expect(summary.completed).toBeGreaterThanOrEqual(1);

    expect(chatCalls(fake)).toHaveLength(1);
    const userTurns = promptOf(chatCalls(fake)[0]).filter((message) => message.role === "user").map((message) => message.content);
    expect(userTurns).toEqual(["Hola", "quería saber el precio", "de un corte"]);
    const sent = await outbound(conversationId);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ senderType: "ai", agentId: agent.id, agentName: "Recepción", status: "sent" });
  });

  it("puts the AI notice in front of the first AI message only [CUM-01]", async () => {
    await setup();
    const conversationId = await receive("Hola");
    const fake = openRouter(reply("¡Hola! ¿En qué te ayudo?"), reply("Abrimos a las 10."));
    await runReply(conversationId, fake);
    const system = promptOf(chatCalls(fake)[0])[0].content;
    expect(system).toContain("la plataforma ya pone delante el aviso");
    await receive("¿A qué hora abrís?", at(60_000));
    await runReply(conversationId, fake, { now: at(70_000) });
    const [first, second] = await outbound(conversationId);
    expect(first.text).toBe(`${DEFAULT_AI_DISCLOSURE_TEXT}\n\n¡Hola! ¿En qué te ayudo?`);
    expect(second.text).toBe("Abrimos a las 10.");
  });

  it("uses the channel's own AI notice when it has one [CUM-01]", async () => {
    await setup({ channel: { disclosureMessage: "Soy la IA de Lola." } });
    const conversationId = await receive("Hola");
    await runReply(conversationId, openRouter(reply("¿Qué necesitas?")));
    expect((await outbound(conversationId))[0].text).toBe("Soy la IA de Lola.\n\n¿Qué necesitas?");
  });

  it("records the run linked to the message it produced [MOT-11]", async () => {
    await setup();
    const conversationId = await receive("Hola");
    const { outcome } = await runReply(conversationId, openRouter(reply("¡Hola!")));
    expect(outcome.kind).toBe("replied");
    const [message] = await outbound(conversationId);
    const [run] = await db.select().from(aiRuns);
    expect(run).toMatchObject({ kind: "chat", conversationId, agentId: agent.id, messageId: message.id, isTest: false, costUsd: 0.00024 });
    expect(message.metadata.aiRunId).toBe(run.id);
  });

  it("a reply with a NUL character (or half a surrogate pair) is stored without it and sent", async () => {
    await setup();
    const conversationId = await receive("Hola");
    const { outcome } = await runReply(conversationId, openRouter(reply("Un corte\u0000 cuesta 18\ud800 €.")));
    expect(outcome.kind).toBe("replied");
    expect((await outbound(conversationId))[0]).toMatchObject({ text: `${DEFAULT_AI_DISCLOSURE_TEXT}\n\nUn corte cuesta 18� €.`, status: "sent" });
  });
});

describe("the agent that answers [CAN-05] [AGE-14]", () => {
  it("changing the channel's active agent affects the next messages; each message keeps its agent", async () => {
    await setup();
    const conversationId = await receive("Hola");
    const fake = openRouter(reply("Hola, soy Recepción."), reply("Hola, soy Nuevo."));
    await runReply(conversationId, fake);
    const newer = await createAgentRow({ name: "Nuevo" });
    await db.update(channels).set({ activeAgentId: newer.id }).where(eq(channels.id, channel.id));
    await receive("¿Sigues ahí?", at(60_000));
    await runReply(conversationId, fake, { now: at(70_000) });
    const sent = await outbound(conversationId);
    expect(sent.map((message) => [message.agentId, message.agentName])).toEqual([
      [agent.id, "Recepción"],
      [newer.id, "Nuevo"],
    ]);
  });

  it("the conversation's own agent answers instead of the channel's", async () => {
    await setup();
    const special = await createAgentRow({ name: "Especialista" });
    const conversationId = await receive("Hola");
    await db.update(conversations).set({ agentOverrideId: special.id }).where(eq(conversations.id, conversationId));
    await runReply(conversationId, openRouter(reply("Soy el especialista.")));
    expect((await outbound(conversationId))[0].agentId).toBe(special.id);
  });
});

describe("the AI stays quiet and the message waits for a person [MOT-03]", () => {
  async function expectSkipped(reason: string, prepare: (conversationId: string) => Promise<void> = async () => {}) {
    const conversationId = await receive("Hola");
    await prepare(conversationId);
    const fake = openRouter(reply("No debería salir."));
    const { outcome } = await runReply(conversationId, fake);
    expect(outcome).toEqual({ kind: "skipped", reason });
    expect(chatCalls(fake)).toHaveLength(0);
    expect(await outbound(conversationId)).toHaveLength(0);
  }

  it("without an active agent [CAN-03]", async () => {
    await setup({ channel: { activeAgentId: null } });
    await expectSkipped("no_agent");
  });

  it("with the channel's AI off [CAN-03]", async () => {
    await setup({ channel: { aiEnabled: false } });
    await expectSkipped("ai_disabled");
  });

  it("in a disabled channel [CAN-16]", async () => {
    await setup({ channel: { status: "disabled" } });
    await expectSkipped("channel_disabled");
  });

  it("in human mode [TRA-02]", async () => {
    await setup();
    await expectSkipped("human_mode", async (id) => void (await db.update(conversations).set({ aiMode: "human" }).where(eq(conversations.id, id))));
  });

  it("while paused [BAN-11]", async () => {
    await setup();
    await expectSkipped("paused", async (id) => void (await db.update(conversations).set({ aiPausedUntil: at(3_600_000), pauseReason: "Ha respondido Eva" }).where(eq(conversations.id, id))));
  });

  it("in test mode, for a contact that is not on the list [CAN-06]", async () => {
    await setup({ channel: { testMode: true, testAllowlist: ["otra-persona"] } });
    await expectSkipped("test_mode");
  });

  it("for an opted-out contact [CUM-04]", async () => {
    await setup();
    await expectSkipped("opted_out", async (id) => {
      const conversation = await conversationRow(id);
      await db.insert(consents).values({ contactId: conversation.contactId ?? "", channelId: channel.id, type: "opt_out", source: "BAJA" });
    });
  });

  it("off hours when the channel says «No responder fuera de horario» [CAN-08]", async () => {
    await setup({ channel: { offHoursBehavior: "no_reply" } });
    await expectSkipped("off_hours");
  });

  it("without an OpenRouter key [ARR-14]", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    await setup();
    await expectSkipped("ai_not_configured");
  });

  it("outside WhatsApp's 24 h window [WA-43]", async () => {
    await setup({ type: "whatsapp", isDemo: true });
    const conversationId = await receive("Hola", at(-5_000), "ES.bsuid-1", { sentAt: at(-25 * 60 * 60_000) });
    const fake = openRouter(reply("No debería salir."));
    const { outcome } = await runReply(conversationId, fake);
    expect(outcome).toEqual({ kind: "skipped", reason: "window_closed" });
    expect(chatCalls(fake)).toHaveLength(0);
  });

  it("in test mode a contact on the list does get an answer [CAN-06]", async () => {
    await setup({ channel: { testMode: true, testAllowlist: ["visitor-1"] } });
    const conversationId = await receive("Hola");
    const { outcome } = await runReply(conversationId, openRouter(reply("¡Hola!")));
    expect(outcome.kind).toBe("replied");
  });

  /** A message whose sender carries a phone and an email, as the web chat form or WhatsApp give them. */
  async function receiveFrom(sender: { externalIds: string[]; phone?: string; email?: string }) {
    const result = await ingestEvents(
      channel,
      [{ kind: "inbound_message", externalId: crypto.randomUUID(), sender: { ...sender, displayName: "Ana" }, contentType: "text", text: "Hola", sentAt: at(-5_000) }],
      { now: at(-5_000) },
    );
    return result.messages[0].conversationId ?? "";
  }

  it("in test mode, what a web chat visitor types in the form never unlocks the AI [CAN-06]", async () => {
    // The owner's own email and phone are on the list; a stranger types them in the chat's contact form.
    await setup({ channel: { testMode: true, testAllowlist: ["dueno@peluqueria.es", "+34 600 111 222"] } });
    const conversationId = await receiveFrom({ externalIds: ["visitor-9"], email: "dueno@peluqueria.es", phone: "+34600111222" });
    const fake = openRouter(reply("No debería salir."));
    const { outcome } = await runReply(conversationId, fake);
    expect(outcome).toEqual({ kind: "skipped", reason: "test_mode" });
    expect(chatCalls(fake)).toHaveLength(0);
    expect(await outbound(conversationId)).toHaveLength(0);
  });

  it("in test mode, a WhatsApp contact on the list by the phone Meta gives does get an answer [CAN-06]", async () => {
    await setup({ type: "whatsapp", isDemo: true, channel: { testMode: true, testAllowlist: ["+34 600 111 222"] } });
    const conversationId = await receiveFrom({ externalIds: ["ES.12345678901234567890"], phone: "34600111222" });
    const { outcome } = await runReply(conversationId, openRouter(reply("¡Hola!")));
    expect(outcome.kind).toBe("replied");
  });

  it("an expired pause is cleared and the AI answers again on its own [BAN-11]", async () => {
    await setup();
    const conversationId = await receive("Hola");
    await db.update(conversations).set({ aiPausedUntil: at(-1_000), pauseReason: "Ha respondido Eva" }).where(eq(conversations.id, conversationId));
    const { outcome } = await runReply(conversationId, openRouter(reply("¡Hola de nuevo!")));
    expect(outcome.kind).toBe("replied");
    expect(await conversationRow(conversationId)).toMatchObject({ aiPausedUntil: null, pauseReason: null });
  });
});

describe("never two replies at once for a conversation [MOT-02]", () => {
  it("while another job holds the conversation, this one tries again shortly", async () => {
    await setup();
    const conversationId = await receive("Hola");
    await tryAcquireLease(replyLeaseKey(conversationId), "otro-trabajo", 60_000, { now: NOW });
    const fake = openRouter(reply("x"));
    const { outcome, rescheduledAt } = await runReply(conversationId, fake);
    expect(outcome).toEqual({ kind: "busy" });
    expect(rescheduledAt?.getTime()).toBeGreaterThan(NOW.getTime());
    expect(chatCalls(fake)).toHaveLength(0);
  });

  it("a newer message than the one the job was scheduled for makes it wait, within the 20 s cap", async () => {
    await setup();
    const conversationId = await receive("Hola", at(-9_000));
    const job = await pendingJob(conversationId);
    // A second message arrives while this job is already running: the pipeline creates another pending job.
    await db.update(jobs).set({ status: "running" }).where(eq(jobs.id, job.id));
    await receive("¿Me oyes?", at(-2_000));
    const { ctx, state } = context(job);
    const fake = openRouter(reply("x"));
    const outcome = await processReplyJob(replyJobPayload.parse(job.payload), ctx, { fetchImpl: fake.fetch, now: NOW });
    expect(outcome).toEqual({ kind: "waiting" });
    expect(state.rescheduledAt?.getTime()).toBeLessThanOrEqual(at(-9_000 + 20_000).getTime());
    expect(chatCalls(fake)).toHaveLength(0);
  });

  it("a customer's file still downloading makes the reply wait for it, never for long [WA-41] [MED-04]", async () => {
    await setup();
    const received = await ingestEvents(
      channel,
      [
        {
          kind: "inbound_message",
          externalId: crypto.randomUUID(),
          sender: { externalIds: ["visitor-1"] },
          contentType: "audio",
          text: null,
          media: { mimeType: "audio/ogg", externalMediaId: "900000000000001", downloadStatus: "pending" },
          sentAt: at(-5_000),
        },
      ],
      { now: at(-5_000) },
    );
    const conversationId = received.messages[0].conversationId ?? "";
    const fake = openRouter(reply("Te he escuchado."));
    // The download job has not stored the voice note yet: answering now would miss its transcript.
    const waiting = await runReply(conversationId, fake);
    expect(waiting.outcome).toEqual({ kind: "waiting" });
    expect(waiting.rescheduledAt?.getTime()).toBeGreaterThan(NOW.getTime());
    expect(chatCalls(fake)).toHaveLength(0);
    // A download that never ends does not keep the customer without an answer.
    const later = await runReply(conversationId, fake, { now: at(5 * 60_000) });
    expect(later.outcome.kind).toBe("replied");
    expect(chatCalls(fake)).toHaveLength(1);
  });

  it("a message arriving while the reply is prepared throws that reply away; the next one includes it", async () => {
    await setup();
    const conversationId = await receive("Hola");
    const fake = openRouter(async () => {
      await receive("Una cosa más", at(1_000));
      return jsonResponse(chatCompletion({ content: "Respuesta vieja" }));
    }, reply("Respuesta a todo"));
    const first = await runReply(conversationId, fake);
    expect(first.outcome).toEqual({ kind: "discarded" });
    expect(await outbound(conversationId)).toHaveLength(0);
    const second = await runReply(conversationId, fake, { now: at(20_000) });
    expect(second.outcome.kind).toBe("replied");
    const userTurns = promptOf(chatCalls(fake)[1]).filter((message) => message.role === "user").map((message) => message.content);
    expect(userTurns).toEqual(["Hola", "Una cosa más"]);
    expect((await outbound(conversationId)).map((message) => message.text)).toEqual([`${DEFAULT_AI_DISCLOSURE_TEXT}\n\nRespuesta a todo`]);
  });

  it("if the channel's AI is switched off while the model works, nothing is sent [CAN-04]", async () => {
    await setup();
    const conversationId = await receive("Hola");
    const fake = openRouter(async () => {
      await db.update(channels).set({ aiEnabled: false }).where(eq(channels.id, channel.id));
      return jsonResponse(chatCompletion({ content: "No debería salir" }));
    });
    const { outcome } = await runReply(conversationId, fake);
    expect(outcome).toEqual({ kind: "skipped", reason: "ai_disabled" });
    expect(await outbound(conversationId)).toHaveLength(0);
  });

  it("if the conversation's lease was lost while the model worked (a very slow model), the reply yields", async () => {
    await setup();
    const conversationId = await receive("Hola");
    const job = await pendingJob(conversationId);
    const fake = openRouter(async () => {
      await releaseLease(replyLeaseKey(conversationId), job.id);
      await tryAcquireLease(replyLeaseKey(conversationId), "otro-trabajo", 60_000, { now: NOW });
      return jsonResponse(chatCompletion({ content: "Llego tarde" }));
    });
    const { outcome } = await runReply(conversationId, fake);
    expect(outcome).toEqual({ kind: "discarded" });
    expect(await outbound(conversationId)).toHaveLength(0);
  });

  it("if a person answers while the AI prepares its reply, the AI's reply is not sent [BAN-11]", async () => {
    await setup();
    const conversationId = await receive("Hola");
    const fake = openRouter(async () => {
      await db.update(conversations).set({ aiPausedUntil: at(12 * 60 * 60_000), pauseReason: "Ha respondido Eva" }).where(eq(conversations.id, conversationId));
      return jsonResponse(chatCompletion({ content: "Llego tarde" }));
    });
    const { outcome } = await runReply(conversationId, fake);
    expect(outcome).toEqual({ kind: "skipped", reason: "paused" });
    expect(await outbound(conversationId)).toHaveLength(0);
  });
});

describe("what the AI does not answer never holds a reply back [MOT-01] [MOT-02] [WA-36] [WA-50]", () => {
  const NOTICES = {
    unsupported: { contentType: "unsupported", text: "Tipo de mensaje no admitido" },
    system: { contentType: "system", text: "El identificador de WhatsApp del cliente ha cambiado." },
  } as const;

  /** A WhatsApp notice the AI must not answer (as normalize.ts gives it), through the real ingest pipeline. */
  async function receiveNotice(kind: keyof typeof NOTICES, when: Date) {
    await ingestEvents(
      channel,
      [{ kind: "inbound_message", externalId: crypto.randomUUID(), sender: { externalIds: ["ES.bsuid-1"] }, ...NOTICES[kind], sentAt: when, noReply: true }],
      { now: when },
    );
  }

  const userTurnsOf = (fake: Fake, index = 0) =>
    promptOf(chatCalls(fake)[index])
      .filter((message) => message.role === "user")
      .map((message) => message.content);

  it.each(["unsupported", "system"] as const)("a text and then a %s notice before the reply runs: one reply to the text, at once", async (kind) => {
    await setup({ type: "whatsapp", isDemo: true });
    const conversationId = await receive("¿Tenéis hueco mañana?", at(-30_000), "ES.bsuid-1");
    await receiveNotice(kind, at(-29_000));
    const fake = openRouter(reply("Sí, mañana a las 10."));
    const { outcome, rescheduledAt } = await runReply(conversationId, fake);
    expect(outcome.kind).toBe("replied");
    expect(rescheduledAt).toBeNull();
    // The notice is the system's, never the customer's words.
    expect(userTurnsOf(fake)).toEqual(["¿Tenéis hueco mañana?"]);
    expect(await outbound(conversationId)).toHaveLength(1);
  });

  it("the queue runs that reply once and stops, instead of taking it again and again", async () => {
    await setup({ type: "whatsapp", isDemo: true });
    const conversationId = await receive("¿Tenéis hueco mañana?", at(-30_000), "ES.bsuid-1");
    await receiveNotice("system", at(-29_000));
    const fake = openRouter(reply("Sí, mañana a las 10."));
    registerJobHandler(REPLY_JOB, (payload, ctx) => processReplyJob(payload, ctx, { fetchImpl: fake.fetch, now: NOW, retryDelayMs: 0 }).then(() => undefined), {
      payload: replyJobPayload,
    });
    const started = Date.now();
    const summary = await tick({ budgetMs: 20_000, maxJobs: 5, queue: new PgJobQueue({ now: () => NOW }) });
    expect(summary.rescheduled).toBe(0);
    expect(summary.stoppedBy).toBe("idle");
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(chatCalls(fake)).toHaveLength(1);
    const [job] = await db.select().from(jobs).where(and(eq(jobs.type, REPLY_JOB), eq(jobs.dedupeKey, `reply:${conversationId}`)));
    expect(job.status).toBe("done");
  });

  it("a newer customer message whose wait is already over is answered now, never rescheduled into the past", async () => {
    await setup();
    const conversationId = await receive("Hola", at(-30_000));
    const job = await pendingJob(conversationId);
    // The second message arrives while this job runs (the pipeline makes another pending job); both waits are over.
    await db.update(jobs).set({ status: "running" }).where(eq(jobs.id, job.id));
    await receive("¿Me oyes?", at(-20_000));
    const { ctx, state } = context(job);
    const fake = openRouter(reply("Sí, te leo."));
    const outcome = await processReplyJob(replyJobPayload.parse(job.payload), ctx, { fetchImpl: fake.fetch, now: NOW, retryDelayMs: 0 });
    expect(outcome.kind).toBe("replied");
    expect(state.rescheduledAt).toBeNull();
    expect(userTurnsOf(fake)).toEqual(["Hola", "¿Me oyes?"]);
  });
});

describe("hand-off rules of the agent [TRA-01] [TRA-02] [TRA-03]", () => {
  it("a keyword hands off before answering: no AI call, the customer gets the agent's message", async () => {
    await setup({ agent: { handoff: { keywords: ["hablar con una persona"], messageInHours: IN_HOURS, messageOffHours: OFF_HOURS } } });
    await createUser("admin");
    const conversationId = await receive("Quiero HABLAR con una persona, por favor");
    const fake = openRouter(reply("No debería salir."));
    const { outcome } = await runReply(conversationId, fake);
    expect(outcome).toMatchObject({ kind: "handed_off", rule: "keyword" });
    expect(chatCalls(fake)).toHaveLength(0);
    expect(await conversationRow(conversationId)).toMatchObject({ status: "pending_human", aiMode: "human" });
    const [event] = await db.select().from(handoffEvents);
    expect(event).toMatchObject({ trigger: "rule", rule: "keyword", urgency: "normal" });
    const sent = await outbound(conversationId);
    expect(sent).toHaveLength(1);
    // No opening hours configured: the off-hours text ([TRA-03]); and the AI notice as the first AI message.
    expect(sent[0].text).toBe(`${DEFAULT_AI_DISCLOSURE_TEXT}\n\n${OFF_HOURS}`);
  });

  it("inside opening hours the in-hours message is sent [TRA-03]", async () => {
    await setup({ agent: { handoff: { keywords: ["encargado"], messageInHours: IN_HOURS, messageOffHours: OFF_HOURS } } });
    // Wednesday 11:00 in Madrid is inside 09:00–20:00.
    await db.insert(businessHours).values({ weekday: 3, startMin: 9 * 60, endMin: 20 * 60 });
    const conversationId = await receive("Que venga el encargado");
    await runReply(conversationId, openRouter(reply("x")));
    expect((await outbound(conversationId))[0].text).toContain(IN_HOURS);
  });

  it("a sensitive topic hands off as urgent", async () => {
    await setup({ agent: { handoff: { sensitiveTopics: ["dolor muy fuerte"] } } });
    const conversationId = await receive("Tengo un dolor muy fuerte en la muela");
    const { outcome } = await runReply(conversationId, openRouter(reply("x")));
    expect(outcome).toMatchObject({ kind: "handed_off", rule: "sensitive_topic" });
    const [event] = await db.select().from(handoffEvents);
    expect(event.urgency).toBe("high");
  });

  it("after the configured number of «no lo sé» answers the conversation goes to a person", async () => {
    await setup({ agent: { handoff: { unknownThreshold: 2, messageInHours: IN_HOURS, messageOffHours: OFF_HOURS } } });
    const conversationId = await receive("¿Hacéis tintes veganos?");
    const fake = openRouter(reply("Lo siento, no lo sé."), reply("No tengo esa información."));
    const first = await runReply(conversationId, fake);
    expect(first.outcome.kind).toBe("replied");
    expect((await outbound(conversationId))[0].metadata.unknownAnswer).toBe(true);
    await receive("¿Y con amoniaco?", at(60_000));
    const second = await runReply(conversationId, fake, { now: at(70_000) });
    expect(second.outcome).toMatchObject({ kind: "handed_off", rule: "unknown_answers" });
    const sent = await outbound(conversationId);
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toBe(OFF_HOURS);
    expect(await conversationRow(conversationId)).toMatchObject({ status: "pending_human" });
  });

  it("transferir_a_humano hands off through the service and its message is the only reply [HER-08]", async () => {
    await setup();
    const admin = await createUser("admin");
    const conversationId = await receive("Necesito ayuda con una factura");
    const fake = openRouter(() =>
      jsonResponse(chatCompletion({ toolCalls: [{ name: "transferir_a_humano", arguments: { motivo: "Factura", resumen: "Duda de factura", urgencia: "alta" } }] })),
    );
    const { outcome } = await runReply(conversationId, fake);
    expect(outcome.kind).toBe("handed_off");
    expect(chatCalls(fake)).toHaveLength(1);
    const [event] = await db.select().from(handoffEvents);
    expect(event).toMatchObject({ trigger: "ai_tool", reason: "Factura", summary: "Duda de factura", urgency: "high" });
    const sent = await outbound(conversationId);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain(OFF_HOURS);
    // The team hears about it ([TRA-05]).
    const [notice] = await db.select().from(notifications).where(eq(notifications.userId, admin.userId)).limit(1);
    expect(notice).toMatchObject({ event: "handoff", title: "Traspaso urgente: Ana", link: `/bandeja/${conversationId}` });
  });

  it("what the model passes to a tool is saved without NUL characters: the hand-off keeps its reason and summary [HER-08]", async () => {
    await setup();
    const conversationId = await receive("Necesito ayuda con una factura");
    const fake = openRouter(() =>
      jsonResponse(chatCompletion({ toolCalls: [{ name: "transferir_a_humano", arguments: { motivo: "Fac\u0000tura", resumen: "Duda\u0000 de factura", urgencia: "alta" } }] })),
    );
    expect((await runReply(conversationId, fake)).outcome.kind).toBe("handed_off");
    const [event] = await db.select().from(handoffEvents);
    expect(event).toMatchObject({ trigger: "ai_tool", reason: "Factura", summary: "Duda de factura" });
  });
});

describe("the knowledge in a live reply [CON-20] [CON-18] [HER-01] [AGE-07]", () => {
  const SEARCH_TOOLS = ["buscar_conocimiento", "transferir_a_humano"];
  const QUESTION = "¿Qué señal hay que pagar para reservar un recogido?";

  /** A base of the agent with one fragment, processed without a key (no vector yet: found by its words). */
  async function agentBase() {
    const [kb] = await db.insert(knowledgeBases).values({ name: "Normas" }).returning();
    const [doc] = await db.insert(kbDocuments).values({ kbId: kb.id, sourceType: "text", title: "Normas del salón", status: "ready" }).returning();
    await db.insert(kbChunks).values({
      kbId: kb.id,
      documentId: doc.id,
      indexVersion: 1,
      ord: 0,
      title: "Normas del salón",
      section: "Reservas",
      page: 2,
      content: "La señal para reservar un recogido de fiesta es de 30 euros.",
      tokenCount: 15,
    });
    await db.insert(agentKnowledgeBases).values({ agentId: agent.id, knowledgeBaseId: kb.id });
    return { kb, doc };
  }

  /** The model searches first, then answers; the query embedding is answered too (1536 numbers). */
  function searchingModel(answer: string): Fake {
    return fakeFetch(
      routes({
        "GET /models/user": () => jsonResponse({ data: sampleCatalog() }),
        "POST /embeddings": () => jsonResponse({ data: [{ index: 0, embedding: Array.from({ length: 1536 }, () => 0.01) }], usage: { prompt_tokens: 5, cost: 0 } }),
        "POST /chat/completions": sequence(
          () => jsonResponse(chatCompletion({ toolCalls: [{ name: "buscar_conocimiento", arguments: { consulta: QUESTION } }] })),
          reply(answer),
        ),
      }),
    );
  }

  it("the fragments the agent read are kept with the message it sent, with a copy of their source; the model got them numbered", async () => {
    await setup({ agent: { systemTools: SEARCH_TOOLS } });
    const { kb, doc } = await agentBase();
    const conversationId = await receive(QUESTION);
    const fake = searchingModel("Son 30 euros de señal (Fuente: Normas del salón, pág. 2).");
    const { outcome } = await runReply(conversationId, fake);
    expect(outcome.kind).toBe("replied");
    const [message] = await outbound(conversationId);
    expect(message.metadata.unknownAnswer).toBeUndefined();
    const kept = await db.select().from(messageRetrievals).where(eq(messageRetrievals.messageId, message.id));
    expect(kept).toEqual([expect.objectContaining({ rank: 1, kbId: kb.id, documentId: doc.id, title: "Normas del salón", section: "Reservas", page: 2 })]);
    const toolMessage = promptOf(chatCalls(fake)[1]).find((entry) => entry.role === "tool");
    expect(toolMessage?.content).toContain("[1] Normas del salón · Reservas · pág. 2");
    expect(toolMessage?.content).toContain("30 euros");
    const [run] = await db.select().from(aiRuns).where(eq(aiRuns.kind, "chat"));
    expect(run.toolsUsed).toEqual([{ name: "buscar_conocimiento", ok: true }]);
  });

  it("with nothing relevant the tool says SIN_RESULTADOS: nothing is kept and the answer counts as «no lo sé» [CON-18] [TRA-01]", async () => {
    await setup({ agent: { systemTools: SEARCH_TOOLS } });
    await agentBase();
    const conversationId = await receive("¿Vendéis bicicletas de montaña?");
    const fake = fakeFetch(
      routes({
        "GET /models/user": () => jsonResponse({ data: sampleCatalog() }),
        "POST /embeddings": () => jsonResponse({ data: [{ index: 0, embedding: Array.from({ length: 1536 }, () => 0.01) }], usage: { prompt_tokens: 5, cost: 0 } }),
        "POST /chat/completions": sequence(
          () => jsonResponse(chatCompletion({ toolCalls: [{ name: "buscar_conocimiento", arguments: { consulta: "bicicletas de montaña" } }] })),
          reply("Eso no lo sé. ¿Quieres que te pase con una persona del equipo?"),
        ),
      }),
    );
    expect((await runReply(conversationId, fake)).outcome.kind).toBe("replied");
    const [message] = await outbound(conversationId);
    expect(promptOf(chatCalls(fake)[1]).find((entry) => entry.role === "tool")?.content).toContain("SIN_RESULTADOS");
    expect(message.metadata.unknownAnswer).toBe(true);
    expect(await db.select().from(messageRetrievals)).toEqual([]);
  });
});

describe("when the AI fails [MOT-09] [MOT-12]", () => {
  it("retries once; if it fails again the customer gets nothing and the conversation waits for a person with the notice", async () => {
    await setup();
    const admin = await createUser("admin");
    const conversationId = await receive("Hola");
    const fake = openRouter(() => jsonResponse({ error: { code: 500, message: "boom" } }, 500));
    const { outcome } = await runReply(conversationId, fake);
    expect(outcome).toMatchObject({ kind: "failed", reason: "server_error" });
    expect(chatCalls(fake)).toHaveLength(2);
    expect(await outbound(conversationId)).toHaveLength(0);
    expect(await conversationRow(conversationId)).toMatchObject({ status: "pending_human", aiMode: "human" });
    const [event] = await db.select().from(handoffEvents);
    expect(event).toMatchObject({ trigger: "rule", rule: "ai_failure", reason: AI_FAILED_REASON });
    // The retry already happened: the team is not promised another one.
    expect(event.summary).toContain("tras reintentarlo");
    expect(event.summary).not.toContain("Se reintentará");
    const runs = await db.select().from(aiRuns);
    expect(runs.every((run) => run.ok === false && run.error)).toBe(true);
    expect((await db.select().from(notifications).where(eq(notifications.userId, admin.userId))).length).toBeGreaterThan(0);
    // …and the error appears in Diagnóstico › errores recientes ([AJU-11]).
    const { aiErrors } = await getDiagnostics(actorFor("owner"));
    expect(aiErrors.filter((error) => error.conversationId === conversationId && error.kind === "chat")).toHaveLength(2);
  });

  it("a transient failure that passes on the retry still gives one reply", async () => {
    await setup();
    const conversationId = await receive("Hola");
    const fake = openRouter(() => jsonResponse({ error: { code: 500, message: "boom" } }, 500), reply("¡Ya estoy!"));
    const { outcome } = await runReply(conversationId, fake);
    expect(outcome.kind).toBe("replied");
    expect(await outbound(conversationId)).toHaveLength(1);
  });

  it("with no final answer after 6 steps nothing half-done is sent: a person takes over", async () => {
    await setup();
    const conversationId = await receive("Hola");
    const fake = openRouter(() => jsonResponse(chatCompletion({ toolCalls: [{ name: "herramienta_inexistente", arguments: {} }] })));
    const { outcome } = await runReply(conversationId, fake);
    expect(outcome).toMatchObject({ kind: "failed", reason: "step_limit" });
    expect(await outbound(conversationId)).toHaveLength(0);
    expect(await conversationRow(conversationId)).toMatchObject({ status: "pending_human" });
  });
});

describe("sending the reply", () => {
  it("in «Borrador para revisar» the reply is stored as a draft and not sent [MOT-14]", async () => {
    await setup({ channel: { replyMode: "draft" } });
    const conversationId = await receive("Hola");
    const { outcome } = await runReply(conversationId, openRouter(reply("Borrador")));
    expect(outcome).toMatchObject({ kind: "replied", status: "draft" });
    const [draft] = await outbound(conversationId);
    expect(draft.status).toBe("draft");
    expect(draft.externalId).toBeNull();
  });

  it("a demo WhatsApp channel never calls Meta and simulates «entregado» and «leído» [ARR-11]", async () => {
    await setup({ type: "whatsapp", isDemo: true });
    const conversationId = await receive("Hola", at(-5_000), "ES.bsuid-2");
    await runReply(conversationId, openRouter(reply("¡Hola!")));
    const [sent] = await outbound(conversationId);
    expect(sent.status).toBe("sent");
    expect(sent.externalId).toBe(`demo-${sent.id}`);
    const simulated = await db.select().from(jobs).where(eq(jobs.type, DEMO_STATUS_JOB));
    expect(simulated.map((job) => (job.payload as { status: string }).status).sort()).toEqual(["delivered", "read"]);
  });

  it("replies to simulated messages never leave the app, even on a real channel [AJU-13]", async () => {
    const sends: OutboundMessage[] = [];
    const real: ChannelAdapter = {
      type: "whatsapp",
      capabilities: () => ({ audio: true, images: true, documents: true, templates: true, window24h: true, typing: false, readReceipts: false, html: false, drafts: false }),
      validateAndConnect: async () => ({ ok: true }),
      healthCheck: async () => ({ checkedAt: NOW.toISOString(), checks: [] }),
      handleWebhook: async () => [],
      send: async (_channel, message) => {
        sends.push(message);
        return { externalId: "wamid.real", status: "sent" };
      },
      downloadMedia: async () => ({ bytes: new Uint8Array(), mimeType: "text/plain" }),
      disconnect: async () => {},
    };
    registerChannelAdapter(real);
    await setup({ type: "whatsapp", isDemo: false });
    const conversationId = await receive("Hola", at(-5_000), "ES.bsuid-3", { simulated: true });
    await runReply(conversationId, openRouter(reply("¡Hola!")));
    expect(sends).toHaveLength(0);
    const [sent] = await outbound(conversationId);
    expect(sent).toMatchObject({ simulated: true, status: "sent" });
  });

  it("a transient send error is retried once; if it keeps failing the message is «fallido» and the team is told [WA-46]", async () => {
    let attempts = 0;
    registerChannelAdapter({
      type: "whatsapp",
      capabilities: () => ({ audio: false, images: false, documents: false, templates: false, window24h: false, typing: false, readReceipts: false, html: false, drafts: false }),
      validateAndConnect: async () => ({ ok: true }),
      healthCheck: async () => ({ checkedAt: NOW.toISOString(), checks: [] }),
      handleWebhook: async () => [],
      send: async () => {
        attempts++;
        throw new ChannelSendError("Meta no responde ahora mismo.", true, 131000);
      },
      downloadMedia: async () => ({ bytes: new Uint8Array(), mimeType: "text/plain" }),
      disconnect: async () => {},
    });
    await setup({ type: "whatsapp", isDemo: false });
    const owner = await createUser("owner");
    const conversationId = await receive("Hola", at(-5_000), "ES.bsuid-4");
    const { outcome } = await runReply(conversationId, openRouter(reply("¡Hola!")));
    expect(outcome).toMatchObject({ kind: "replied", status: "failed" });
    expect(attempts).toBe(2);
    const [failed] = await outbound(conversationId);
    expect(failed).toMatchObject({ status: "failed", error: { code: 131000, message: "Meta no responde ahora mismo." } });
    const notices = await db.select().from(notifications).where(eq(notifications.userId, owner.userId));
    expect(notices.map((notice) => notice.event)).toContain("channel_error");
  });

  it("a reply stored but never handed to the channel is sent without asking the AI again", async () => {
    await setup();
    const conversationId = await receive("Hola");
    const [stuck] = await db
      .insert(messages)
      .values({ conversationId, channelId: channel.id, direction: "outbound", senderType: "ai", agentId: agent.id, text: "Pendiente", status: "queued", createdAt: at(-1_000) })
      .returning();
    const fake = openRouter(reply("x"));
    const { outcome } = await runReply(conversationId, fake);
    expect(outcome).toMatchObject({ kind: "replied", messageId: stuck.id, status: "sent" });
    expect(chatCalls(fake)).toHaveLength(0);
  });
});
