import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSettingsRows } from "@/data/settings";
import { db } from "@/db";
import {
  agents,
  aiRuns,
  appKv,
  auditLog,
  channelMembers,
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
  rateLimits,
  realtimeEvents,
  whatsappTemplates,
} from "@/db/schema";
import { WHATSAPP_WINDOW_MS } from "@/lib/meta/window";
import type { Actor } from "@/lib/permissions";
import { registerChannelAdapter } from "@/server/channels/registry";
import type { ChannelRecord } from "@/server/channels/types";
import { createWhatsAppAdapter, whatsappAdapter } from "@/server/channels/whatsapp/adapter";
import { encryptWhatsAppSecrets } from "@/server/channels/whatsapp/config";
import { processReplyJob } from "@/server/engine/reply";
import { REPLY_JOB, replyJobPayload, type ReplyJobPayload } from "@/server/engine/schedule";
import { AuthError, ConflictError, NotFoundError, RateLimitError, ValidationError } from "@/server/errors";
import { ingestEvents } from "@/server/inbound/ingest";
import { sendOutbound } from "@/server/outbound/send";
import { chatCompletion, FAKE_OPENROUTER_KEY, fakeFetch, jsonResponse, routes, sampleCatalog } from "@/test/fake-openrouter";
import { actorFor, createAgentRow, createBusiness, createChannel, createContactWithIdentity, createConversation, createUser, type TestUser } from "@/test/factories";
import { WA_TEST } from "@/test/fixtures/whatsapp";
import {
  connectedNumberRoutes,
  FAKE_META_BASE_URL,
  fakeMetaFetch,
  metaError,
  metaJson,
  sendMessageResponse,
  templateComponents,
  type MetaCall,
  type MetaHandler,
} from "@/test/fixtures/whatsapp/fake-meta";
import { listMessages, sendHumanMessage } from "./messages";
import { WHATSAPP_LIMITS } from "./whatsapp-limits";
import { getWhatsAppInboxState, sendHumanTemplateMessage, sendTemplateMessage } from "./whatsapp-send";

const HOUR = 3_600_000;
const T = new Date("2026-09-30T08:00:00Z");
const hoursAfter = (date: Date, hours: number) => new Date(date.getTime() + hours * HOUR);
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR);

const REMINDER_VALUES = { nombre: "Ana", fecha: "3 de octubre", hora: "10:30" };
const REMINDER_TEXT = "Hola Ana, te recordamos tu cita el 3 de octubre a las 10:30.";

let channel: ChannelRecord;
let metaCalls: MetaCall[] = [];
let owner: TestUser;

let wamids = 0;
/** A connected number whose every send gets a new wamid, as Meta does. */
const numberRoutes = () => connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}/messages`]: () => metaJson(sendMessageResponse(`wamid.TEST_OUT_${++wamids}`)) });

/** The real WhatsApp adapter, talking to a fake Meta: no test ever calls Meta. */
function useFakeMeta(handler: MetaHandler = numberRoutes()) {
  const fake = fakeMetaFetch(handler);
  metaCalls = fake.calls;
  registerChannelAdapter(createWhatsAppAdapter({ fetchImpl: fake.fetch, baseUrl: FAKE_META_BASE_URL, sleep: async () => {} }));
}

/** Messages (not «read» or «typing») that reached Meta. */
const sentToMeta = () => metaCalls.filter((call) => call.method === "POST" && call.path === `/${WA_TEST.phoneNumberId}/messages` && (call.body as { type?: string }).type);

async function createWhatsAppChannel(overrides: Partial<typeof channels.$inferInsert> = {}) {
  return createChannel({
    type: "whatsapp",
    name: "WhatsApp Recepción",
    status: "connected",
    phoneNumberId: WA_TEST.phoneNumberId,
    wabaId: WA_TEST.wabaId,
    metaAppId: WA_TEST.appId,
    graphApiVersion: "v26.0",
    secretsEnc: encryptWhatsAppSecrets({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: null }),
    ...overrides,
  });
}

async function addTemplate(overrides: Partial<typeof whatsappTemplates.$inferInsert> = {}) {
  const [row] = await db
    .insert(whatsappTemplates)
    .values({
      channelId: channel.id,
      name: "recordatorio_cita",
      language: "es",
      category: "UTILITY",
      status: "APPROVED",
      components: templateComponents,
      variables: ["nombre", "fecha", "hora"],
      ...overrides,
    })
    .returning();
  return row;
}

async function customer() {
  return createContactWithIdentity("whatsapp", { name: "Ana Pruebas", externalId: WA_TEST.customer.bsuid, phone: WA_TEST.customer.waId });
}

/** A conversation whose customer last wrote `hours` ago. */
async function conversationLastWritten(hours: number) {
  const { contact } = await customer();
  return createConversation(channel.id, contact.id, { lastInboundAt: hoursAgo(hours) });
}

/** A customer message through the real ingest pipeline, dated by Meta at `sentAt`. */
async function receive(sentAt: Date, externalId: string = crypto.randomUUID()) {
  const result = await ingestEvents(
    channel,
    [
      {
        kind: "inbound_message",
        externalId,
        sender: { externalIds: [WA_TEST.customer.bsuid, WA_TEST.customer.waId], phone: WA_TEST.customer.waId, displayName: "Ana Pruebas" },
        contentType: "text",
        text: "Hola",
        sentAt,
      },
    ],
    { now: new Date(sentAt.getTime() + 2_000) },
  );
  return result.messages[0].conversationId ?? "";
}

const outboundOf = (conversationId: string) =>
  db.select().from(messages).where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "outbound"))).orderBy(asc(messages.createdAt));
const conversationRow = async (id: string) => (await db.select().from(conversations).where(eq(conversations.id, id)))[0];

async function clear() {
  for (const table of [notifications, handoffEvents, aiRuns, messages, conversations, consents, contactIdentities, contacts, jobs, realtimeEvents, appKv, auditLog, whatsappTemplates, channelMembers]) {
    await db.delete(table);
  }
  await db.update(channels).set({ activeAgentId: null });
  await db.delete(channels);
  await db.delete(agents);
}

beforeEach(async () => {
  await clear();
  await createBusiness({ name: "Peluquería Lola", timezone: "Europe/Madrid", aiDisclosureText: null });
  channel = await createWhatsAppChannel();
  owner ??= await createUser("owner");
  useFakeMeta();
});

afterEach(() => {
  registerChannelAdapter(whatsappAdapter);
  vi.unstubAllEnvs();
});

describe("the 24 h window of a WhatsApp conversation [WA-43] [BAN-08]", () => {
  it("counts 24 h from the customer's last message, as Meta dates it", async () => {
    const conversationId = await receive(T);
    const state = (now: Date) => getWhatsAppInboxState(owner.actor, conversationId, { now });
    expect((await state(hoursAfter(T, 23)))?.window).toEqual({ open: true, closesAt: hoursAfter(T, 24), closedByMeta: false });
    expect((await state(new Date(hoursAfter(T, 24).getTime() + 1)))?.window).toEqual({ open: false, closesAt: hoursAfter(T, 24), closedByMeta: false });
  });

  it("our own messages never renew it; the customer's next message does", async () => {
    const conversationId = await receive(T);
    await sendOutbound({ conversationId, sender: { type: "human", userId: owner.userId, name: owner.name }, text: "¿Te va bien el jueves?", now: hoursAfter(T, 20), retryDelayMs: 0 });
    expect((await getWhatsAppInboxState(owner.actor, conversationId, { now: hoursAfter(T, 25) }))?.window.open).toBe(false);

    await receive(hoursAfter(T, 30));
    expect((await getWhatsAppInboxState(owner.actor, conversationId, { now: hoursAfter(T, 31) }))?.window).toEqual({ open: true, closesAt: hoursAfter(T, 54), closedByMeta: false });
  });

  it("closed while the customer never wrote", async () => {
    const { contact } = await customer();
    const conversation = await createConversation(channel.id, contact.id, { lastInboundAt: null });
    expect((await getWhatsAppInboxState(owner.actor, conversation.id))?.window).toEqual({ open: false, closesAt: null, closedByMeta: false });
  });

  it("when Meta answers 131047 it stays closed, even within our 24 h, until the customer writes again", async () => {
    const conversationId = await receive(hoursAgo(1));
    useFakeMeta(connectedNumberRoutes({ [`POST /${WA_TEST.phoneNumberId}/messages`]: () => metaError(131047, 400) }));
    const sent = await sendHumanMessage(owner.actor, { conversationId, text: "¿Sigues ahí?" });
    expect(sent.status).toBe("failed");
    // The failed message shows Meta's error in Spanish, with its code ([BAN-13], [WA-09]).
    expect(sent.error).toMatchObject({ code: 131047, message: expect.stringContaining("La ventana de 24 h está cerrada") });
    expect((await getWhatsAppInboxState(owner.actor, conversationId))?.window).toMatchObject({ open: false, closedByMeta: true });

    await receive(new Date(Date.now() + 1_000));
    expect((await getWhatsAppInboxState(owner.actor, conversationId))?.window).toMatchObject({ open: true, closedByMeta: false });
  });

  it("other channels have no window here", async () => {
    const web = await createChannel({ type: "webchat", name: "Web" });
    const { contact } = await createContactWithIdentity("webchat");
    const conversation = await createConversation(web.id, contact.id);
    expect(await getWhatsAppInboxState(owner.actor, conversation.id)).toBeNull();
  });
});

describe("templates offered by the inbox [BAN-08] [WA-22] [CAN-14]", () => {
  it("only the approved templates of the conversation's channel, for whoever may reply there", async () => {
    const approved = await addTemplate();
    await addTemplate({ name: "promo_rechazada", status: "REJECTED", rejectedReason: "INVALID_FORMAT" });
    await addTemplate({ name: "pendiente", status: "PENDING" });
    const other = await createWhatsAppChannel({ name: "Otro número", phoneNumberId: "200000000000099" });
    await db.insert(whatsappTemplates).values({ channelId: other.id, name: "del_otro", language: "es", status: "APPROVED", components: [], variables: [] });
    const conversation = await conversationLastWritten(30);

    const state = await getWhatsAppInboxState(owner.actor, conversation.id);
    expect(state?.templates).toEqual([{ id: approved.id, name: "recordatorio_cita", language: "es", category: "UTILITY", components: templateComponents }]);
    expect(state?.optedOut).toBe(false);
  });

  it("Solo lectura sees the window but gets no templates [PER-03]", async () => {
    await addTemplate();
    const conversation = await conversationLastWritten(30);
    const state = await getWhatsAppInboxState(actorFor("viewer"), conversation.id);
    expect(state?.window.open).toBe(false);
    expect(state?.templates).toEqual([]);
  });

  it("a customer who opted out in this channel is flagged [CUM-03]", async () => {
    const conversation = await conversationLastWritten(30);
    await db.insert(consents).values({ contactId: conversation.contactId ?? "", channelId: channel.id, channelType: "whatsapp", type: "opt_out", source: "keyword" });
    expect((await getWhatsAppInboxState(owner.actor, conversation.id))?.optedOut).toBe(true);
  });
});

describe("sending a template from the inbox [WA-42] [WA-43] [BAN-08] [BAN-11]", () => {
  it("outside the window free text is refused and an approved template goes with its variables", async () => {
    const template = await addTemplate();
    const conversation = await conversationLastWritten(30);

    await expect(sendHumanMessage(owner.actor, { conversationId: conversation.id, text: "Hola" })).rejects.toBeInstanceOf(ConflictError);
    expect(sentToMeta()).toHaveLength(0);

    const sent = await sendHumanTemplateMessage(owner.actor, { conversationId: conversation.id, templateId: template.id, values: REMINDER_VALUES });
    expect(sent.status).toBe("sent");
    expect(sent.aiPausedUntil).toBeInstanceOf(Date);

    expect(sentToMeta()).toHaveLength(1);
    expect(sentToMeta()[0].body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: `+${WA_TEST.customer.waId}`,
      type: "template",
      template: {
        name: "recordatorio_cita",
        language: { code: "es" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", parameter_name: "nombre", text: "Ana" },
              { type: "text", parameter_name: "fecha", text: "3 de octubre" },
              { type: "text", parameter_name: "hora", text: "10:30" },
            ],
          },
        ],
      },
    });
    const [stored] = await outboundOf(conversation.id);
    expect(stored).toMatchObject({ contentType: "template", text: REMINDER_TEXT, senderType: "human", senderUserId: owner.userId, status: "sent", externalId: expect.stringMatching(/^wamid\.TEST_OUT_\d+$/) });
    expect(stored.metadata.templateId).toBe(template.id);
    const row = await conversationRow(conversation.id);
    expect(row.aiPausedUntil?.getTime()).toBe(sent.aiPausedUntil?.getTime());
    expect(row.pauseReason).toContain(owner.name);
  });

  it("positional parameters go in their order, without names", async () => {
    const template = await addTemplate({
      name: "aviso_general",
      language: "es_ES",
      category: "MARKETING",
      components: [{ type: "BODY", text: "Hola {{1}}, tenemos hueco el {{2}}." }],
      variables: ["1", "2"],
    });
    const conversation = await conversationLastWritten(30);
    await sendHumanTemplateMessage(owner.actor, { conversationId: conversation.id, templateId: template.id, values: { "2": "jueves", "1": "Ana" } });
    expect((sentToMeta()[0].body as { template: unknown }).template).toEqual({
      name: "aviso_general",
      language: { code: "es_ES" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Ana" },
            { type: "text", text: "jueves" },
          ],
        },
      ],
    });
  });

  it("a person sends at most 30 templates a minute (Meta may bill each): the next one waits and reaches nobody [SEG-07]", async () => {
    const template = await addTemplate();
    const conversation = await conversationLastWritten(30);
    const admin = await createUser("admin");
    await db.insert(rateLimits).values({ key: `wa:template:${admin.userId}`, count: WHATSAPP_LIMITS.template.limit - 1, windowStart: new Date() });
    const send = () => sendHumanTemplateMessage(admin.actor, { conversationId: conversation.id, templateId: template.id, values: REMINDER_VALUES });
    expect((await send()).status).toBe("sent");
    await expect(send()).rejects.toBeInstanceOf(RateLimitError);
    expect(sentToMeta()).toHaveLength(1);
    expect(await outboundOf(conversation.id)).toHaveLength(1);
  });

  it("an invalid template or value sends nothing and stores nothing", async () => {
    const template = await addTemplate();
    const rejected = await addTemplate({ name: "promo_rechazada", status: "REJECTED" });
    const withImage = await addTemplate({ name: "oferta_imagen", components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Oferta para {{1}}" }], variables: ["1"] });
    const other = await createWhatsAppChannel({ name: "Otro número", phoneNumberId: "200000000000099" });
    const [foreign] = await db.insert(whatsappTemplates).values({ channelId: other.id, name: "del_otro", language: "es", status: "APPROVED", components: [], variables: [] }).returning();
    const conversation = await conversationLastWritten(30);
    const send = (input: Record<string, unknown>) => sendHumanTemplateMessage(owner.actor, { conversationId: conversation.id, ...input });

    await expect(send({ templateId: template.id, values: { nombre: "Ana", fecha: "3 de octubre" } })).rejects.toMatchObject({ userMessage: "Falta el dato «hora» de la plantilla." });
    await expect(send({ templateId: template.id, values: { ...REMINDER_VALUES, hora: "x".repeat(1_025) } })).rejects.toBeInstanceOf(ValidationError);
    await expect(send({ templateId: rejected.id, values: REMINDER_VALUES })).rejects.toMatchObject({ userMessage: "Esta plantilla no está aprobada por Meta." });
    await expect(send({ templateId: withImage.id, values: { "1": "Ana" } })).rejects.toMatchObject({ userMessage: "La plantilla necesita un archivo en la cabecera." });
    await expect(send({ templateId: foreign.id, values: {} })).rejects.toBeInstanceOf(NotFoundError);
    await expect(send({ templateId: template.id, values: REMINDER_VALUES, text: "texto libre" })).rejects.toBeInstanceOf(ValidationError);
    await expect(send({ templateId: "no-es-un-id", values: REMINDER_VALUES })).rejects.toBeInstanceOf(ValidationError);

    expect(sentToMeta()).toHaveLength(0);
    expect(await outboundOf(conversation.id)).toHaveLength(0);
    expect((await conversationRow(conversation.id)).aiPausedUntil).toBeNull();
  });

  it("a disabled channel sends nothing [CAN-16]; a customer who opted out gets no templates [CUM-03]", async () => {
    const template = await addTemplate();
    const conversation = await conversationLastWritten(30);
    await db.insert(consents).values({ contactId: conversation.contactId ?? "", channelId: channel.id, channelType: "whatsapp", type: "opt_out", source: "keyword" });
    await expect(sendHumanTemplateMessage(owner.actor, { conversationId: conversation.id, templateId: template.id, values: REMINDER_VALUES })).rejects.toMatchObject({
      userMessage: expect.stringContaining("se ha dado de baja"),
    });

    await db.delete(consents);
    await db.update(channels).set({ status: "disabled" }).where(eq(channels.id, channel.id));
    await expect(sendHumanTemplateMessage(owner.actor, { conversationId: conversation.id, templateId: template.id, values: REMINDER_VALUES })).rejects.toMatchObject({
      userMessage: "El canal está desactivado: no se pueden enviar mensajes.",
    });
    expect(sentToMeta()).toHaveLength(0);
    expect(await outboundOf(conversation.id)).toHaveLength(0);
  });

  it("the estimated cost and category of a sent message reach the inbox once Meta prices it [WA-47]", async () => {
    const template = await addTemplate();
    const conversation = await conversationLastWritten(30);
    const sent = await sendHumanTemplateMessage(owner.actor, { conversationId: conversation.id, templateId: template.id, values: REMINDER_VALUES });
    const before = (await listMessages(owner.actor, { conversationId: conversation.id })).items.find((item) => item.id === sent.messageId);
    expect(before?.pricing).toBeNull();

    await db.update(messages).set({ pricingType: "regular", pricingCategory: "utility", costEstimate: 0.0085 }).where(eq(messages.id, sent.messageId));
    const after = (await listMessages(owner.actor, { conversationId: conversation.id })).items.find((item) => item.id === sent.messageId);
    expect(after?.pricing).toEqual({ type: "regular", category: "utility", costEstimate: 0.0085 });
  });
});

describe("who may send a template [PER-02] [PER-03] (Bandeja: responder, enviar plantillas y adjuntos)", () => {
  it("an agent of the channel can; an agent of another channel and Solo lectura cannot, and nothing changes", async () => {
    const template = await addTemplate();
    const conversation = await conversationLastWritten(30);
    const other = await createWhatsAppChannel({ name: "Otro número", phoneNumberId: "200000000000099" });
    const input = { conversationId: conversation.id, templateId: template.id, values: REMINDER_VALUES };

    const outsider: Actor = actorFor("agent", { channelIds: [other.id] });
    await expect(sendHumanTemplateMessage(outsider, input)).rejects.toBeInstanceOf(AuthError);
    await expect(getWhatsAppInboxState(outsider, conversation.id)).rejects.toBeInstanceOf(AuthError);
    await expect(sendHumanTemplateMessage(actorFor("viewer"), input)).rejects.toBeInstanceOf(AuthError);
    expect(sentToMeta()).toHaveLength(0);
    expect(await outboundOf(conversation.id)).toHaveLength(0);

    const agent = await createUser("agent", { channelIds: [channel.id] });
    expect((await getWhatsAppInboxState(agent.actor, conversation.id))?.templates.map((item) => item.id)).toEqual([template.id]);
    expect((await sendHumanTemplateMessage(agent.actor, input)).status).toBe("sent");
    const supervisor = await createUser("supervisor");
    expect((await sendHumanTemplateMessage(supervisor.actor, input)).status).toBe("sent");
    expect((await outboundOf(conversation.id)).map((row) => row.senderUserId)).toEqual([agent.userId, supervisor.userId]);
  });
});

describe("sendTemplateMessage: a template sent by the app itself (reminders) [AGD-24] [WA-42] [CAN-12]", () => {
  it("finds the approved template by name and language and writes in the contact's one conversation of the channel", async () => {
    await addTemplate({ language: "es_ES" });
    const { contact } = await customer();
    const input = { channelId: channel.id, contactId: contact.id, templateName: "recordatorio_cita", language: "es-ES", variables: REMINDER_VALUES };

    const first = await sendTemplateMessage(input);
    expect(first).toMatchObject({ status: "sent", error: null });
    const second = await sendTemplateMessage(input);
    expect(second.conversationId).toBe(first.conversationId);
    expect(await db.select().from(conversations).where(eq(conversations.contactId, contact.id))).toHaveLength(1);

    const stored = await outboundOf(first.conversationId);
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ contentType: "template", senderType: "system", text: REMINDER_TEXT, status: "sent" });
    expect(sentToMeta()).toHaveLength(2);
    expect(sentToMeta()[0].body).toMatchObject({ to: `+${WA_TEST.customer.waId}`, type: "template", template: { name: "recordatorio_cita", language: { code: "es_ES" } } });
  });

  it("uses the conversation that already exists", async () => {
    await addTemplate();
    const conversation = await conversationLastWritten(48);
    const sent = await sendTemplateMessage({ channelId: channel.id, contactId: conversation.contactId ?? "", templateName: "recordatorio_cita", language: "es", variables: REMINDER_VALUES });
    expect(sent.conversationId).toBe(conversation.id);
  });

  it("refuses what cannot be sent, and sends nothing", async () => {
    await addTemplate();
    await addTemplate({ name: "promo_rechazada", status: "REJECTED" });
    const { contact } = await customer();
    const base = { channelId: channel.id, contactId: contact.id, templateName: "recordatorio_cita", language: "es", variables: REMINDER_VALUES };

    await expect(sendTemplateMessage({ ...base, templateName: "no_existe" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(sendTemplateMessage({ ...base, language: "en_US" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(sendTemplateMessage({ ...base, templateName: "promo_rechazada" })).rejects.toMatchObject({ userMessage: "Esta plantilla no está aprobada por Meta." });
    await expect(sendTemplateMessage({ ...base, variables: { nombre: "Ana" } })).rejects.toBeInstanceOf(ValidationError);
    await expect(sendTemplateMessage({ ...base, templateName: "Nombre con espacios; DROP" })).rejects.toBeInstanceOf(ValidationError);
    await expect(sendTemplateMessage({ ...base, contactId: crypto.randomUUID() })).rejects.toBeInstanceOf(NotFoundError);

    const { contact: webOnly } = await createContactWithIdentity("webchat");
    await expect(sendTemplateMessage({ ...base, contactId: webOnly.id })).rejects.toBeInstanceOf(ConflictError);

    await db.insert(consents).values({ contactId: contact.id, channelId: channel.id, channelType: "whatsapp", type: "opt_out", source: "keyword" });
    await expect(sendTemplateMessage(base)).rejects.toMatchObject({ userMessage: expect.stringContaining("se ha dado de baja") });
    await db.insert(consents).values({ contactId: contact.id, channelId: channel.id, channelType: "whatsapp", type: "opt_in", source: "person", createdAt: new Date(Date.now() + 1_000) });

    await db.update(channels).set({ status: "disabled" }).where(eq(channels.id, channel.id));
    await expect(sendTemplateMessage(base)).rejects.toBeInstanceOf(ConflictError);
    expect(sentToMeta()).toHaveLength(0);
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it("on a demo channel nothing leaves the app [ARR-11]", async () => {
    await db.update(channels).set({ isDemo: true }).where(eq(channels.id, channel.id));
    await addTemplate();
    const { contact } = await customer();
    const sent = await sendTemplateMessage({ channelId: channel.id, contactId: contact.id, templateName: "recordatorio_cita", language: "es", variables: REMINDER_VALUES });
    expect(sent.status).toBe("sent");
    expect(metaCalls).toHaveLength(0);
  });
});

describe("the AI never writes outside the window [WA-43]", () => {
  const NOW = new Date("2026-09-30T09:00:00Z");

  function openRouter() {
    return fakeFetch(
      routes({
        "GET /models/user": () => jsonResponse({ data: sampleCatalog() }),
        "POST /chat/completions": () => jsonResponse(chatCompletion({ content: "¡Hola! ¿En qué te ayudo?" })),
      }),
    );
  }

  async function replyTo(sentAt: Date) {
    const agent = await createAgentRow({ name: "Recepción" });
    await db.update(channels).set({ activeAgentId: agent.id }).where(eq(channels.id, channel.id));
    channel = { ...channel, activeAgentId: agent.id };
    const result = await ingestEvents(
      channel,
      [{ kind: "inbound_message", externalId: crypto.randomUUID(), sender: { externalIds: [WA_TEST.customer.bsuid], phone: WA_TEST.customer.waId, displayName: "Ana" }, contentType: "text", text: "Hola", sentAt }],
      { now: new Date(NOW.getTime() - 5_000) },
    );
    const conversationId = result.messages[0].conversationId ?? "";
    const [job] = await db.select().from(jobs).where(and(eq(jobs.type, REPLY_JOB), eq(jobs.dedupeKey, `reply:${conversationId}`)));
    const fake = openRouter();
    const outcome = await processReplyJob(replyJobPayload.parse(job.payload) as ReplyJobPayload, { job, rescheduleAt: () => undefined, remainingMs: () => 120_000 }, { fetchImpl: fake.fetch, now: NOW, retryDelayMs: 0 });
    return { outcome, chatCalls: fake.calls.filter((call) => call.path === "/chat/completions"), conversationId };
  }

  beforeEach(async () => {
    await ensureSettingsRows();
    await db.update(integrationSettings).set({ zdr: false });
    vi.stubEnv("OPENROUTER_API_KEY", FAKE_OPENROUTER_KEY);
  });

  it("a customer message older than 24 h (Meta's time) gets no AI reply and nothing goes to Meta", async () => {
    const { outcome, chatCalls, conversationId } = await replyTo(new Date(NOW.getTime() - WHATSAPP_WINDOW_MS - 60_000));
    expect(outcome).toEqual({ kind: "skipped", reason: "window_closed" });
    expect(chatCalls).toHaveLength(0);
    expect(sentToMeta()).toHaveLength(0);
    expect(await outboundOf(conversationId)).toHaveLength(0);
  });

  it("inside the window the AI answers once, through Meta", async () => {
    const { outcome, chatCalls } = await replyTo(new Date(NOW.getTime() - 60_000));
    expect(outcome.kind).toBe("replied");
    expect(chatCalls).toHaveLength(1);
    expect(sentToMeta()).toHaveLength(1);
    expect(sentToMeta()[0].body).toMatchObject({ type: "text" });
  });
});
