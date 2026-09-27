// Contacts and conversations of the demo ([ARR-06], [ARR-07], [ARR-08]), for any sector, dated relative to the day
// the demo is loaded. The inbox opens with:
// - a booking inquiry answered by the AI (WhatsApp);
// - a voice note with its transcript already stored, answered by the AI (WhatsApp);
// - an urgent matter the AI handed to a person, still pending, with its hand-off, assignment and notifications (WhatsApp);
// - a conversation handed off, answered and resolved by a person, with an internal note (WhatsApp);
// - an image with its description, answered by the AI (web chat);
// - frequent questions answered by the AI and resolved (web chat, anonymous visitor);
// - a formal email thread: an AI reply approved and sent, and a new draft waiting for review.
// Every AI answer has its ai_runs row with tokens and cost, so the reports have data. Rows look as the live app would
// leave them (ingest, engine, hand-off service), but nothing is scheduled: the seed never calls the AI.
import { createHash } from "node:crypto";
import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { inArray } from "drizzle-orm";
import { contactSearchText } from "@/data/contacts-search";
import { messageSearchText } from "@/server/inbound/message-search";
import { DEFAULT_AI_DISCLOSURE_TEXT } from "@/data/legal-texts";
import { loadBusinessSettings, loadIntegrationSettings } from "@/data/settings";
import type { Transaction } from "@/db";
import {
  agents,
  aiRuns,
  channels,
  consents,
  contactIdentities,
  contacts,
  conversations,
  handoffEvents,
  internalNotes,
  messages,
  notifications,
  type AgentHandoffConfig,
  type MessageMedia,
} from "@/db/schema";
import type { MessageContentType, MessageStatus, Role, Sector, Urgency } from "@/lib/enums";
import { isWithinOpeningHours } from "@/lib/opening-hours";
import { DEFAULT_MODELS } from "@/lib/openrouter/default-models";
import type { SectorPreset } from "@/lib/sectors";
import { ROUND_ROBIN_KEY_PREFIX } from "@/server/handoff/service";
import { setKv } from "@/server/kv";
import type { DemoBusiness } from "../businesses";
import { localDateString } from "../dates";
import { DEMO_VOICE_NOTE_SECONDS, demoMediaFiles, writeDemoMedia, type DemoFile } from "../media";
import type { SeedStep } from "../types";
import { DEMO_USERS } from "../users";
import type { DemoChannelKey } from "./channels";
import { describeOpeningHours, SECTOR_BOOKINGS, sectorScript, clockTime, type SectorScript } from "./conversation-scripts";

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MAX_PAUSE_REASON = 300;

export type DemoAgentRef = { id: string; name: string; model: string | null; handoff: AgentHandoffConfig };
export type DemoPersonRef = { id: string; name: string };
/** What `messages.media` keeps of a stored file (src/server/media/store.ts does the same for real ones). */
export type DemoMediaRef = { fileKey: string; mimeType: string; size: number; fileName: string; sha256: string; durationSec?: number };

export type DemoConversationsInput = {
  sector: Sector;
  preset: SectorPreset;
  business: DemoBusiness;
  now: Date;
  timeZone: string;
  /** The AI notice in front of the first AI message of each conversation ([CUM-01]). */
  aiDisclosureText: string;
  channelIds: Readonly<Record<DemoChannelKey, string>>;
  agents: { reception: DemoAgentRef; email: DemoAgentRef };
  people: { supervisor: DemoPersonRef; agent: DemoPersonRef };
  models: { transcription: string; imageDescription: string };
  media: { voiceNote: DemoMediaRef; image: DemoMediaRef };
};

export type DemoConversationRows = {
  contacts: (typeof contacts.$inferInsert)[];
  identities: (typeof contactIdentities.$inferInsert)[];
  consents: (typeof consents.$inferInsert)[];
  conversations: (typeof conversations.$inferInsert)[];
  messages: (typeof messages.$inferInsert)[];
  aiRuns: (typeof aiRuns.$inferInsert)[];
  handoffEvents: (typeof handoffEvents.$inferInsert)[];
  notes: (typeof internalNotes.$inferInsert)[];
  notifications: (typeof notifications.$inferInsert)[];
  /** app_kv round robin pointer of each channel: the last person it gave a conversation to ([TRA-04]). */
  roundRobin: { channelId: string; userId: string }[];
  /** For channels.last_inbound_at ([CAN-01]). */
  lastInbound: { channelId: string; at: Date }[];
  contactIds: Map<string, string>;
  conversationIds: Map<string, string>;
};

// ─── Example usage of each AI call ──────────────────────────────────────────────────────────────────────

/**
 * Tokens, time and cost of the demo's AI calls, as OpenRouter reports them (usage.cost). They are example records
 * so the reports have data; nothing is ever priced from them.
 */
type ChatUsage = { promptTokens: number; completionTokens: number; cachedTokens: number; costUsd: number; latencyMs: number };
const CHAT_USAGE: readonly ChatUsage[] = [
  { promptTokens: 2_914, completionTokens: 84, cachedTokens: 0, costUsd: 0.000512, latencyMs: 1_830 },
  { promptTokens: 3_102, completionTokens: 61, cachedTokens: 2_688, costUsd: 0.000247, latencyMs: 1_410 },
  { promptTokens: 3_356, completionTokens: 112, cachedTokens: 2_688, costUsd: 0.000318, latencyMs: 2_120 },
  { promptTokens: 2_987, completionTokens: 139, cachedTokens: 0, costUsd: 0.000601, latencyMs: 2_460 },
];
const EMAIL_USAGE: ChatUsage = { promptTokens: 3_480, completionTokens: 246, cachedTokens: 0, costUsd: 0.000884, latencyMs: 3_950 };
const TRANSCRIPTION_USAGE = { costUsd: 0.000105, latencyMs: 1_320 };
const IMAGE_DESCRIPTION_USAGE = { promptTokens: 1_184, completionTokens: 41, costUsd: 0.000093, latencyMs: 1_760 };

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────────────────

/** Name of a preset resource as the demo business calls it, without the note in brackets («Irene (higienista)»). */
function resourceName(preset: SectorPreset, business: DemoBusiness, key: string): string {
  const name = business.resourceNames[key] ?? preset.resources.find((resource) => resource.key === key)?.name;
  if (!name) throw new Error(`El recurso «${key}» no existe en el sector ${preset.slug}.`);
  return name.replace(/\s*\(.*\)$/, "");
}

function priceText(business: DemoBusiness, serviceKey: string): string {
  const price = business.servicePrices[serviceKey];
  if (price === undefined) throw new Error(`La demo no tiene precio de ejemplo para «${serviceKey}».`);
  return `${price} €`;
}

export type BookingSlot = { date: string; minutes: number; day: string; time: string; resource: string };

/**
 * The booking the AI confirms: the first day from two days ahead when the resource works, one hour after its range
 * starts (or at its start if the service would not fit). In the business's time zone ([ARR-07]).
 */
export function demoBookingSlot(input: Pick<DemoConversationsInput, "sector" | "preset" | "business" | "now" | "timeZone">): BookingSlot {
  const choice = SECTOR_BOOKINGS[input.sector];
  const service = input.preset.services.find((candidate) => candidate.key === choice.service);
  const resource = input.preset.resources.find((candidate) => candidate.key === choice.resource);
  if (!service || !resource || !service.resourceKeys.includes(resource.key)) {
    throw new Error(`La reserva de la demo de ${input.sector} no corresponde a su sector.`);
  }
  for (let offset = 2; offset <= 8; offset++) {
    const date = localDateString(input.now, input.timeZone, offset);
    const noon = new Date(`${date}T12:00:00Z`);
    const weekday = ((noon.getUTCDay() + 6) % 7) + 1;
    const ranges = resource.schedule.filter((range) => range.weekday === weekday).sort((a, b) => a.startMin - b.startMin);
    const range = choice.lastRange ? ranges[ranges.length - 1] : ranges[0];
    if (!range) continue;
    const later = range.startMin + 60;
    const minutes = later + service.durationMin <= range.endMin ? later : range.startMin;
    return {
      date,
      minutes,
      day: `el ${format(noon, "EEEE d 'de' MMMM", { locale: es, in: tz("UTC") })}`,
      time: clockTime(minutes),
      resource: resourceName(input.preset, input.business, resource.key),
    };
  }
  throw new Error(`El recurso ${resource.key} no trabaja ningún día de la semana.`);
}

/** A BSUID-like id: country prefix, a dot and digits ([WA-39]); never the phone. */
const randomDigits = (length: number) => [...crypto.getRandomValues(new Uint8Array(length))].map((byte, index) => (index === 0 ? 1 + (byte % 9) : byte % 10)).join("");

const hex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** «Laura Gil» → «Laura». */
const firstName = (name: string) => name.split(" ")[0];

// ─── Conversation specs ─────────────────────────────────────────────────────────────────────────────────

type ContactSpec = {
  key: string;
  name: string | null;
  channel: DemoChannelKey;
  /** WhatsApp: digits, the wa_id. */
  phone?: string;
  email?: string;
  /** Web chat visitor id. */
  visitorId?: string;
  labels?: string[];
  customFields?: Record<string, string>;
};

/** One message, `after` seconds after the previous one. */
type Step =
  | { by: "contact"; after: number; text: string | null; audio?: { transcript: string }; image?: { description: string } }
  | { by: "ai"; after: number; text: string; usage: ChatUsage; draft?: boolean }
  /** The AI hands the conversation over with transferir_a_humano; its message is the agent's hand-off text ([TRA-03]). */
  | { by: "handoff"; after: number; usage: ChatUsage }
  | { by: "human"; after: number; text: string; person: DemoPersonRef };

type HandoffSpec = { reason: string; summary: string; urgency: Urgency; assignee: DemoPersonRef; note?: string };

type ConversationSpec = {
  key: string;
  contact: string;
  channel: DemoChannelKey;
  /** When the first message arrived, counted back from now. */
  startsAgoMs: number;
  status: "open" | "pending_human" | "resolved";
  unread: number;
  labels: string[];
  subject?: string;
  handoff?: HandoffSpec;
  steps: Step[];
};

function contactSpecs(): ContactSpec[] {
  return [
    { key: "laura", name: "Laura Gil", channel: "whatsapp", phone: "34600000201", labels: ["cliente habitual"], customFields: { "Prefiere venir": "Por las mañanas" } },
    { key: "antonio", name: "Antonio Ramos", channel: "whatsapp", phone: "34600000202" },
    { key: "beatriz", name: "Beatriz Molina", channel: "whatsapp", phone: "34600000203", email: "beatriz.molina@correo.example" },
    { key: "cristina", name: "Cristina Herrero", channel: "whatsapp", phone: "34600000204", email: "cristina.herrero@correo.example", labels: ["empresa"] },
    { key: "sergio", name: "Sergio Vidal", channel: "webchat", visitorId: crypto.randomUUID() },
    // Web chat visitors are anonymous until they give their data ([WEB-04], [WEB-05]).
    { key: "visitante", name: null, channel: "webchat", visitorId: crypto.randomUUID() },
    { key: "isabel", name: "Isabel Prieto", channel: "email", email: "isabel.prieto@correo.example", labels: ["empresa"] },
  ];
}

function conversationSpecs(input: DemoConversationsInput, script: SectorScript, hours: string): ConversationSpec[] {
  const booking = input.preset.terminology.booking;
  const [c0, c1, c2, c3] = CHAT_USAGE;
  return [
    {
      key: "reserva",
      contact: "laura",
      channel: "whatsapp",
      startsAgoMs: 22 * HOUR_MS,
      status: "open",
      unread: 0,
      labels: [booking],
      steps: [
        { by: "contact", after: 0, text: script.booking.ask },
        { by: "ai", after: 9, text: script.booking.offer, usage: c0 },
        { by: "contact", after: 4 * 60, text: script.booking.choose },
        { by: "ai", after: 8, text: script.booking.confirm, usage: c2 },
      ],
    },
    {
      key: "nota-de-voz",
      contact: "antonio",
      channel: "whatsapp",
      startsAgoMs: 3 * HOUR_MS + 12 * MINUTE_MS,
      status: "open",
      unread: 1,
      labels: [],
      steps: [
        { by: "contact", after: 0, text: null, audio: { transcript: script.voice.transcript } },
        { by: "ai", after: 14, text: script.voice.reply, usage: c1 },
      ],
    },
    {
      key: "traspaso-pendiente",
      contact: "beatriz",
      channel: "whatsapp",
      startsAgoMs: 48 * MINUTE_MS,
      status: "pending_human",
      unread: 2,
      labels: ["incidencia"],
      handoff: { reason: script.urgent.reason, summary: script.urgent.summary, urgency: "high", assignee: input.people.agent },
      steps: [
        { by: "contact", after: 0, text: script.urgent.problem },
        { by: "handoff", after: 10, usage: c3 },
        { by: "contact", after: 3 * 60, text: script.urgent.after },
      ],
    },
    {
      key: "resuelta-persona",
      contact: "cristina",
      channel: "whatsapp",
      startsAgoMs: 2 * DAY_MS + 5 * HOUR_MS,
      status: "resolved",
      unread: 0,
      labels: ["factura"],
      handoff: {
        reason: `Pide la factura de su última ${booking}`,
        summary: `Cristina pide que le envíen por correo la factura de su última ${booking}, a nombre de su empresa.`,
        urgency: "normal",
        assignee: input.people.supervisor,
        note: "Factura enviada por correo desde el programa de facturación. Pide siempre la factura a nombre de su empresa.",
      },
      steps: [
        { by: "contact", after: 0, text: `Hola, ¿me podríais mandar la factura de mi última ${booking} a mi correo? La necesito para la empresa.` },
        { by: "handoff", after: 9, usage: c1 },
        {
          by: "human",
          after: 2 * 60,
          text: `Hola, Cristina. Soy ${firstName(input.people.supervisor.name)}, de ${input.business.name}. Te acabo de enviar la factura a tu correo. ¿Necesitas algo más?`,
          person: input.people.supervisor,
        },
        { by: "contact", after: 4 * 60, text: "Ya la tengo, ¡muchas gracias!" },
        { by: "human", after: 60, text: "¡A ti! Que tengas buen día.", person: input.people.supervisor },
      ],
    },
    {
      key: "imagen",
      contact: "sergio",
      channel: "webchat",
      startsAgoMs: 95 * MINUTE_MS,
      status: "open",
      unread: 1,
      labels: [],
      steps: [
        { by: "contact", after: 0, text: script.image.caption, image: { description: script.image.description } },
        { by: "ai", after: 12, text: script.image.reply, usage: c2 },
      ],
    },
    {
      key: "preguntas",
      contact: "visitante",
      channel: "webchat",
      startsAgoMs: 5 * DAY_MS + 2 * HOUR_MS,
      status: "resolved",
      unread: 0,
      labels: [],
      steps: [
        { by: "contact", after: 0, text: "Hola, ¿qué horario tenéis?" },
        { by: "ai", after: 7, text: `¡Hola! Abrimos ${hours}. ¿Te ayudo en algo más?`, usage: c1 },
        { by: "contact", after: 50, text: "¿Y dónde estáis?" },
        { by: "ai", after: 6, text: `Estamos en ${input.business.address}. ¡Te esperamos!`, usage: c0 },
      ],
    },
    {
      key: "correo",
      contact: "isabel",
      channel: "email",
      startsAgoMs: 26 * HOUR_MS,
      status: "open",
      unread: 1,
      labels: ["empresa"],
      subject: script.email.subject,
      steps: [
        { by: "contact", after: 0, text: script.email.first },
        // Drafted by the AI, approved by a person an hour later, then sent ([CAN-07], [MOT-14]).
        { by: "ai", after: 60 * 60, text: script.email.reply, usage: EMAIL_USAGE },
        { by: "contact", after: 21 * 60 * 60, text: script.email.followUp },
        { by: "ai", after: 20, text: script.email.draft, usage: EMAIL_USAGE, draft: true },
      ],
    },
  ];
}

// ─── Builder ────────────────────────────────────────────────────────────────────────────────────────────

/** Contacts, conversations, messages, hand-offs, notifications and AI runs of the demo. Pure except for new ids. */
export function buildDemoConversations(input: DemoConversationsInput): DemoConversationRows {
  const { business, now } = input;
  const slot = demoBookingSlot(input);
  const hours = describeOpeningHours(input.preset.businessHours);
  const script = sectorScript(input.sector, {
    business,
    day: slot.day,
    time: slot.time,
    resource: slot.resource,
    price: (key) => priceText(business, key),
    person: (key) => resourceName(input.preset, business, key),
    hours,
  });

  const rows: DemoConversationRows = {
    contacts: [],
    identities: [],
    consents: [],
    conversations: [],
    messages: [],
    aiRuns: [],
    handoffEvents: [],
    notes: [],
    notifications: [],
    roundRobin: [],
    lastInbound: [],
    contactIds: new Map(),
    conversationIds: new Map(),
  };
  const contactsByKey = new Map(contactSpecs().map((spec) => [spec.key, spec]));
  const specs = conversationSpecs(input, script, hours).sort((a, b) => b.startsAgoMs - a.startsAgoMs);
  let lastRoundRobin: { channelId: string; userId: string } | null = null;

  for (const spec of specs) {
    const contactSpec = contactsByKey.get(spec.contact);
    if (!contactSpec) throw new Error(`Contacto de demo desconocido: ${spec.contact}`);
    const channelId = input.channelIds[spec.channel];
    const agent = spec.channel === "email" ? input.agents.email : input.agents.reception;
    const startedAt = new Date(now.getTime() - spec.startsAgoMs);
    const contactId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    rows.contactIds.set(contactSpec.key, contactId);
    rows.conversationIds.set(spec.key, conversationId);

    // ── Contact and its identities ([CAN-13], [CTO-02], [CTO-03]); the phone is data, never the key.
    rows.contacts.push({
      id: contactId,
      name: contactSpec.name,
      phone: contactSpec.phone ?? null,
      email: contactSpec.email ?? null,
      labels: contactSpec.labels ?? [],
      customFields: contactSpec.customFields ?? {},
      createdAt: startedAt,
      updatedAt: startedAt,
    });
    const identity = (channelType: (typeof contactIdentities.$inferInsert)["channelType"], externalId: string, offsetMs = 0) =>
      rows.identities.push({
        contactId,
        channelType,
        externalId,
        phone: contactSpec.phone ?? null,
        displayName: contactSpec.name ? firstName(contactSpec.name) : null,
        createdAt: new Date(startedAt.getTime() + offsetMs),
        updatedAt: new Date(startedAt.getTime() + offsetMs),
      });
    if (spec.channel === "whatsapp" && contactSpec.phone) {
      // BSUID first (the stable id, [WA-39]), then the wa_id, as the ingest stores them ([WA-40]).
      identity("whatsapp", `ES.${randomDigits(20)}`);
      identity("whatsapp", contactSpec.phone, 1);
    } else if (spec.channel === "webchat" && contactSpec.visitorId) {
      identity("webchat", contactSpec.visitorId);
      // Acceptance of the chat's legal notice ([CUM-13]).
      rows.consents.push({
        contactId,
        channelId,
        channelType: "webchat",
        type: "legal_acceptance",
        source: "widget",
        createdAt: new Date(startedAt.getTime() - 5 * SECOND_MS),
        updatedAt: new Date(startedAt.getTime() - 5 * SECOND_MS),
      });
    } else if (spec.channel === "email" && contactSpec.email) {
      identity("email_gmail", contactSpec.email);
    }

    // ── Messages.
    let at = startedAt.getTime();
    let aiMessages = 0;
    let handoffAt = startedAt;
    let firstHuman: { id: string; at: Date } | null = null;
    const conversationMessages: (typeof messages.$inferInsert)[] = [];
    for (const [index, step] of spec.steps.entries()) {
      at += step.after * SECOND_MS;
      const createdAt = new Date(at);
      const id = crypto.randomUUID();
      // The customer has seen it if they wrote again afterwards, or once some time has passed.
      const seen = spec.steps.slice(index + 1).some((next) => next.by === "contact") || now.getTime() - at > HOUR_MS;

      if (step.by === "contact") {
        const media = step.audio ? input.media.voiceNote : step.image ? input.media.image : null;
        const contentType: MessageContentType = step.audio ? "audio" : step.image ? "image" : "text";
        conversationMessages.push({
          id,
          conversationId,
          channelId,
          direction: "inbound",
          senderType: "contact",
          externalId: inboundExternalId(spec.channel),
          contentType,
          text: step.text,
          media: media ? mediaOf(media) : null,
          transcript: step.audio?.transcript ?? null,
          status: "received",
          metadata: {
            ...(spec.subject ? { subject: spec.subject } : {}),
            // The description the vision model made of the image ([MED-05]).
            ...(step.image ? { imageDescription: step.image.description } : {}),
          },
          sentAt: new Date(at - SECOND_MS),
          createdAt,
          updatedAt: createdAt,
        });
        if (step.audio) {
          rows.aiRuns.push({
            kind: "transcription",
            conversationId,
            messageId: id,
            modelRequested: input.models.transcription,
            modelUsed: input.models.transcription,
            costUsd: TRANSCRIPTION_USAGE.costUsd,
            latencyMs: TRANSCRIPTION_USAGE.latencyMs,
            createdAt: new Date(at + 2 * SECOND_MS),
            updatedAt: new Date(at + 2 * SECOND_MS),
          });
        }
        if (step.image) {
          rows.aiRuns.push({
            kind: "image_description",
            conversationId,
            messageId: id,
            modelRequested: input.models.imageDescription,
            modelUsed: input.models.imageDescription,
            promptTokens: IMAGE_DESCRIPTION_USAGE.promptTokens,
            completionTokens: IMAGE_DESCRIPTION_USAGE.completionTokens,
            totalTokens: IMAGE_DESCRIPTION_USAGE.promptTokens + IMAGE_DESCRIPTION_USAGE.completionTokens,
            costUsd: IMAGE_DESCRIPTION_USAGE.costUsd,
            latencyMs: IMAGE_DESCRIPTION_USAGE.latencyMs,
            createdAt: new Date(at + 3 * SECOND_MS),
            updatedAt: new Date(at + 3 * SECOND_MS),
          });
        }
        continue;
      }

      if (step.by === "ai" || step.by === "handoff") {
        const handoff = step.by === "handoff";
        const draft = step.by === "ai" && step.draft === true;
        const runId = crypto.randomUUID();
        let text = handoff ? handoffMessage(agent, input, createdAt) : step.text;
        if (spec.channel === "email") text = `${text}\n\n${emailSignature(business)}`;
        // The AI notice goes in front of the first AI message of the conversation ([CUM-01]).
        if (aiMessages === 0) text = `${input.aiDisclosureText}\n\n${text}`;
        aiMessages += 1;
        conversationMessages.push({
          id,
          conversationId,
          channelId,
          direction: "outbound",
          senderType: "ai",
          agentId: agent.id,
          agentName: agent.name,
          ...outboundDelivery(spec.channel, id, createdAt, { draft, seen }),
          contentType: "text",
          text,
          metadata: { aiRunId: runId, ...(handoff ? { handoff: true } : {}), ...(spec.subject ? { subject: `Re: ${spec.subject}` } : {}) },
          createdAt,
          updatedAt: createdAt,
        });
        rows.aiRuns.push({
          id: runId,
          kind: "chat",
          conversationId,
          messageId: id,
          agentId: agent.id,
          modelRequested: agent.model,
          modelUsed: agent.model,
          promptTokens: step.usage.promptTokens,
          completionTokens: step.usage.completionTokens,
          cachedTokens: step.usage.cachedTokens,
          totalTokens: step.usage.promptTokens + step.usage.completionTokens,
          costUsd: step.usage.costUsd,
          latencyMs: step.usage.latencyMs,
          toolsUsed: handoff ? [{ name: "transferir_a_humano", ok: true }] : [],
          steps: handoff ? 2 : 1,
          ok: true,
          createdAt: new Date(at - 200),
          updatedAt: new Date(at - 200),
        });
        if (handoff) handoffAt = new Date(at - SECOND_MS);
        continue;
      }

      if (!firstHuman) firstHuman = { id, at: createdAt };
      conversationMessages.push({
        id,
        conversationId,
        channelId,
        direction: "outbound",
        senderType: "human",
        senderUserId: step.person.id,
        senderName: step.person.name,
        ...outboundDelivery(spec.channel, id, createdAt, { draft: false, seen }),
        contentType: "text",
        text: step.text,
        createdAt,
        updatedAt: createdAt,
      });
    }
    rows.messages.push(...conversationMessages);

    // ── Conversation.
    const inbound = conversationMessages.filter((message) => message.direction === "inbound");
    const sent = conversationMessages.filter((message) => message.direction === "outbound" && message.status !== "draft");
    const last = conversationMessages[conversationMessages.length - 1];
    const handoff = spec.handoff;
    rows.conversations.push({
      id: conversationId,
      channelId,
      contactId,
      externalThreadId: spec.channel === "email" ? `demo-thread-${hex(8)}` : null,
      status: spec.status,
      // Waiting for a person after a hand-off; back with the AI once resolved ([TRA-02], [TRA-08]).
      aiMode: spec.status === "pending_human" ? "human" : "ai",
      pauseReason: spec.status === "pending_human" && handoff ? `Traspaso a una persona: ${handoff.reason}`.slice(0, MAX_PAUSE_REASON) : null,
      assignedUserId: handoff?.assignee.id ?? null,
      lastInboundAt: inbound[inbound.length - 1]?.sentAt ?? null,
      lastOutboundAt: sent[sent.length - 1]?.createdAt ?? null,
      lastMessageAt: last.createdAt,
      unreadCount: spec.unread,
      labels: spec.labels,
      metadata: spec.subject ? { subject: spec.subject } : {},
      createdAt: startedAt,
      updatedAt: last.createdAt,
    });
    const lastInbound = inbound[inbound.length - 1]?.createdAt;
    if (lastInbound) {
      const current = rows.lastInbound.find((entry) => entry.channelId === channelId);
      if (!current) rows.lastInbound.push({ channelId, at: lastInbound });
      else if (lastInbound > current.at) current.at = lastInbound;
    }

    // ── Hand-off: event, assignment, notifications and note ([TRA-02]–[TRA-07]).
    if (handoff) {
      const human = firstHuman;
      rows.handoffEvents.push({
        conversationId,
        trigger: "ai_tool",
        reason: handoff.reason,
        summary: handoff.summary,
        urgency: handoff.urgency,
        assignedUserId: handoff.assignee.id,
        requestedAt: handoffAt,
        firstHumanResponseAt: human?.at ?? null,
        firstHumanMessageId: human?.id ?? null,
        // Resolved without a person's reply: the hand-off ended there ([TRA-06]).
        closedAt: !human && spec.status !== "pending_human" ? last.createdAt : null,
        createdAt: handoffAt,
        updatedAt: human?.at ?? handoffAt,
      });
      const who = contactSpec.name ?? "Cliente sin nombre";
      const link = `/bandeja/${conversationId}`;
      const readAt = human ? new Date(human.at.getTime() - 30 * SECOND_MS) : null;
      const recipients = agent.handoff.notifyUserIds?.length ? agent.handoff.notifyUserIds : [input.people.supervisor.id];
      for (const userId of recipients) {
        rows.notifications.push({
          userId,
          event: "handoff",
          title: `${handoff.urgency === "high" ? "Traspaso urgente" : "Traspaso"}: ${who}`,
          body: handoff.reason,
          link,
          channelId,
          readAt,
          createdAt: handoffAt,
          updatedAt: readAt ?? handoffAt,
        });
      }
      rows.notifications.push({
        userId: handoff.assignee.id,
        event: "conversation_assigned",
        title: `Conversación asignada: ${who}`,
        link,
        channelId,
        readAt,
        createdAt: handoffAt,
        updatedAt: readAt ?? handoffAt,
      });
      if (handoff.note && human) {
        const noteAt = new Date(human.at.getTime() + 30 * SECOND_MS);
        rows.notes.push({
          conversationId,
          authorUserId: handoff.assignee.id,
          authorName: handoff.assignee.name,
          text: handoff.note,
          createdAt: noteAt,
          updatedAt: noteAt,
        });
      }
      lastRoundRobin = { channelId, userId: handoff.assignee.id };
    }
  }
  if (lastRoundRobin) rows.roundRobin.push(lastRoundRobin);
  return rows;
}

function mediaOf(media: DemoMediaRef): MessageMedia {
  return { ...media, downloadStatus: "done" };
}

/** The reference of a demo file as the media store would record it. */
export function demoMediaRef(file: DemoFile, durationSec?: number): DemoMediaRef {
  return {
    fileKey: file.fileKey,
    mimeType: file.mimeType,
    size: file.bytes.byteLength,
    fileName: file.fileName,
    sha256: createHash("sha256").update(file.bytes).digest("hex"),
    ...(durationSec === undefined ? {} : { durationSec }),
  };
}

/** Message ids as each channel gives them: WhatsApp wamid, the widget's random id, an email Message-ID. */
function inboundExternalId(channel: DemoChannelKey): string {
  if (channel === "whatsapp") return `wamid.DEMO${hex(12).toUpperCase()}`;
  if (channel === "email") return `<${hex(12)}@correo.example>`;
  return crypto.randomUUID();
}

/** How an outbound message ends up: WhatsApp reports delivery and reading (free, inside the service window, [WA-47]). */
function outboundDelivery(channel: DemoChannelKey, id: string, at: Date, options: { draft: boolean; seen: boolean }) {
  if (options.draft) return { status: "draft" as MessageStatus, externalId: null, sentAt: null, statusUpdatedAt: at };
  const sentAt = new Date(at.getTime() + SECOND_MS);
  if (channel === "whatsapp") {
    return {
      status: (options.seen ? "read" : "delivered") as MessageStatus,
      externalId: `demo-${id}`,
      sentAt,
      statusUpdatedAt: new Date(at.getTime() + (options.seen ? 6 : 2) * SECOND_MS),
      pricingType: "free_customer_service",
      pricingCategory: "service",
      costEstimate: 0,
    };
  }
  // The web chat keeps what it sends for the widget to read; email is sent through the (demo) mailbox.
  return { status: "sent" as MessageStatus, externalId: channel === "email" ? `demo-${id}` : null, sentAt, statusUpdatedAt: sentAt };
}

/** The agent's hand-off message, inside or outside opening hours ([TRA-03]). */
function handoffMessage(agent: DemoAgentRef, input: DemoConversationsInput, at: Date): string {
  const open = isWithinOpeningHours(at, input.timeZone, input.preset.businessHours);
  const message = open ? agent.handoff.messageInHours : agent.handoff.messageOffHours;
  if (!message) throw new Error(`El agente «${agent.name}» no tiene mensaje de traspaso.`);
  return message;
}

/** Greeting and signature with the AI notice of the AI's emails ([COR-21], [CUM-01]). */
function emailSignature(business: DemoBusiness): string {
  return `Un saludo,\nEquipo de ${business.name}\n${business.address} · ${business.contactPhone}\n\nRespuesta preparada por el asistente de inteligencia artificial de ${business.name}.`;
}

// ─── Step ───────────────────────────────────────────────────────────────────────────────────────────────

function demoPerson(ctx: { refs: { userIds: Map<string, string> } }, role: Role): DemoPersonRef {
  const demoUser = DEMO_USERS.find((candidate) => candidate.role === role);
  const id = demoUser ? ctx.refs.userIds.get(demoUser.email) : undefined;
  if (!demoUser || !id) throw new Error(`Falta el usuario de demo con el rol ${role}: el paso de usuarios va antes.`);
  return { id, name: demoUser.name };
}

async function loadAgentRefs(tx: Transaction, agentIds: Map<string, string>): Promise<{ reception: DemoAgentRef; email: DemoAgentRef }> {
  const receptionId = agentIds.get("recepcion");
  const emailId = agentIds.get("correo");
  if (!receptionId || !emailId) throw new Error("Las conversaciones de la demo necesitan los agentes: el paso de agentes va antes.");
  const rows = await tx
    .select({ id: agents.id, name: agents.name, model: agents.model, handoff: agents.handoff })
    .from(agents)
    .where(inArray(agents.id, [receptionId, emailId]));
  const byId = (id: string) => {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) throw new Error("No se encuentra un agente de la demo.");
    return row;
  };
  return { reception: byId(receptionId), email: byId(emailId) };
}

export const conversationsStep: SeedStep = {
  name: "conversaciones",
  prepare: async (ctx) => {
    // Files first, outside the transaction: fixed keys, so loading the demo again just overwrites them.
    const files = demoMediaFiles(ctx.sector);
    await writeDemoMedia([files.voiceNote, files.image]);
    const media = { voiceNote: demoMediaRef(files.voiceNote, DEMO_VOICE_NOTE_SECONDS), image: demoMediaRef(files.image) };

    return async (tx) => {
      const channelIds = ctx.refs.channelIds;
      const agentIds = ctx.refs.agentIds;
      if (!channelIds || !agentIds) throw new Error("Las conversaciones de la demo necesitan los canales y los agentes: esos pasos van antes.");
      const channelId = (key: DemoChannelKey) => {
        const id = channelIds.get(key);
        if (!id) throw new Error(`Falta el canal de demo «${key}».`);
        return id;
      };
      // Read inside the transaction: earlier steps of this same load wrote them.
      const [settings, integration] = await Promise.all([loadBusinessSettings(tx), loadIntegrationSettings(tx)]);
      const rows = buildDemoConversations({
        sector: ctx.sector,
        preset: ctx.preset,
        business: ctx.business,
        now: ctx.now,
        timeZone: ctx.timeZone,
        aiDisclosureText: settings.aiDisclosureText?.trim() || DEFAULT_AI_DISCLOSURE_TEXT,
        channelIds: { webchat: channelId("webchat"), whatsapp: channelId("whatsapp"), email: channelId("email") },
        agents: await loadAgentRefs(tx, agentIds),
        people: { supervisor: demoPerson(ctx, "supervisor"), agent: demoPerson(ctx, "agent") },
        models: {
          transcription: integration.defaultModels.transcription || DEFAULT_MODELS.transcription,
          imageDescription: integration.defaultModels.imageDescription || DEFAULT_MODELS.imageDescription,
        },
        media,
      });
      await insertDemoConversations(tx, rows);
      ctx.refs.contactIds = rows.contactIds;
      ctx.refs.conversationIds = rows.conversationIds;
    };
  },
};

/** Parents before children: foreign keys are enforced and nothing relies on cascades. */
export async function insertDemoConversations(tx: Transaction, rows: DemoConversationRows): Promise<void> {
  await tx.insert(contacts).values(rows.contacts.map((row) => ({ ...row, searchText: contactSearchText(row) })));
  await tx.insert(contactIdentities).values(rows.identities);
  if (rows.consents.length > 0) await tx.insert(consents).values(rows.consents);
  await tx.insert(conversations).values(rows.conversations);
  await tx.insert(messages).values(rows.messages.map((row) => ({ ...row, searchText: messageSearchText(row.text) })));
  await tx.insert(aiRuns).values(rows.aiRuns);
  if (rows.handoffEvents.length > 0) await tx.insert(handoffEvents).values(rows.handoffEvents);
  if (rows.notes.length > 0) await tx.insert(internalNotes).values(rows.notes);
  if (rows.notifications.length > 0) await tx.insert(notifications).values(rows.notifications);
  for (const { channelId, userId } of rows.roundRobin) await setKv(`${ROUND_ROBIN_KEY_PREFIX}${channelId}`, userId, { executor: tx });
  for (const { channelId, at } of rows.lastInbound) {
    await tx.update(channels).set({ lastInboundAt: at }).where(inArray(channels.id, [channelId]));
  }
}
