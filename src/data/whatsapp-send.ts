// WhatsApp in the inbox ([BAN-08], [WA-42], [WA-43], [CAN-14]): the 24 h window of a conversation (from the customer's
// last message as Meta dates it, or closed by Meta after a 131047), the APPROVED templates a person may send, and the
// two ways a template leaves: a person from the inbox, like any reply (it pauses the AI, [BAN-11]), and the app itself
// (reminders, [AGD-24]) through sendTemplateMessage. No template goes from a disabled channel ([CAN-16]), to a customer
// who opted out of WhatsApp ([CUM-03]) nor without the permission it needs ([WA-61], src/server/compliance/
// template-permission.ts): the inbox says which one is missing and lets it be recorded first. Sending goes through
// sendOutbound and the channel's adapter.
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, whatsappTemplates } from "@/db/schema";
import { sameTemplateLanguage } from "@/lib/meta/templates";
import { whatsappWindowState } from "@/lib/meta/window";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { whatsappViaOf } from "@/lib/whatsapp-via";
import type { ChannelRecord } from "@/server/channels/types";
import { isOptedOut } from "@/server/compliance/opt-out";
import { TEMPLATE_BLOCK_TEXT, templateBlock, type TemplateBlock } from "@/server/compliance/template-permission";
import { ConflictError, NotFoundError, parseInput } from "@/server/errors";
import { sendOutbound, type SendOutboundResult } from "@/server/outbound/send";
import { loadConversationFor } from "./conversation-scope";
import { afterHumanReply, type SendHumanResult } from "./messages";
import { loadWhatsAppChannel, OFFICIAL_WHATSAPP_VIAS } from "./whatsapp";
import { firstContactMetadata } from "@/server/channels/whatsapp/first-contact";
import { enforceWhatsAppLimit } from "./whatsapp-limits";
import { buildWhatsAppTemplateMessage, listWhatsAppTemplates, templateMessageOf, templateMessageSchema } from "./whatsapp-templates";

/** Same text as a reply from a disabled channel (src/data/messages.ts). */
const DISABLED_CHANNEL = "El canal está desactivado: no se pueden enviar mensajes.";

export type WhatsAppInboxTemplate = {
  id: string;
  name: string;
  language: string;
  category: string | null;
  components: unknown[];
  /** Why it may not go to this customer now, and the permission that would let it ([WA-61]). */
  blocked: Pick<TemplateBlock, "message" | "permission"> | null;
};

export type WhatsAppInboxState = {
  /** Open while less than 24 h have passed since the customer's last message and Meta has not closed it ([WA-43]). */
  window: { open: boolean; closesAt: Date | null; closedByMeta: boolean };
  /** APPROVED templates of the channel, only for whoever may reply there ([PER-02], [PER-03]). */
  templates: WhatsAppInboxTemplate[];
  /** The customer opted out in this channel: no templates ([CUM-03]). */
  optedOut: boolean;
};

async function assertTemplateAllowed(channel: ChannelRecord, contactId: string | null): Promise<void> {
  if (channel.status === "disabled") throw new ConflictError(DISABLED_CHANNEL);
  if (await isOptedOut(contactId, channel.id)) throw new ConflictError(TEMPLATE_BLOCK_TEXT.opted_out);
}

/** After the template and its values are checked: the permission it needs ([WA-61]) and [ENV-14]. */
async function assertTemplatePermission(channel: ChannelRecord, contactId: string | null, template: TemplateRow): Promise<void> {
  if (!contactId) throw new ConflictError("Esta conversación no tiene contacto.");
  const block = await templateBlock({ contactId, channelIsDemo: channel.isDemo, template });
  if (block) throw new ConflictError(block.message);
}

/**
 * What the conversation screen needs in WhatsApp ([BAN-08]): its window, the approved templates (for whoever may reply
 * there) and whether the customer opted out. null for a conversation of another channel type.
 */
export async function getWhatsAppInboxState(actor: Actor, conversationId: string, options: { now?: Date } = {}): Promise<WhatsAppInboxState | null> {
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.view, conversationId);
  const [channel] = await db.select({ type: channels.type, connectionMode: channels.connectionMode }).from(channels).where(eq(channels.id, conversation.channelId));
  // A number linked by QR code has neither window nor templates ([WA-55]).
  const via = channel ? whatsappViaOf(channel) : null;
  if (via === null || !OFFICIAL_WHATSAPP_VIAS.includes(via)) return null;
  const { open, closesAt, closedByMeta } = whatsappWindowState(conversation.lastInboundAt, options.now ?? new Date(), conversation.metadata);
  const mayReply = can(actor, PERMISSIONS.inbox.reply, { channelId: conversation.channelId });
  const [templates, optedOut] = await Promise.all([
    mayReply ? listWhatsAppTemplates(actor, conversation.channelId, { approvedOnly: true }) : Promise.resolve([]),
    isOptedOut(conversation.contactId, conversation.channelId),
  ]);
  const contactId = conversation.contactId;
  const channelIsDemo = (await db.select({ isDemo: channels.isDemo }).from(channels).where(eq(channels.id, conversation.channelId)))[0]?.isDemo ?? false;
  return {
    window: { open, closesAt, closedByMeta },
    templates: await Promise.all(
      templates.map(async ({ id, name, language, category, components, buttonRoles }) => {
        const block = contactId ? await templateBlock({ contactId, channelIsDemo, template: { category, buttonRoles } }) : null;
        return { id, name, language, category, components, blocked: block ? { message: block.message, permission: block.permission } : null };
      }),
    ),
    optedOut,
  };
}

// ─── A person sends a template from the inbox ([WA-42], [WA-43], [BAN-08]) ───────────────────────────────

export const sendHumanTemplateSchema = templateMessageSchema.extend({ conversationId: idSchema });

/**
 * A person sends an APPROVED template with its values: the way to write when the 24 h window is closed. Like any reply
 * from the inbox it pauses the AI, times the first human response and drops a pending AI reply ([BAN-11]).
 */
export async function sendHumanTemplateMessage(actor: Actor, input: unknown): Promise<SendHumanResult> {
  const { conversationId, ...template } = parseInput(sendHumanTemplateSchema, input);
  const conversation = await loadConversationFor(actor, PERMISSIONS.inbox.reply, conversationId);
  const channel = await loadWhatsAppChannel(conversation.channelId, { allowDemo: true, vias: OFFICIAL_WHATSAPP_VIAS });
  await assertTemplateAllowed(channel, conversation.contactId);
  const message = await buildWhatsAppTemplateMessage(actor, channel.id, template);
  await assertTemplatePermission(channel, conversation.contactId, message.row);
  // Only a template that is really going out counts ([SEG-07]).
  await enforceWhatsAppLimit("template", actor.userId);
  const now = new Date();
  const sent = await sendOutbound({
    conversationId: conversation.id,
    sender: { type: "human", userId: actor.userId, name: actor.name },
    text: message.text,
    contentType: "template",
    metadata: message.metadata,
    now,
  });
  const aiPausedUntil = await afterHumanReply(actor, conversation, sent.messageId, now);
  return { messageId: sent.messageId, status: sent.status, error: sent.error, aiPausedUntil };
}

// ─── The app sends a template (reminders) ([AGD-24], [WA-42]) ────────────────────────────────────────────

/** Meta's template names: lowercase letters, digits and underscores. */
const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
/** «es», «es_ES», «es-ES», «pt_BR»… */
const TEMPLATE_LANGUAGE = /^[A-Za-z]{2,3}(?:[_-][A-Za-z0-9]{2,4})?$/;

export const sendTemplateMessageSchema = z
  .object({
    channelId: idSchema,
    contactId: idSchema,
    templateName: z.string().trim().regex(TEMPLATE_NAME, "Nombre de plantilla no válido."),
    language: z.string().trim().regex(TEMPLATE_LANGUAGE, "Idioma de plantilla no válido."),
    /** Value of each variable, by name («1», «nombre»…). */
    variables: templateMessageSchema.shape.values,
  })
  .strict();
export type SendTemplateMessageInput = z.input<typeof sendTemplateMessageSchema>;
export type SendTemplateMessageResult = Pick<SendOutboundResult, "messageId" | "status" | "error"> & { conversationId: string };

type TemplateRow = typeof whatsappTemplates.$inferSelect;

async function findTemplate(channelId: string, name: string, language: string): Promise<TemplateRow> {
  const rows = await db.select().from(whatsappTemplates).where(and(eq(whatsappTemplates.channelId, channelId), eq(whatsappTemplates.name, name)));
  const template = rows.find((row) => sameTemplateLanguage(row.language, language));
  if (!template) throw new NotFoundError("No se ha encontrado la plantilla en ese idioma. Sincroniza las plantillas del número.");
  return template;
}

/** The contact's one conversation in the channel ([CAN-12]); created when the app writes first. */
async function contactConversation(channelId: string, contactId: string, now: Date): Promise<string> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.channelId, channelId), eq(conversations.contactId, contactId), eq(conversations.isTest, false)))
      .orderBy(desc(conversations.createdAt))
      .limit(1);
    if (existing) return existing.id;
    const [created] = await tx
      .insert(conversations)
      .values({ channelId, contactId, status: "open", aiMode: "ai", createdAt: now, updatedAt: now })
      .returning({ id: conversations.id });
    return created.id;
  });
}

/**
 * Sends an APPROVED template of a WhatsApp channel to a contact, in the contact's conversation of that channel, signed
 * by the app («sistema»). For the app's own messages, such as appointment reminders: system code, callers check who
 * asked. The contact must have a WhatsApp identity (never a phone someone typed). Throws NotFoundError (channel,
 * contact or template in that language), ValidationError (input, a template not approved, a missing value) or
 * ConflictError (disabled channel, opted-out contact, no WhatsApp); a failed send comes back as status «failed».
 */
export async function sendTemplateMessage(
  input: SendTemplateMessageInput,
  /** `firstContactPhone`: for a contact without WhatsApp yet, the phone it goes to ([WA-63]). */
  options: { now?: Date; metadata?: Record<string, unknown>; firstContactPhone?: string } = {},
): Promise<SendTemplateMessageResult> {
  const data = parseInput(sendTemplateMessageSchema, input);
  const channel = await loadWhatsAppChannel(data.channelId, { allowDemo: true, vias: OFFICIAL_WHATSAPP_VIAS });
  const [contact] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, data.contactId));
  if (!contact) throw new NotFoundError("No se ha encontrado el contacto.");
  await assertTemplateAllowed(channel, contact.id);
  const [identity] = await db
    .select({ id: contactIdentities.id })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.contactId, contact.id), eq(contactIdentities.channelType, "whatsapp")))
    .limit(1);
  if (!identity && !options.firstContactPhone) throw new ConflictError("Este contacto no tiene WhatsApp: no se le puede enviar la plantilla.");
  // Only APPROVED templates, built as the inbox builds them, and only with the permission they need ([WA-61]).
  const row = await findTemplate(channel.id, data.templateName, data.language);
  const message = templateMessageOf(row, data.variables);
  await assertTemplatePermission(channel, contact.id, row);
  const now = options.now ?? new Date();
  const conversationId = await contactConversation(channel.id, contact.id, now);
  const metadata = { ...message.metadata, ...options.metadata, ...(!identity && options.firstContactPhone ? firstContactMetadata(options.firstContactPhone) : {}) };
  const sent = await sendOutbound({ conversationId, sender: { type: "system" }, text: message.text, contentType: "template", metadata, now });
  return { conversationId, messageId: sent.messageId, status: sent.status, error: sent.error };
}
