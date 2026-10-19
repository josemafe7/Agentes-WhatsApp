// One reminder through one of its channels ([AGD-24], [TG-12], [CUM-03], [CTO-09], [ENV-14]): whether the customer can
// receive it there and, if so, the message. WhatsApp: an approved utility template of that number to whoever has a
// WhatsApp, has not said no to «Avisos de sus citas» (given by default, decision 0030) and no baja of WhatsApp.
// Telegram: the text with its two buttons through the bot, to whoever has written to that bot, has not blocked it,
// has not said no to the permission and no baja. Email: by the customer's thread in a connected mailbox (so the
// answer reaches the inbox) or by the system mail, whatever the permission says (it only informs of their booking),
// unless they opted out of email. A contact of the demo or the
// simulator gets nothing through a channel that is not a demo one. Each refusal says why, in a few words.
import "server-only";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { getEmailBrand } from "@/data/business";
import { getSmtpConfig, loadBusinessSettings } from "@/data/settings";
import { sendTemplateMessage } from "@/data/whatsapp-send";
import { db } from "@/db";
import { channels, contactIdentities, contacts, conversations, messages, whatsappTemplates } from "@/db/schema";
import { BLOCK_REASON_TEXT, blockReason } from "@/lib/consents";
import { sameTemplateLanguage } from "@/lib/meta/templates";
import type { ReminderRoute, ReminderRule } from "@/lib/reminder-rules";
import { emailSchema } from "@/lib/validation";
import { isOfficialWhatsApp } from "@/lib/whatsapp-via";
import { EMAIL_CHANNEL_TYPES, isEmailChannelType, readEmailConfig, type EmailChannelType } from "@/server/channels/email/config";
import { replyRecipientContactId } from "@/server/channels/email/reply-context";
import { loadConsentState } from "@/server/compliance/consent-state";
import { phoneOfAnotherContact, PHONE_OF_ANOTHER_CONTACT, whatsappPhoneOf } from "@/server/channels/whatsapp/first-contact";
import { isDemoOrSimulatedContact } from "@/server/compliance/template-permission";
import { bookingReminderEmail } from "@/server/email-templates";
import { AppError } from "@/server/errors";
import { sendSystemEmail, type MailerOptions } from "@/server/mailer";
import { sendOutbound } from "@/server/outbound/send";
import { descNullsLast } from "@/server/sql-helpers";
import { bookingWord } from "./format";
import type { AgendaSettingsSnapshot } from "./load";
import { defaultReminderEmail, defaultReminderTelegram, ReminderMappingError, renderReminderText, templateVariablesFor, type ReminderValues } from "./reminder-fields";
import type { BookingView } from "./views";

/** A conversation looked at to find the customer's email thread. */
const THREAD_CANDIDATES = 10;
export const CONFIRM_LABEL = "Confirmo";
export const CHANGE_LABEL = "Necesito cambiarla";

export type ReminderContext = {
  sendId: string;
  rule: ReminderRule;
  view: BookingView & { contactId: string };
  values: ReminderValues;
  agenda: AgendaSettingsSnapshot;
  healthData: boolean;
  now: Date;
  mailer: MailerOptions;
};

export type RouteResult = { outcome: "sent"; messageId: string | null; via: string } | { outcome: "failed" | "skipped"; reason: string };

const skip = (reason: string): RouteResult => ({ outcome: "skipped", reason });

/** What the reminder message keeps, to match its buttons and a later failure ([AGD-32]). */
function reminderMetadata(ctx: ReminderContext, buttons: { confirm: string | null; change: string | null }) {
  return { bookingReminder: { sendId: ctx.sendId, bookingId: ctx.view.id, startsAt: ctx.view.startsAt.toISOString(), ...buttons } };
}

async function blockedByConsent(ctx: ReminderContext, kind: "whatsapp" | "telegram" | "email"): Promise<string | null> {
  const reason = blockReason(await loadConsentState(ctx.view.contactId), kind, "reminder");
  if (reason === "opted_out") return kind === "email" ? "Se ha dado de baja del correo" : `Se ha dado de baja de ${kind === "whatsapp" ? "WhatsApp" : "Telegram"}`;
  if (reason === "no_reminders_permission") return BLOCK_REASON_TEXT.no_reminders_permission;
  return null;
}

async function byWhatsApp(ctx: ReminderContext): Promise<RouteResult> {
  const config = ctx.rule.whatsapp;
  if (!config) return skip("Falta elegir el número y la plantilla de WhatsApp");
  const [channel] = await db.select().from(channels).where(eq(channels.id, config.channelId));
  if (!channel || !isOfficialWhatsApp(channel) || channel.status === "disabled" || (!channel.isDemo && channel.status !== "connected")) return skip("El número de WhatsApp no está conectado");
  const [identity] = await db
    .select({ id: contactIdentities.id })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.contactId, ctx.view.contactId), eq(contactIdentities.channelType, "whatsapp")))
    .limit(1);
  // Never written by WhatsApp: the first one goes to its phone ([WA-63]), unless that WhatsApp is someone else's.
  let firstContactPhone: string | undefined;
  if (!identity) {
    const [contact] = await db.select({ phone: contacts.phone }).from(contacts).where(eq(contacts.id, ctx.view.contactId));
    const phone = whatsappPhoneOf(contact?.phone);
    if (!phone) return skip("Sin WhatsApp ni teléfono");
    if (await phoneOfAnotherContact(ctx.view.contactId, phone)) return skip(PHONE_OF_ANOTHER_CONTACT);
    firstContactPhone = phone;
  }
  const consent = await blockedByConsent(ctx, "whatsapp");
  if (consent) return skip(consent);
  if (!channel.isDemo && (await isDemoOrSimulatedContact(ctx.view.contactId))) return skip("Es un contacto de la demo o del simulador");
  const templates = await db.select().from(whatsappTemplates).where(and(eq(whatsappTemplates.channelId, channel.id), eq(whatsappTemplates.name, config.templateName)));
  const template = templates.find((row) => sameTemplateLanguage(row.language, config.templateLanguage));
  // A utility template moved to marketing no longer serves ([WA-60]).
  if (!template || template.status?.toUpperCase() !== "APPROVED" || template.category?.toUpperCase() !== "UTILITY") return skip("La plantilla ya no es de utilidad aprobada");
  const sent = await sendTemplateMessage(
    { channelId: channel.id, contactId: ctx.view.contactId, templateName: template.name, language: template.language, variables: templateVariablesFor(config.variables, ctx.values) },
    { now: ctx.now, metadata: reminderMetadata(ctx, { confirm: config.confirmButton, change: config.changeButton }), firstContactPhone },
  );
  return sent.status === "failed" ? { outcome: "failed", reason: sent.error?.message ?? "No se pudo enviar" } : { outcome: "sent", messageId: sent.messageId, via: "whatsapp" };
}

async function byTelegram(ctx: ReminderContext): Promise<RouteResult> {
  const config = ctx.rule.telegram;
  if (!config) return skip("Falta elegir el bot de Telegram");
  const [channel] = await db.select().from(channels).where(eq(channels.id, config.channelId));
  if (!channel || channel.type !== "telegram" || channel.status === "disabled" || (!channel.isDemo && channel.status !== "connected")) return skip("El bot de Telegram no está conectado");
  const [conversation] = await db
    .select({ id: conversations.id, metadata: conversations.metadata })
    .from(conversations)
    .where(and(eq(conversations.channelId, channel.id), eq(conversations.contactId, ctx.view.contactId), eq(conversations.isTest, false)))
    .orderBy(desc(conversations.createdAt))
    .limit(1);
  const [written] = conversation
    ? await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.conversationId, conversation.id), eq(messages.direction, "inbound")))
        .limit(1)
    : [];
  // A bot never writes first ([TG-07]); the simulator's conversations never leave the app.
  if (!conversation || !written || conversation.metadata.simulated === true) return skip("No ha escrito al bot");
  if (conversation.metadata.telegramBlockedAt) return skip("Ha bloqueado el bot");
  const consent = await blockedByConsent(ctx, "telegram");
  if (consent) return skip(consent);
  if (!channel.isDemo && (await isDemoOrSimulatedContact(ctx.view.contactId))) return skip("Es un contacto de la demo o del simulador");
  const text = renderReminderText(config.text.trim() || defaultReminderTelegram(bookingWord(ctx.agenda.terminology), { healthData: ctx.healthData }), ctx.values);
  const sent = await sendOutbound({
    conversationId: conversation.id,
    sender: { type: "system" },
    text,
    metadata: {
      ...reminderMetadata(ctx, { confirm: CONFIRM_LABEL, change: CHANGE_LABEL }),
      // The two buttons ([TG-13]): a short code with the reminder and the action, never data of the customer.
      telegramButtons: [
        { text: CONFIRM_LABEL, data: `rc:${ctx.sendId}` },
        { text: CHANGE_LABEL, data: `rx:${ctx.sendId}` },
      ],
    },
    now: ctx.now,
  });
  return sent.status === "failed" ? { outcome: "failed", reason: sent.error?.message ?? "No se pudo enviar" } : { outcome: "sent", messageId: sent.messageId, via: "telegram" };
}

type Mailbox = { channelId: string; channelType: EmailChannelType; address: string };

/** The business's own mailboxes that can send now: connected, not the demo's and not waiting for a new connection. */
export async function usableMailboxes(): Promise<Mailbox[]> {
  const rows = await db
    .select({ id: channels.id, type: channels.type, config: channels.config })
    .from(channels)
    .where(and(inArray(channels.type, [...EMAIL_CHANNEL_TYPES]), eq(channels.status, "connected"), eq(channels.isDemo, false)))
    .orderBy(asc(channels.createdAt), asc(channels.id));
  return rows.flatMap((row) => {
    const config = readEmailConfig(row.config);
    const address = config.emailAddress?.toLowerCase();
    return config.reconnect || !address || !isEmailChannelType(row.type) ? [] : [{ channelId: row.id, channelType: row.type, address }];
  });
}

/** The contact's latest real thread in one of those mailboxes whose reply reaches them; null when none. */
async function contactThread(contactId: string, mailboxes: readonly Mailbox[]): Promise<{ conversationId: string; mailbox: Mailbox } | null> {
  if (mailboxes.length === 0) return null;
  const rows = await db
    .select({ id: conversations.id, channelId: conversations.channelId, metadata: conversations.metadata })
    .from(conversations)
    .where(
      and(
        eq(conversations.contactId, contactId),
        inArray(
          conversations.channelId,
          mailboxes.map((mailbox) => mailbox.channelId),
        ),
        eq(conversations.isTest, false),
        isNotNull(conversations.externalThreadId),
      ),
    )
    .orderBy(descNullsLast(conversations.lastMessageAt), desc(conversations.createdAt))
    .limit(THREAD_CANDIDATES);
  for (const row of rows) {
    if (row.metadata.simulated === true) continue;
    const mailbox = mailboxes.find((item) => item.channelId === row.channelId);
    if (mailbox && (await replyRecipientContactId(row.id, mailbox.channelType, null)) === contactId) return { conversationId: row.id, mailbox };
  }
  return null;
}

/** Where the answer to a system email goes: the connected mailbox (so it reaches the inbox), else the business's email. */
export async function replyAddress(mailboxes: readonly Mailbox[]): Promise<string | undefined> {
  const candidates = [mailboxes[0]?.address, (await loadBusinessSettings()).contactEmail];
  for (const candidate of candidates) {
    const parsed = emailSchema.safeParse(candidate ?? "");
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

async function byEmail(ctx: ReminderContext): Promise<RouteResult> {
  const consent = await blockedByConsent(ctx, "email");
  if (consent) return skip(consent);
  const defaults = defaultReminderEmail(bookingWord(ctx.agenda.terminology), { healthData: ctx.healthData });
  const subject = renderReminderText(ctx.rule.email?.subject.trim() || defaults.subject, ctx.values);
  const body = renderReminderText(ctx.rule.email?.body.trim() || defaults.body, ctx.values);
  const demoContact = await isDemoOrSimulatedContact(ctx.view.contactId);
  const mailboxes = demoContact ? [] : await usableMailboxes();
  const thread = await contactThread(ctx.view.contactId, mailboxes);
  if (thread) {
    // A reply in the customer's thread: it keeps the thread's subject, so the text says it all.
    const sent = await sendOutbound({ conversationId: thread.conversationId, sender: { type: "system" }, text: body, metadata: reminderMetadata(ctx, { confirm: null, change: null }), now: ctx.now });
    return sent.status === "failed" ? { outcome: "failed", reason: sent.error?.message ?? "No se pudo enviar" } : { outcome: "sent", messageId: sent.messageId, via: thread.mailbox.channelType };
  }
  const [contact] = await db.select({ email: contacts.email }).from(contacts).where(eq(contacts.id, ctx.view.contactId));
  if (!contact?.email) return skip("Sin email");
  // An address that is not one (typed long ago) says so and the next channel goes, instead of failing the reminder.
  if (!emailSchema.safeParse(contact.email).success) return skip("Su email no es válido");
  // The demo's contacts only get what stays in the app: the local outbox, never a real SMTP ([ENV-14]).
  if (demoContact && (await getSmtpConfig())) return skip("Es un contacto de la demo o del simulador");
  const email = bookingReminderEmail({ brand: await getEmailBrand(), subject, body });
  // With the contact and the booking: an answer that reaches a connected mailbox goes to them ([AGD-24], [AGD-26]).
  const result = await sendSystemEmail(
    { kind: "reminder", to: contact.email, replyTo: await replyAddress(mailboxes), ...email, recipient: { contactId: ctx.view.contactId, bookingId: ctx.view.id } },
    ctx.mailer,
  );
  return result.ok ? { outcome: "sent", messageId: null, via: result.via } : { outcome: "failed", reason: result.message };
}

/** Tries the reminder through one channel; never throws for a refusal of the channel. */
export async function tryRoute(route: ReminderRoute, ctx: ReminderContext): Promise<RouteResult> {
  try {
    if (route === "whatsapp") return await byWhatsApp(ctx);
    if (route === "telegram") return await byTelegram(ctx);
    return await byEmail(ctx);
  } catch (error) {
    if (error instanceof AppError) return { outcome: "failed", reason: error.userMessage };
    if (error instanceof ReminderMappingError) return { outcome: "failed", reason: error.message };
    throw error;
  }
}
