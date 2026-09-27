// Demo channels, contacts and conversations of `pnpm seed` (seed/steps/channels.ts, seed/steps/conversations.ts) and
// the demo's generated media (seed/media) ([ARR-06]–[ARR-08], [ARR-10], [ARR-11]). The inbox data layer reads what the
// seed writes, as the screens will. (Kept here because Vitest only collects tests under src/ and scripts/.)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listChannels } from "@/data/channels";
import { getContact } from "@/data/contacts";
import { getConversation, getInboxCounts, listConversations } from "@/data/conversations";
import { canViewMessageMedia, listMessages } from "@/data/messages";
import { listMyNotifications } from "@/data/notifications";
import { simulateInboundMessage } from "@/data/simulator";
import { db } from "@/db";
import {
  agents,
  aiRuns,
  appKv,
  channels,
  consents,
  contactIdentities,
  contacts,
  conversations,
  handoffEvents,
  internalNotes,
  jobs,
  messages,
  user,
  userRoles,
} from "@/db/schema";
import { SECTORS, type Role, type Sector } from "@/lib/enums";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import type { Actor } from "@/lib/permissions";
import { getSectorPreset } from "@/lib/sectors";
import { DiskStorage } from "@/server/adapters/file-storage";
import { demoAdapter, getChannelAdapter, webchatAdapter } from "@/server/channels";
import { findPhrase } from "@/server/engine/rules";
import { ROUND_ROBIN_KEY_PREFIX } from "@/server/handoff/service";
import { DEMO_BUSINESSES } from "../../seed/businesses";
import { demoLegalTexts } from "../../seed/legal";
import { DEMO_VOICE_NOTE_SECONDS, demoMediaFiles, demoMediaStorage, simulatorSample, writeDemoMedia } from "../../seed/media";
import { DEMO_IMAGE_HEIGHT, DEMO_IMAGE_WIDTH } from "../../seed/media/png";
import { wavDurationSeconds } from "../../seed/media/wav";
import { buildDemoAgents } from "../../seed/steps/agents";
import { buildDemoChannels } from "../../seed/steps/channels";
import { describeOpeningHours } from "../../seed/steps/conversation-scripts";
import { buildDemoConversations, demoBookingSlot, demoMediaRef, type DemoConversationsInput } from "../../seed/steps/conversations";
import { DEMO_USERS } from "../../seed/users";
import { runSeedCommand } from "./seed-command";
import { captureOutput, emptyDatabase, tableCounts } from "./testing";

const DEMO_ENV = { DEMO_MODE: "true", NODE_ENV: "development" };
const NOW = new Date("2026-09-26T10:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

async function seed(argv: string[] = []) {
  const code = await runSeedCommand(argv, { out: captureOutput(), env: DEMO_ENV, now: NOW });
  expect(code).toBe(0);
}

async function demoActor(role: Role): Promise<Actor> {
  const demoUser = DEMO_USERS.find((candidate) => candidate.role === role);
  const [row] = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .innerJoin(userRoles, eq(userRoles.userId, user.id))
    .where(eq(user.email, demoUser?.email ?? ""));
  return { userId: row.id, role, name: row.name, channelIds: null };
}

async function channelByType(type: "webchat" | "whatsapp" | "email_gmail") {
  const [row] = await db.select().from(channels).where(eq(channels.type, type));
  return row;
}

async function conversationOf(contactName: string) {
  const [row] = await db
    .select({ conversation: conversations })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(contacts.name, contactName));
  return row.conversation;
}

const messagesOf = (conversationId: string) => db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt));

describe("demo channels and conversations (pnpm seed)", () => {
  beforeAll(async () => {
    await emptyDatabase();
    await seed();
  });

  it("[ARR-06] [ARR-11] [CAN-03] [CAN-07] a real web chat, and a WhatsApp and an email marked «Demo», each with its active agent and the AI on", async () => {
    const [webchat, whatsapp, email] = await Promise.all([channelByType("webchat"), channelByType("whatsapp"), channelByType("email_gmail")]);
    expect(await db.select().from(channels)).toHaveLength(3);
    const agentName = async (id: string | null) => (await db.select({ name: agents.name }).from(agents).where(eq(agents.id, id ?? "")))[0]?.name;
    const reception = getSectorPreset("peluqueria").agentTemplate.name;

    expect(webchat).toMatchObject({ isDemo: false, status: "connected", aiEnabled: true, testMode: false, replyMode: "auto" });
    expect(webchat.config).toMatchObject({ voiceEnabled: true, imagesEnabled: true, allowedDomains: [] });
    expect(whatsapp).toMatchObject({ isDemo: true, status: "connected", aiEnabled: true, testMode: false, replyMode: "auto", displayPhoneNumber: DEMO_BUSINESSES.peluqueria.contactPhone });
    expect(whatsapp.phoneNumberId).toBeNull();
    expect(email).toMatchObject({ isDemo: true, status: "connected", aiEnabled: true, testMode: false, replyMode: "draft" });
    expect(await agentName(webchat.activeAgentId)).toBe(reception);
    expect(await agentName(whatsapp.activeAgentId)).toBe(reception);
    expect(await agentName(email.activeAgentId)).toBe("Asistente de correo");
    // Demo WhatsApp and email never call Meta, Google or a mail server ([ARR-11]); the web chat is a real one.
    expect(getChannelAdapter(whatsapp)).toBe(demoAdapter);
    expect(getChannelAdapter(email)).toBe(demoAdapter);
    expect(getChannelAdapter(webchat)).toBe(webchatAdapter);
    for (const channel of [webchat, whatsapp, email]) expect(channel.secretsEnc).toBeNull();

    const listed = await listChannels(await demoActor("owner"));
    expect(listed.map((channel) => [channel.name, channel.isDemo, channel.activeAgent?.name])).toEqual([
      ["Chat de la web", false, reception],
      ["Correo", true, "Asistente de correo"],
      ["WhatsApp", true, reception],
    ]);
    // Each one says when its last customer message arrived ([CAN-01]).
    for (const channel of listed) expect(channel.lastInboundAt).not.toBeNull();
  });

  it("[ARR-08] [MED-04] a voice note keeps its transcript and an image its description, both with their stored file", async () => {
    const voice = (await messagesOf((await conversationOf("Antonio Ramos")).id))[0];
    expect(voice).toMatchObject({ contentType: "audio", direction: "inbound", status: "received", text: null });
    expect(voice.transcript).toMatch(/mechas/);
    expect(voice.media).toMatchObject({ fileKey: "demo/nota-de-voz.wav", mimeType: "audio/wav", downloadStatus: "done", durationSec: DEMO_VOICE_NOTE_SECONDS });
    expect(voice.media?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(voice.media?.size).toBeGreaterThan(0);

    const image = (await messagesOf((await conversationOf("Sergio Vidal")).id))[0];
    expect(image).toMatchObject({ contentType: "image", direction: "inbound" });
    expect(image.text).toBeTruthy();
    expect(image.metadata.imageDescription).toMatch(/cobrizo/);
    expect(image.media).toMatchObject({ fileKey: "demo/imagen-peluqueria.png", mimeType: "image/png" });

    const runs = await db.select().from(aiRuns).where(eq(aiRuns.messageId, voice.id));
    expect(runs).toEqual([expect.objectContaining({ kind: "transcription", modelRequested: DEFAULT_MODELS.transcription })]);
    expect(await db.select().from(aiRuns).where(and(eq(aiRuns.messageId, image.id), eq(aiRuns.kind, "image_description")))).toHaveLength(1);
  });

  it("[ARR-08] [TRA-02] [TRA-04] [TRA-05] [TRA-07] a hand-off waits for a person: assigned by turns, urgent, notified and with the agent's message", async () => {
    const conversation = await conversationOf("Beatriz Molina");
    const agentUser = await demoActor("agent");
    const supervisor = await demoActor("supervisor");
    expect(conversation).toMatchObject({ status: "pending_human", aiMode: "human", assignedUserId: agentUser.userId, unreadCount: 2 });
    expect(conversation.pauseReason).toMatch(/^Traspaso a una persona: /);

    const [event] = await db.select().from(handoffEvents).where(eq(handoffEvents.conversationId, conversation.id));
    expect(event).toMatchObject({ trigger: "ai_tool", urgency: "high", assignedUserId: agentUser.userId, firstHumanResponseAt: null });
    expect(event.reason).toBeTruthy();
    expect(event.summary).toBeTruthy();

    const thread = await messagesOf(conversation.id);
    expect(thread.map((message) => message.senderType)).toEqual(["contact", "ai", "contact"]);
    const [receptionRow] = await db.select().from(agents).where(eq(agents.id, thread[1].agentId ?? ""));
    expect([receptionRow.handoff.messageInHours, receptionRow.handoff.messageOffHours].some((text) => text && thread[1].text?.endsWith(text))).toBe(true);
    expect(thread[1].metadata).toMatchObject({ handoff: true });
    const [run] = await db.select().from(aiRuns).where(eq(aiRuns.messageId, thread[1].id));
    expect(run.toolsUsed).toEqual([{ name: "transferir_a_humano", ok: true }]);

    // The supervisor (the agent's «A quién avisar») and the assignee are told, unread ([TRA-05], [PWA-06]).
    const titles = async (actor: Actor) => (await listMyNotifications(actor)).filter((item) => item.link === `/bandeja/${conversation.id}`);
    expect((await titles(supervisor)).map((item) => [item.title, item.readAt])).toEqual([["Traspaso urgente: Beatriz Molina", null]]);
    expect((await titles(agentUser)).map((item) => [item.title, item.readAt])).toEqual([["Conversación asignada: Beatriz Molina", null]]);
    // The next hand-off of this channel goes to the next person ([TRA-04]).
    const [pointer] = await db.select().from(appKv).where(eq(appKv.key, `${ROUND_ROBIN_KEY_PREFIX}${conversation.channelId}`));
    expect(pointer.value).toBe(agentUser.userId);
  });

  it("[ARR-08] [TRA-06] [TRA-08] [BAN-07] a conversation handed off, answered by a person within 3 minutes and resolved, with an internal note", async () => {
    const conversation = await conversationOf("Cristina Herrero");
    const supervisor = await demoActor("supervisor");
    expect(conversation).toMatchObject({ status: "resolved", aiMode: "ai", assignedUserId: supervisor.userId, unreadCount: 0 });
    const thread = await messagesOf(conversation.id);
    expect(thread.map((message) => message.senderType)).toEqual(["contact", "ai", "human", "contact", "human"]);
    expect(thread.filter((message) => message.senderType === "human").every((message) => message.senderName === "Carmen López")).toBe(true);
    const [event] = await db.select().from(handoffEvents).where(eq(handoffEvents.conversationId, conversation.id));
    expect(event.firstHumanMessageId).toBe(thread[2].id);
    const responseMs = (event.firstHumanResponseAt?.getTime() ?? Infinity) - event.requestedAt.getTime();
    expect(responseMs).toBeGreaterThan(0);
    expect(responseMs).toBeLessThan(3 * 60 * 1000);
    const [note] = await db.select().from(internalNotes).where(eq(internalNotes.conversationId, conversation.id));
    expect(note).toMatchObject({ authorName: "Carmen López", authorUserId: supervisor.userId });
    expect((await listMyNotifications(supervisor)).filter((item) => item.link === `/bandeja/${conversation.id}`).every((item) => item.readAt !== null)).toBe(true);
  });

  it("[ARR-08] [CAN-07] [CAN-12] [COR-21] an email thread with a formal AI reply that was sent and a new draft waiting for review", async () => {
    const conversation = await conversationOf("Isabel Prieto");
    expect(conversation.externalThreadId).toBeTruthy();
    expect(conversation.metadata.subject).toBeTruthy();
    const thread = await messagesOf(conversation.id);
    expect(thread.map((message) => [message.senderType, message.status])).toEqual([
      ["contact", "received"],
      ["ai", "sent"],
      ["contact", "received"],
      ["ai", "draft"],
    ]);
    expect(thread[1].agentName).toBe("Asistente de correo");
    for (const reply of [thread[1], thread[3]]) {
      expect(reply.text).toContain("Hola, Isabel:");
      expect(reply.text).toMatch(/Un saludo,\nEquipo de Peluquería Aurora/);
      expect(reply.text).toMatch(/asistente de inteligencia artificial/);
    }
    expect(thread[3].externalId).toBeNull();
    expect(conversation.lastOutboundAt?.getTime()).toBe(thread[1].createdAt.getTime());
  });

  it("[CUM-01] the first AI message of every conversation starts with the AI notice, and only the first", async () => {
    const notice = demoLegalTexts(DEMO_BUSINESSES.peluqueria).aiDisclosureText;
    for (const conversation of await db.select().from(conversations)) {
      const ai = (await messagesOf(conversation.id)).filter((message) => message.senderType === "ai");
      if (ai.length === 0) continue;
      expect(ai[0].text?.startsWith(`${notice}\n\n`)).toBe(true);
      for (const later of ai.slice(1)) expect(later.text).not.toContain(notice);
    }
  });

  it("[MOT-11] [INF-07] every AI message has its AI run with tokens and cost; nothing is scheduled, the seed never calls the AI", async () => {
    const aiMessages = await db.select().from(messages).where(eq(messages.senderType, "ai"));
    expect(aiMessages.length).toBeGreaterThanOrEqual(9);
    const runs = await db.select().from(aiRuns);
    for (const message of aiMessages) {
      const run = runs.find((candidate) => candidate.messageId === message.id && candidate.kind === "chat");
      expect(run, message.text ?? "").toBeDefined();
      expect(message.metadata.aiRunId).toBe(run?.id);
      expect(run).toMatchObject({ ok: true, isTest: false, agentId: message.agentId, modelRequested: DEFAULT_MODELS.chat });
      expect(run?.costUsd).toBeGreaterThan(0);
      expect(run?.totalTokens).toBe((run?.promptTokens ?? 0) + (run?.completionTokens ?? 0));
    }
    expect(runs.every((run) => run.conversationId && (run.costUsd ?? 0) > 0)).toBe(true);
    expect(await db.select().from(jobs)).toEqual([]);
  });

  it("[ARR-07] everything happened in the week before the load, in order, and WhatsApp replies went out free inside the service window", async () => {
    const all = await db.select().from(messages);
    for (const message of all) {
      expect(message.createdAt.getTime()).toBeLessThan(NOW.getTime());
      expect(message.createdAt.getTime()).toBeGreaterThan(NOW.getTime() - 7 * DAY_MS);
    }
    const whatsapp = await channelByType("whatsapp");
    const outbound = all.filter((message) => message.channelId === whatsapp.id && message.direction === "outbound");
    expect(outbound.every((message) => ["delivered", "read"].includes(message.status) && message.pricingType === "free_customer_service" && message.costEstimate === 0)).toBe(true);
    const booking = await conversationOf("Laura Gil");
    // The last customer message is recent enough to answer without a template ([WA-43]).
    expect(NOW.getTime() - (booking.lastInboundAt?.getTime() ?? 0)).toBeLessThan(DAY_MS);
  });

  it("[CAN-13] [CTO-02] [CTO-03] [CUM-13] contacts have their identities per channel (never the phone as WhatsApp key), labels and consents", async () => {
    const owner = await demoActor("owner");
    const laura = await getContact(owner, (await conversationOf("Laura Gil")).contactId ?? "");
    expect(laura).toMatchObject({ phone: "34600000201", labels: ["cliente habitual"] });
    expect(Object.keys(laura.customFields)).toHaveLength(1);
    const whatsappIds = laura.identities.filter((identity) => identity.channelType === "whatsapp").map((identity) => identity.externalId);
    expect(whatsappIds).toHaveLength(2);
    expect(whatsappIds.some((id) => /^ES\.\d{20}$/.test(id))).toBe(true);
    expect(laura.conversations).toHaveLength(1);

    const identities = await db.select().from(contactIdentities);
    expect(new Set(identities.map((identity) => `${identity.channelType}:${identity.externalId}`)).size).toBe(identities.length);
    const visitors = await db.select().from(contactIdentities).where(eq(contactIdentities.channelType, "webchat"));
    expect(visitors).toHaveLength(2);
    const legal = await db.select().from(consents);
    expect(legal.map((consent) => [consent.type, consent.source, consent.channelType])).toEqual([
      ["legal_acceptance", "widget", "webchat"],
      ["legal_acceptance", "widget", "webchat"],
    ]);
  });

  it("[BAN-01] [BAN-03] [BAN-05] [BAN-12] [MED-08] the inbox reads them: unread counts, the urgent hand-off, authors and media with permission", async () => {
    const owner = await demoActor("owner");
    const agentUser = await demoActor("agent");
    const viewer = await demoActor("viewer");
    expect(await getInboxCounts(owner)).toEqual({ unreadConversations: 4, pendingHuman: 1, mine: 0 });
    expect(await getInboxCounts(agentUser)).toMatchObject({ unreadConversations: 4, pendingHuman: 1, mine: 1 });

    const page = await listConversations(owner, {});
    expect(page.items).toHaveLength(7);
    const pending = page.items.find((item) => item.status === "pending_human");
    expect(pending).toMatchObject({ urgent: true, aiMode: "human", contact: { name: "Beatriz Molina" } });
    expect(page.items.find((item) => item.contact?.name === null)?.channel.type).toBe("webchat");

    const detail = await getConversation(owner, pending?.id ?? "");
    expect(detail.openHandoff).toMatchObject({ trigger: "ai_tool", urgency: "high" });
    expect(detail.window).toMatchObject({ open: true });

    const resolved = await conversationOf("Cristina Herrero");
    const { items } = await listMessages(owner, { conversationId: resolved.id });
    expect(items.map((item) => item.authorName)).toEqual([null, getSectorPreset("peluqueria").agentTemplate.name, "Carmen López", null, "Carmen López"]);

    expect(await canViewMessageMedia(owner, "demo/nota-de-voz.wav")).toBe(true);
    expect(await canViewMessageMedia(viewer, "demo/imagen-peluqueria.png")).toBe(true);
  });

  // Last: it adds a message to the demo.
  it("[AJU-12] the simulator writes as a demo customer into their conversation of the demo WhatsApp", async () => {
    const owner = await demoActor("owner");
    const conversation = await conversationOf("Antonio Ramos");
    const result = await simulateInboundMessage(owner, {
      channelId: conversation.channelId,
      contact: { mode: "existing", contactId: conversation.contactId },
      contentType: "text",
      text: "¿Y el sábado por la mañana tenéis hueco?",
    });
    expect(result).toMatchObject({ conversationId: conversation.id, contactId: conversation.contactId, channelName: "WhatsApp", contactName: "Antonio Ramos" });
    const [after] = await db.select().from(conversations).where(eq(conversations.id, conversation.id));
    expect(after.unreadCount).toBe(conversation.unreadCount + 1);
    const identities = await db.select().from(contactIdentities).where(eq(contactIdentities.contactId, conversation.contactId ?? ""));
    expect(identities).toHaveLength(2);
  });
});

describe("loading the demo again", () => {
  afterAll(async () => {
    await emptyDatabase();
  });

  it("replaces its channels, contacts and conversations instead of duplicating them", async () => {
    await emptyDatabase();
    await seed();
    const first = await tableCounts();
    const firstIds = (await db.select({ id: conversations.id }).from(conversations)).map((row) => row.id);
    await seed();
    expect(await tableCounts()).toEqual(first);
    const secondIds = (await db.select({ id: conversations.id }).from(conversations)).map((row) => row.id);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
    expect(first).toMatchObject({ channels: 3, contacts: 7, conversations: 7, handoff_events: 2, internal_notes: 1 });
  });

  it("[ARR-10] another sector gets its own picture, words and business in the conversations", async () => {
    await emptyDatabase();
    await seed(["--sector=restaurante"]);
    const [image] = await db.select().from(messages).where(eq(messages.contentType, "image"));
    expect(image.media?.fileKey).toBe("demo/imagen-restaurante.png");
    const booking = await messagesOf((await conversationOf("Laura Gil")).id);
    expect(booking[3].text).toMatch(/terraza/);
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, booking[0].conversationId));
    expect(conversation.labels).toEqual(["reserva"]);
  });
});

// ─── Every sector, without the database ─────────────────────────────────────────────────────────────────

function inputFor(sector: Sector): DemoConversationsInput {
  const preset = getSectorPreset(sector);
  const business = DEMO_BUSINESSES[sector];
  const supervisor = { id: crypto.randomUUID(), name: "Carmen López" };
  const plans = buildDemoAgents({ preset, business, models: { model: DEFAULT_MODELS.chat, fallbackModel: DEFAULT_MODELS.fallback }, notifyUserIds: [supervisor.id] });
  const latest = (key: string) => {
    const plan = plans.find((candidate) => candidate.key === key);
    const config = plan?.versions[plan.versions.length - 1].config;
    if (!config) throw new Error(key);
    return { id: crypto.randomUUID(), name: config.name, model: config.model, handoff: config.handoff };
  };
  const files = demoMediaFiles(sector);
  return {
    sector,
    preset,
    business,
    now: NOW,
    timeZone: "Europe/Madrid",
    aiDisclosureText: demoLegalTexts(business).aiDisclosureText,
    channelIds: { webchat: crypto.randomUUID(), whatsapp: crypto.randomUUID(), email: crypto.randomUUID() },
    agents: { reception: latest("recepcion"), email: latest("correo") },
    people: { supervisor, agent: { id: crypto.randomUUID(), name: "Pablo Sánchez" } },
    models: { transcription: DEFAULT_MODELS.transcription, imageDescription: DEFAULT_MODELS.imageDescription },
    media: { voiceNote: demoMediaRef(files.voiceNote, DEMO_VOICE_NOTE_SECONDS), image: demoMediaRef(files.image) },
  };
}

describe.each(SECTORS)("demo conversations of %s [ARR-10]", (sector) => {
  const input = inputFor(sector);
  const rows = buildDemoConversations(input);

  it("[TRA-01] customers never write the agent's hand-off words: the hand-offs are the AI's own decision, as live", () => {
    for (const message of rows.messages.filter((candidate) => candidate.direction === "inbound")) {
      const conversation = rows.conversations.find((candidate) => candidate.id === message.conversationId);
      const agent = conversation?.channelId === input.channelIds.email ? input.agents.email : input.agents.reception;
      const said = [message.text, message.transcript].filter(Boolean).join(" ");
      expect(findPhrase(said, agent.handoff.keywords), said).toBeNull();
      expect(findPhrase(said, agent.handoff.sensitiveTopics), said).toBeNull();
    }
    expect(rows.handoffEvents.every((event) => event.trigger === "ai_tool")).toBe(true);
  });

  it("every text is complete Spanish with the business's data, and the AI confirms the booking it offered", () => {
    for (const message of rows.messages) expect(message.text ?? "", message.id).not.toMatch(/undefined|NaN|null|\$\{/);
    const slot = demoBookingSlot(input);
    const booking = rows.messages.filter((message) => message.conversationId === rows.conversationIds.get("reserva"));
    expect(booking.map((message) => message.senderType)).toEqual(["contact", "ai", "contact", "ai"]);
    expect(booking[3].text).toContain(slot.day);
    expect(booking[3].text).toContain(slot.time);
    const faq = rows.messages.filter((message) => message.conversationId === rows.conversationIds.get("preguntas"));
    expect(faq[1].text).toContain(describeOpeningHours(input.preset.businessHours));
    expect(faq[3].text).toContain(input.business.address);
  });

  it("[ARR-07] the booking falls on a working day of its resource, two to eight days after the load", () => {
    const slot = demoBookingSlot(input);
    const days = (Date.parse(`${slot.date}T00:00:00Z`) - Date.parse("2026-09-26T00:00:00Z")) / DAY_MS;
    expect(days).toBeGreaterThanOrEqual(2);
    expect(days).toBeLessThanOrEqual(8);
    expect(slot.day).toMatch(/^el (lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d{1,2} de [a-z]+$/);
  });

  it("[CUM-01] [MOT-11] [TRA-03] messages go in order, the AI notice leads, each AI message has its run and the hand-off message is the agent's", () => {
    for (const conversation of rows.conversations) {
      const thread = rows.messages.filter((message) => message.conversationId === conversation.id);
      const times = thread.map((message) => message.createdAt?.getTime() ?? 0);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(new Set(times).size).toBe(times.length);
      expect(conversation.unreadCount ?? 0).toBeLessThanOrEqual(thread.filter((message) => message.direction === "inbound").length);
      const ai = thread.filter((message) => message.senderType === "ai");
      if (ai.length > 0) expect(ai[0].text?.startsWith(input.aiDisclosureText)).toBe(true);
      for (const message of ai) {
        expect(rows.aiRuns.some((run) => run.id === message.metadata?.aiRunId && run.messageId === message.id)).toBe(true);
        if (message.metadata?.handoff) {
          const agent = input.agents.reception;
          expect([agent.handoff.messageInHours, agent.handoff.messageOffHours].some((text) => text && message.text?.endsWith(text))).toBe(true);
        }
      }
    }
    expect(rows.conversations).toHaveLength(7);
    expect(rows.handoffEvents).toHaveLength(2);
  });
});

// ─── Generated media ────────────────────────────────────────────────────────────────────────────────────

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const buffer = Buffer.from(bytes);
  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(buffer.subarray(12, 16).toString("ascii")).toBe("IHDR");
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  // The pixel data inflates to one filter byte plus three bytes per pixel on every row.
  const idatLength = buffer.readUInt32BE(33);
  expect(buffer.subarray(37, 41).toString("ascii")).toBe("IDAT");
  expect(inflateSync(buffer.subarray(41, 41 + idatLength))).toHaveLength((1 + width * 3) * height);
  expect(buffer.subarray(buffer.length - 8, buffer.length - 4).toString("ascii")).toBe("IEND");
  return { width, height };
}

describe("demo media [ARR-08]", () => {
  it("tests never write into the project's data/uploads: the seed stores the files only outside Vitest", () => {
    expect(demoMediaStorage()).toBeNull();
  });

  it("stores a playable voice note and the sector's picture under fixed keys, overwriting them on the next load", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-media-"));
    try {
      const storage = new DiskStorage(dir);
      const files = demoMediaFiles("peluqueria");
      await writeDemoMedia([files.voiceNote, files.image], storage);
      await writeDemoMedia([files.voiceNote, files.image], storage);
      const voice = await storage.get("demo/nota-de-voz.wav");
      expect(voice).toMatchObject({ contentType: "audio/wav", size: files.voiceNote.bytes.byteLength });
      expect(await storage.exists("demo/imagen-peluqueria.png")).toBe(true);
      expect(fs.readdirSync(path.join(dir, "demo")).filter((name) => !name.endsWith(".meta.json")).sort()).toEqual(["imagen-peluqueria.png", "nota-de-voz.wav"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the voice note is a valid 8 kHz WAV as long as its transcript", () => {
    const { bytes } = demoMediaFiles("peluqueria").voiceNote;
    const header = Buffer.from(bytes.subarray(0, 44));
    expect(header.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(header.subarray(8, 16).toString("ascii")).toBe("WAVEfmt ");
    expect(header.readUInt32LE(4)).toBe(bytes.byteLength - 8);
    expect(wavDurationSeconds(bytes)).toBe(DEMO_VOICE_NOTE_SECONDS);
    // Not silence: the player has something to play.
    expect(new Set(bytes.subarray(44)).size).toBeGreaterThan(20);
  });

  it.each(SECTORS)("%s has its own valid picture", (sector) => {
    const { bytes } = demoMediaFiles(sector).image;
    expect(pngSize(bytes)).toEqual({ width: DEMO_IMAGE_WIDTH, height: DEMO_IMAGE_HEIGHT });
    expect(bytes.byteLength).toBeLessThan(64 * 1024);
    const others = SECTORS.filter((other) => other !== sector).map((other) => Buffer.from(demoMediaFiles(other).image.bytes));
    expect(others.some((other) => other.equals(Buffer.from(bytes)))).toBe(false);
  });

  it("[AJU-12] the simulator's samples are a WAV, a PNG and a one-page PDF with a correct cross-reference table", () => {
    const context = { sector: "taller" as const, businessName: "Talleres Hermanos Gil" };
    expect(Buffer.from(simulatorSample("audio", context).bytes.subarray(0, 4)).toString("ascii")).toBe("RIFF");
    expect(pngSize(simulatorSample("image", context).bytes)).toEqual({ width: DEMO_IMAGE_WIDTH, height: DEMO_IMAGE_HEIGHT });
    const pdf = Buffer.from(simulatorSample("document", context).bytes);
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    expect(offsets).toHaveLength(6);
    offsets.forEach((offset, index) => expect(text.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true));
    expect(text).toContain("(Para: Talleres Hermanos Gil)");
  });
});

describe("buildDemoChannels", () => {
  it.each(SECTORS)("[ARR-06] %s: a web chat with voice and images, WhatsApp with the business's number and an email with its address", (sector) => {
    const business = DEMO_BUSINESSES[sector];
    const plans = buildDemoChannels(business);
    expect(plans.map((plan) => [plan.key, plan.type, plan.isDemo, plan.agentKey])).toEqual([
      ["webchat", "webchat", false, "recepcion"],
      ["whatsapp", "whatsapp", true, "recepcion"],
      ["email", "email_gmail", true, "correo"],
    ]);
    expect(plans[0].config).toMatchObject({ voiceEnabled: true, imagesEnabled: true });
    expect(String(plans[0].config.welcomeMessage)).toContain(business.name);
    expect(plans[1].whatsapp?.displayPhoneNumber).toBe(business.contactPhone);
    expect(plans[2].config).toEqual({ emailAddress: business.contactEmail });
    // No real numbers or ids that a webhook could match ([ARR-11]).
    expect(JSON.stringify(plans)).not.toMatch(/phoneNumberId|wabaId/);
  });
});
