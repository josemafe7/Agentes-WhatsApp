// A visitor writes in the web chat ([WEB-05]–[WEB-09]): text, an uploaded image or voice note, or the optional
// contact form. It goes through the common inbound pipeline (contact by visitor id, message stored once, reply
// scheduled for later) and never calls the AI here ([CAN-10]). The route kicks the job queue afterwards.
import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { consents } from "@/db/schema";
import { toSingleLine } from "@/lib/format";
import { emailSchema } from "@/lib/validation";
import { ValidationError } from "@/server/errors";
import { ingestEvents } from "@/server/inbound/ingest";
import type { ChannelRecord, InboundSender } from "../types";
import { WEBCHAT_MAX_TEXT, widgetMessageSchema, widgetMessageToEvent, type WidgetMessageInput } from "../webchat-adapter";
import { conversationState, findVisitorConversation, visitorMessage, type WidgetMessage, type WidgetState } from "./conversation";
import { verifyUploadReceipt, type VisitorIdentity } from "./tokens";
import { assertMediaAllowed } from "./upload";

const MAX_UPLOAD_RECEIPT = 2_000;
const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const digitCount = (value: string) => value.replace(/\D/g, "").length;

/** A phone the visitor types: data for the contact, never a key ([CAN-13]). Kept as «+» and digits. */
const phoneSchema = z
  .string()
  .trim()
  .max(30, "El teléfono es demasiado largo.")
  .regex(/^\+?[\d\s().-]+$/, "Escribe un teléfono válido.")
  .refine((value) => digitCount(value) >= 6 && digitCount(value) <= 15, "Escribe un teléfono válido.")
  .transform((value) => `${value.startsWith("+") ? "+" : ""}${value.replace(/\D/g, "")}`);

/** The optional form «Déjanos tus datos»: only what the visitor wants to give ([WEB-05]). */
const contactFormSchema = z
  .object({
    // One line: a name never passes for another line of the message, a prompt or a subject ([HER-09]).
    name: z.preprocess(blankToUndefined, z.string().trim().max(100, "El nombre es demasiado largo.").transform((value) => toSingleLine(value)).optional()),
    email: z.preprocess(blankToUndefined, emailSchema.optional()),
    phone: z.preprocess(blankToUndefined, phoneSchema.optional()),
  })
  .strict()
  .refine((value) => Boolean(value.name || value.email || value.phone), "Escribe al menos un dato.");

type ContactForm = z.output<typeof contactFormSchema>;

const sendSchema = z
  .object({
    clientMessageId: z.uuid({ error: "Mensaje no válido." }),
    text: z.string().trim().max(WEBCHAT_MAX_TEXT, "El mensaje es demasiado largo.").nullish(),
    /** Receipt of /upload: the image or voice note this visitor uploaded. */
    upload: z.string().max(MAX_UPLOAD_RECEIPT).nullish(),
    contact: contactFormSchema.nullish(),
  })
  .strict();

/** Validates or throws a ValidationError whose message is the first problem, so the widget can show it. */
function parseWidgetInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ValidationError(result.error.issues[0]?.message ?? "Revisa el mensaje.");
}

/** The contact form as a message the team and the agent read in the conversation. */
function contactText(form: ContactForm): string {
  const lines = [
    form.name ? `Nombre: ${form.name}` : null,
    form.email ? `Email: ${form.email}` : null,
    form.phone ? `Teléfono: ${form.phone}` : null,
  ].filter((line): line is string => line !== null);
  return ["Mis datos de contacto:", ...lines].join("\n");
}

/** One legal acceptance per contact and chat, with date and channel ([CUM-13]): writing implies accepting. */
async function recordLegalAcceptance(contactId: string, channel: ChannelRecord, now: Date): Promise<void> {
  const [existing] = await db
    .select({ id: consents.id })
    .from(consents)
    .where(and(eq(consents.contactId, contactId), eq(consents.channelId, channel.id), eq(consents.type, "legal_acceptance")))
    .limit(1);
  if (existing) return;
  await db.insert(consents).values({ contactId, channelId: channel.id, channelType: channel.type, type: "legal_acceptance", source: "widget", createdAt: now, updatedAt: now });
}

export type SentVisitorMessage = {
  /** The stored message (also when it was a retry of one already stored). */
  message: WidgetMessage | null;
  duplicate: boolean;
  /** When the reply job is due, for kickTick(). */
  replyRunAt: Date | null;
  state: WidgetState;
};

export async function sendVisitorMessage(channel: ChannelRecord, visitor: VisitorIdentity, input: unknown, now: Date = new Date()): Promise<SentVisitorMessage> {
  const data = parseWidgetInput(sendSchema, input);
  const base = { visitorId: visitor.visitorId, clientMessageId: data.clientMessageId };
  let body: WidgetMessageInput;
  let sender: Pick<InboundSender, "email" | "phone"> = {};
  if (data.contact) {
    body = { ...base, contentType: "text", text: contactText(data.contact), name: data.contact.name ?? null };
    sender = { email: data.contact.email ?? null, phone: data.contact.phone ?? null };
  } else if (data.upload) {
    const receipt = verifyUploadReceipt(data.upload, visitor, now);
    if (!receipt) throw new ValidationError("El archivo ya no es válido. Vuelve a adjuntarlo.");
    // The chat may have switched images or voice notes off since the upload ([WEB-07]).
    assertMediaAllowed(channel, receipt.kind);
    body = { ...base, contentType: receipt.kind, text: data.text ?? null, media: { fileKey: receipt.fileKey, mimeType: receipt.mimeType, size: receipt.size } };
  } else {
    body = { ...base, contentType: "text", text: data.text ?? null };
  }
  parseWidgetInput(widgetMessageSchema, body);
  const event = widgetMessageToEvent(body, now);
  event.sender = { ...event.sender, ...sender };

  const result = await ingestEvents(channel, [event], { now });
  const [ingested] = result.messages;
  const conversation = await findVisitorConversation(channel.id, visitor.visitorId);
  // A retried message comes back as a duplicate of the visitor's own message; anything else is never shown.
  const own = Boolean(ingested?.messageId && conversation && ingested.conversationId === conversation.id);
  if (own && !ingested.duplicate && ingested.contactId) await recordLegalAcceptance(ingested.contactId, channel, now);
  return {
    message: own && conversation && ingested.messageId ? await visitorMessage(conversation.id, ingested.messageId) : null,
    duplicate: ingested?.duplicate ?? true,
    replyRunAt: result.replyRunAt,
    state: conversation ? await conversationState(channel, conversation, now) : { typing: false, handedOff: false },
  };
}
