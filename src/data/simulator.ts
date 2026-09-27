// Simulador de canales (Ajustes › Diagnóstico, [AJU-11]–[AJU-13]): owner and admin write as a customer in any channel
// (the demo's WhatsApp and email, a web chat, or a real channel). The message goes through the SAME ingest pipeline as
// a real one (contact and identity, message stored once, conversation, screens, grouped reply job), marked as
// simulated, so the AI answers as it would, and its replies never leave the app ([AJU-13]: they go through the
// DemoAdapter). Files are the ready-made samples (seed/media) or one of the person's, checked by content and size.
import "server-only";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agents, channels, consents, contactIdentities, contacts, conversations } from "@/db/schema";
import type { ChannelStatus, ChannelType } from "@/lib/enums";
import { isWithinOpeningHours } from "@/lib/opening-hours";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { DEFAULT_SECTOR, isSector } from "@/lib/sectors";
import { emailSchema, idSchema } from "@/lib/validation";
import type { JobQueue } from "@/server/adapters/job-queue";
import { getFileStorage, type FileStorage } from "@/server/adapters/file-storage";
import type { RateLimiter } from "@/server/adapters/rate-limiter";
import { loadPromptBusinessData } from "@/server/ai/context";
import { enforceAiRateLimit } from "@/server/ai/limits";
import { buildSimulatedEvent } from "@/server/channels/demo-adapter";
import { capabilitiesOf } from "@/server/channels/registry";
import type { ChannelCapabilities, ChannelRecord } from "@/server/channels/types";
import { detectWidgetMedia } from "@/server/channels/webchat/upload";
import { evaluateReplyChecks, testModeIdentifiers, type ReplySkipReason } from "@/server/engine/checks";
import { NotFoundError, parseInput, ValidationError } from "@/server/errors";
import { ingestEvents, type IngestResult } from "@/server/inbound/ingest";
import { storeInboundMedia, type StoredMedia } from "@/server/media/store";
import { safeErrorMessage } from "@/server/redact";
import { simulatorSample, type SampleKind } from "../../seed/media";
import { writeAudit } from "./audit";
import { assertCan } from "./guard";
import { isAiConfigured } from "./settings";

/** Largest file of one's own: Server Actions accept 1 MB bodies by default (next.config.ts). */
export const MAX_SIMULATOR_UPLOAD_BYTES = 1_000_000;
const MAX_TEXT = 4_096;
const CONTACTS_PER_TYPE = 50;

export const SIMULATOR_CONTENT_TYPES = ["text", "audio", "image", "document"] as const;
export type SimulatorContentType = (typeof SIMULATOR_CONTENT_TYPES)[number];

// ─── What the screen offers ─────────────────────────────────────────────────────────────────────────────

export type SimulatorChannel = {
  id: string;
  name: string;
  type: ChannelType;
  status: ChannelStatus;
  isDemo: boolean;
  activeAgentName: string | null;
  aiEnabled: boolean;
  capabilities: Pick<ChannelCapabilities, "audio" | "images" | "documents">;
};

export type SimulatorContact = { id: string; name: string | null; externalId: string; phone: string | null; email: string | null };

export type SimulatorOptions = {
  channels: SimulatorChannel[];
  /** Contacts with an identity in each channel type, most recent first. */
  contactsByType: Partial<Record<ChannelType, SimulatorContact[]>>;
};

/** Channels and contacts to choose from. Owner and admin only ([AJU-11], «Diagnóstico y simulador»). */
export async function loadSimulatorOptions(actor: Actor): Promise<SimulatorOptions> {
  assertCan(actor, PERMISSIONS.settings.diagnostics);
  const rows = await db
    .select({ channel: channels, agentName: agents.name })
    .from(channels)
    .leftJoin(agents, eq(agents.id, channels.activeAgentId))
    .orderBy(asc(channels.name));
  const types = [...new Set(rows.map(({ channel }) => channel.type))];
  const identities = types.length
    ? await db
        .select({
          channelType: contactIdentities.channelType,
          externalId: contactIdentities.externalId,
          id: contacts.id,
          name: contacts.name,
          phone: contacts.phone,
          email: contacts.email,
        })
        .from(contactIdentities)
        .innerJoin(contacts, eq(contacts.id, contactIdentities.contactId))
        .where(inArray(contactIdentities.channelType, types))
        .orderBy(desc(contacts.updatedAt), asc(contactIdentities.createdAt))
    : [];
  const contactsByType: SimulatorOptions["contactsByType"] = {};
  for (const identity of identities) {
    const list = (contactsByType[identity.channelType] ??= []);
    // One entry per contact (its first identity in the type), and a short list.
    if (list.length >= CONTACTS_PER_TYPE || list.some((contact) => contact.id === identity.id)) continue;
    list.push({ id: identity.id, name: identity.name, externalId: identity.externalId, phone: identity.phone, email: identity.email });
  }
  return {
    channels: rows.map(({ channel, agentName }) => {
      const capabilities = capabilitiesOf(channel);
      return {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        status: channel.status,
        isDemo: channel.isDemo,
        activeAgentName: channel.activeAgentId ? (agentName ?? null) : null,
        aiEnabled: channel.aiEnabled,
        capabilities: { audio: capabilities.audio, images: capabilities.images, documents: capabilities.documents },
      };
    }),
    contactsByType,
  };
}

// ─── Sending a simulated message ────────────────────────────────────────────────────────────────────────

const newContactSchema = z
  .object({
    mode: z.literal("new"),
    name: z.string().trim().max(100, "Como mucho 100 caracteres.").optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[\d\s().-]{6,24}$/, "Escribe un teléfono válido, con su prefijo.")
      .optional(),
    email: emailSchema.optional(),
  })
  .strict();

export const simulatorMessageSchema = z
  .object({
    channelId: idSchema,
    contact: z.discriminatedUnion("mode", [z.object({ mode: z.literal("existing"), contactId: idSchema }).strict(), newContactSchema]),
    contentType: z.enum(SIMULATOR_CONTENT_TYPES, { error: "Elige el tipo de mensaje." }),
    /** The message, or the caption of a file. */
    text: z.string().trim().max(MAX_TEXT, "El mensaje es demasiado largo.").optional(),
    /** Email only. */
    subject: z.string().trim().max(200, "Como mucho 200 caracteres.").optional(),
    /** A ready-made sample, or a file of one's own. */
    file: z
      .discriminatedUnion("source", [
        z.object({ source: z.literal("sample") }).strict(),
        z.object({ source: z.literal("upload"), bytes: z.instanceof(Uint8Array), fileName: z.string().trim().max(255).optional() }).strict(),
      ])
      .default({ source: "sample" }),
  })
  .strict()
  .refine((value) => value.contentType !== "text" || Boolean(value.text), { message: "Escribe el mensaje.", path: ["text"] });

export type SimulatorMessageInput = z.input<typeof simulatorMessageSchema>;

const PDF_SIGNATURE = "%PDF-";

/**
 * The real type of an uploaded file of the chosen kind, or null if it is not one ([SEG-13]): voice notes and images
 * are recognised as the web chat recognises them; documents must be PDF.
 */
export function detectSimulatorFile(kind: SampleKind, bytes: Uint8Array): { mimeType: string } | null {
  if (kind === "document") return String.fromCharCode(...bytes.subarray(0, PDF_SIGNATURE.length)) === PDF_SIGNATURE ? { mimeType: "application/pdf" } : null;
  const media = detectWidgetMedia(bytes);
  return media?.kind === kind ? { mimeType: media.mimeType } : null;
}

const WRONG_FILE: Record<SampleKind, string> = {
  audio: "El archivo no es una nota de voz (OGG, MP3, M4A, WAV o WebM).",
  image: "La imagen tiene que ser PNG, JPG o WebP.",
  document: "El documento tiene que ser un PDF.",
};

const NOT_SUPPORTED: Record<SampleKind, { capability: keyof SimulatorChannel["capabilities"]; message: string }> = {
  audio: { capability: "audio", message: "Este canal no admite notas de voz." },
  image: { capability: "images", message: "Este canal no admite imágenes." },
  document: { capability: "documents", message: "Este canal no admite documentos." },
};

/** Why the AI will not answer, as the reply engine decides it ([MOT-03]). */
const REPLY_SKIP_TEXT: Record<ReplySkipReason, string> = {
  channel_disabled: "el canal está desactivado",
  no_agent: "el canal no tiene agente activo",
  ai_disabled: "la IA de este canal está apagada",
  human_mode: "la conversación está en manos de una persona",
  paused: "la IA está en pausa en esta conversación",
  test_mode: "el canal está en modo pruebas y este contacto no está en su lista",
  window_closed: "la ventana de 24 horas de WhatsApp está cerrada",
  opted_out: "el contacto se ha dado de baja en este canal",
  off_hours: "el canal no responde fuera de horario",
  ai_not_configured: "falta la clave de OpenRouter (Ajustes › IA)",
  nothing_pending: "no hay nada que responder",
};

export type SimulationResult = {
  conversationId: string;
  messageId: string;
  contactId: string;
  channelName: string;
  contactName: string | null;
  /** The same message id was already stored: nothing changed ([CAN-11]). */
  duplicate: boolean;
  /** When the grouped reply job runs ([MOT-01]); null when nothing was scheduled. */
  replyRunAt: Date | null;
  /** Whether the AI will answer and, if not, why (the message then waits for a person). */
  aiReply: { expected: boolean; reason: string | null };
};

export type SimulateOptions = { storage?: FileStorage; now?: Date; queue?: JobQueue; limiter?: RateLimiter };

type Sender = { id: string; name: string | null; phone: string | null; email: string | null; contactId: string | null };

const digitsOf = (phone: string | undefined) => (phone ? phone.replace(/\D/g, "") : null);
const randomDigits = (length: number) => [...crypto.getRandomValues(new Uint8Array(length))].map((byte, index) => (index === 0 ? 1 + (byte % 9) : byte % 10)).join("");

/** The customer's identity in the channel: an existing contact's, or a new one as the channel would give it. */
async function resolveSender(channel: ChannelRecord, contact: z.output<typeof simulatorMessageSchema>["contact"]): Promise<Sender> {
  if (contact.mode === "existing") {
    const [row] = await db
      .select({
        id: contacts.id,
        name: contacts.name,
        phone: contacts.phone,
        email: contacts.email,
        externalId: contactIdentities.externalId,
        displayName: contactIdentities.displayName,
      })
      .from(contacts)
      .innerJoin(contactIdentities, and(eq(contactIdentities.contactId, contacts.id), eq(contactIdentities.channelType, channel.type)))
      .where(eq(contacts.id, contact.contactId))
      .orderBy(asc(contactIdentities.createdAt))
      .limit(1);
    if (!row) throw new ValidationError(undefined, { contact: ["Ese contacto no tiene identidad en este canal: elige otro o crea uno nuevo."] });
    // As the channel would send it: the name the channel shows, not the one the team may have written.
    return { id: row.externalId, name: row.displayName ?? row.name, phone: row.phone, email: row.email, contactId: row.id };
  }
  const phone = digitsOf(contact.phone);
  const email = contact.email ?? null;
  const name = contact.name || null;
  if (channel.type.startsWith("email_")) {
    if (!email) throw new ValidationError(undefined, { contact: ["Escribe el email del contacto: en el correo es su identidad."] });
    return { id: email, name, phone, email, contactId: null };
  }
  // WhatsApp gives a BSUID (country, dot, digits) that is not the phone ([WA-39]); the web chat, a visitor id.
  if (channel.type === "whatsapp") return { id: `ES.${randomDigits(20)}`, name, phone, email, contactId: null };
  if (channel.type === "telegram") return { id: randomDigits(10), name, phone, email, contactId: null };
  return { id: crypto.randomUUID(), name, phone, email, contactId: null };
}

/** An email continues the contact's latest thread in the channel; the first one opens a new thread ([CAN-12]). */
async function emailThread(channel: ChannelRecord, contactId: string | null): Promise<string> {
  if (contactId) {
    const [latest] = await db
      .select({ threadId: conversations.externalThreadId })
      .from(conversations)
      .where(and(eq(conversations.channelId, channel.id), eq(conversations.contactId, contactId), eq(conversations.isTest, false)))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);
    if (latest?.threadId) return latest.threadId;
  }
  return `sim-thread-${crypto.randomUUID()}`;
}

/** The file of the message, stored as every inbound file is (generated key, checked type and size). */
async function storeFile(data: z.output<typeof simulatorMessageSchema>, storage: FileStorage, now: Date): Promise<StoredMedia | null> {
  if (data.contentType === "text") return null;
  const kind: SampleKind = data.contentType;
  if (data.file.source === "upload") {
    const { bytes } = data.file;
    if (bytes.byteLength === 0) throw new ValidationError(undefined, { file: ["Elige un archivo."] });
    if (bytes.byteLength > MAX_SIMULATOR_UPLOAD_BYTES) throw new ValidationError(undefined, { file: ["El archivo puede ocupar como mucho 1 MB."] });
    const format = detectSimulatorFile(kind, bytes);
    if (!format) throw new ValidationError(undefined, { file: [WRONG_FILE[kind]] });
    return storeInboundMedia({ bytes, mimeType: format.mimeType, fileName: data.file.fileName }, { storage, now });
  }
  const business = await loadPromptBusinessData();
  const sector = business.business.sector && isSector(business.business.sector) ? business.business.sector : DEFAULT_SECTOR;
  const sample = simulatorSample(kind, { sector, businessName: business.business.name || "tu negocio" });
  return storeInboundMedia(sample, { storage, now });
}

/** Whether the reply engine would answer now, with the same checks it runs ([MOT-03]). */
async function forecastReply(channel: ChannelRecord, conversationId: string, now: Date): Promise<SimulationResult["aiReply"]> {
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conversation) return { expected: false, reason: REPLY_SKIP_TEXT.nothing_pending };
  const identities = conversation.contactId
    ? await db
        .select({ externalId: contactIdentities.externalId, phone: contactIdentities.phone })
        .from(contactIdentities)
        .where(and(eq(contactIdentities.contactId, conversation.contactId), eq(contactIdentities.channelType, channel.type)))
    : [];
  const [optOut] = conversation.contactId
    ? await db
        .select({ type: consents.type })
        .from(consents)
        .where(and(eq(consents.contactId, conversation.contactId), eq(consents.channelId, channel.id), or(eq(consents.type, "opt_out"), eq(consents.type, "opt_in"))))
        .orderBy(desc(consents.createdAt))
        .limit(1)
    : [];
  const business = await loadPromptBusinessData();
  const check = evaluateReplyChecks({
    channel,
    conversation,
    window24h: capabilitiesOf(channel).window24h,
    identifiers: testModeIdentifiers(channel.type, identities),
    optedOut: optOut?.type === "opt_out",
    withinBusinessHours: isWithinOpeningHours(now, business.timezone, business.hours, business.closures),
    now,
  });
  const reason = !check.ok ? check.reason : (await isAiConfigured()) ? null : "ai_not_configured";
  return reason ? { expected: false, reason: REPLY_SKIP_TEXT[reason] } : { expected: true, reason: null };
}

/**
 * Writes as a customer in a channel through the real ingest pipeline ([AJU-12]); the message is marked as simulated
 * and its replies never leave the app ([AJU-13]). The caller runs the work afterwards (kickTick).
 */
export async function simulateInboundMessage(actor: Actor, input: unknown, options: SimulateOptions = {}): Promise<SimulationResult> {
  assertCan(actor, PERMISSIONS.settings.diagnostics);
  const data = parseInput(simulatorMessageSchema, input);
  // Each simulated message may make the AI answer: same kind of limit as «Probar agente» ([SEG-07]).
  await enforceAiRateLimit("simulator", actor.userId, options.limiter);
  const now = options.now ?? new Date();
  const [channel] = await db.select().from(channels).where(eq(channels.id, data.channelId));
  if (!channel) throw new NotFoundError("No se ha encontrado el canal.");
  if (data.contentType !== "text") {
    const needed = NOT_SUPPORTED[data.contentType];
    if (!capabilitiesOf(channel)[needed.capability]) throw new ValidationError(undefined, { contentType: [needed.message] });
  }
  const sender = await resolveSender(channel, data.contact);
  const email = channel.type.startsWith("email_");
  const threadId = email ? await emailThread(channel, sender.contactId) : null;

  const storage = options.storage ?? getFileStorage();
  const media = await storeFile(data, storage, now);
  let result: IngestResult;
  try {
    const event = buildSimulatedEvent(
      { from: { id: sender.id, name: sender.name, phone: sender.phone, email: sender.email }, threadId, contentType: data.contentType, text: data.text ?? null, media },
      now,
    );
    // Everything the media store recorded (its hash too), as with any other inbound file.
    if (media) event.media = media;
    if (email && data.subject) event.metadata = { subject: data.subject };
    result = await ingestEvents(channel, [event], { now, queue: options.queue });
  } catch (error) {
    if (media) {
      await storage.delete(media.fileKey).catch((cleanup: unknown) => console.error(`[simulator] No se pudo borrar el archivo: ${safeErrorMessage(cleanup)}`));
    }
    throw error;
  }

  const [message] = result.messages;
  if (!message?.messageId || !message.conversationId) throw new Error("El simulador no ha podido guardar el mensaje.");
  const [conversation] = await db.select({ contactId: conversations.contactId }).from(conversations).where(eq(conversations.id, message.conversationId));
  const contactId = message.contactId ?? conversation?.contactId ?? "";
  const [contact] = await db.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, contactId));
  await writeAudit({
    actor,
    action: "simulator.message_sent",
    targetType: "conversation",
    targetId: message.conversationId,
    metadata: { channelId: channel.id, contentType: data.contentType, file: data.contentType === "text" ? null : data.file.source },
  });
  return {
    conversationId: message.conversationId,
    messageId: message.messageId,
    contactId,
    channelName: channel.name,
    contactName: contact?.name ?? null,
    duplicate: message.duplicate,
    replyRunAt: result.replyRunAt,
    aiReply: await forecastReply(channel, message.conversationId, now),
  };
}
