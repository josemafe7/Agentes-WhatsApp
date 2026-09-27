// Booking reminders ([AGD-24], [AGD-25], [CUM-03]): off by default. When on, a recurring job looks every few minutes
// for bookings whose reminder moment (start − lead) has come and sends each one reminder, by WhatsApp with an approved
// utility template and its variables mapped in Agenda › Configuración (sendTemplateMessage, which never writes to a
// customer who opted out or from a disabled channel) or by email.
// - Email, so the customer can answer to cancel ([AGD-26]): when the customer already wrote to one of the business's
//   connected mailboxes (Gmail, Outlook or IMAP), the reminder is a reply in that thread, sent by the channel like any
//   message of the inbox, and the answer lands in that same conversation (where the AI can cancel and «BAJA» works).
//   Otherwise it goes by the system mail with Reply-To: the connected mailbox, so the answer still reaches the inbox,
//   or, without one, the business's contact email (a person reads it). A first email never goes through a mailbox
//   connector: they only answer an email received (Outlook replies to it; Gmail and IMAP would title it «Re:»).
// - Once: the booking is claimed atomically (reminder_sent_at set only if still empty and the booking still pending or
//   confirmed) before anything is sent, so two rounds at once never send it twice; a failure is recorded, not retried.
//   Its status is read again right before sending: a booking cancelled meanwhile is released, not reminded.
// - Never for cancelled, completed, no-show or test bookings, nor for bookings made after their reminder moment
//   (the customer just got the confirmation). A moved booking is recalculated (src/server/booking/service.ts).
import "server-only";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { getEmailBrand } from "@/data/business";
import { loadBusinessSettings } from "@/data/settings";
import { sendTemplateMessage } from "@/data/whatsapp-send";
import { db } from "@/db";
import { bookings, channels, consents, contacts, conversations, reminderSettings } from "@/db/schema";
import { emailSchema } from "@/lib/validation";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import { EMAIL_CHANNEL_TYPES, isEmailChannelType, readEmailConfig, type EmailChannelType } from "@/server/channels/email/config";
import { replyRecipientContactId } from "@/server/channels/email/reply-context";
import { bookingReminderEmail } from "@/server/email-templates";
import { AppError } from "@/server/errors";
import { sendSystemEmail, type MailerOptions } from "@/server/mailer";
import { sendOutbound } from "@/server/outbound/send";
import { safeErrorMessage } from "@/server/redact";
import { OCCUPYING_STATUSES } from "./availability";
import { bookingDayText, bookingTimeText, bookingWord } from "./format";
import { type AgendaSettingsSnapshot, loadAgendaSettings } from "./load";
import { defaultReminderEmail, ReminderMappingError, type ReminderValues, renderReminderText, templateVariablesFor } from "./reminder-fields";
import { type BookingActor, recordBookingEvent } from "./events";
import { MINUTE_MS } from "./time";
import { type BookingView, selectBookingView } from "./views";

export const BOOKING_REMINDERS_JOB = "booking.reminders";
export const BOOKING_REMINDERS_KEY = "booking.reminders";
/** How often due reminders are looked for. */
export const REMINDERS_INTERVAL_MS = 5 * 60_000;
/** Reminders sent in one round at most; the rest wait for the next round. */
const MAX_PER_ROUND = 50;
/** A contact's email conversations looked at to find the thread the reminder answers. */
const THREAD_CANDIDATES = 10;
const SYSTEM: BookingActor = { type: "system" };

type Settings = typeof reminderSettings.$inferSelect;

/** Keeps the recurring job alive while reminders are on (idempotent), or removes the pending one when they go off. */
export async function syncBookingReminderJob(enabled: boolean, options: { queue?: JobQueue; now?: Date } = {}): Promise<void> {
  const queue = options.queue ?? getJobQueue();
  if (enabled) {
    await queue.ensureRecurring({ type: BOOKING_REMINDERS_JOB, key: BOOKING_REMINDERS_KEY, intervalMs: REMINDERS_INTERVAL_MS, firstRunAt: options.now });
  } else {
    await queue.cancel({ dedupeKey: `recurring:${BOOKING_REMINDERS_KEY}` });
  }
}

export type ReminderRoundResult = { sent: number; failed: number };

async function loadSettings(): Promise<Settings | null> {
  const [row] = await db.select().from(reminderSettings).limit(1);
  return row ?? null;
}

/** Bookings whose reminder moment has come and that were booked before it. */
async function dueBookings(now: Date, leadMinutes: number): Promise<string[]> {
  const leadMs = leadMinutes * MINUTE_MS;
  const rows = await db
    .select({ id: bookings.id, startsAt: bookings.startsAt, createdAt: bookings.createdAt })
    .from(bookings)
    .where(
      and(
        inArray(bookings.status, [...OCCUPYING_STATUSES]),
        eq(bookings.isTest, false),
        isNull(bookings.reminderSentAt),
        isNotNull(bookings.contactId),
        gt(bookings.startsAt, now),
        lte(bookings.startsAt, new Date(now.getTime() + leadMs)),
      ),
    )
    .orderBy(asc(bookings.startsAt))
    .limit(MAX_PER_ROUND * 4);
  return rows
    .filter((row) => row.createdAt.getTime() <= row.startsAt.getTime() - leadMs)
    .slice(0, MAX_PER_ROUND)
    .map((row) => row.id);
}

/**
 * Takes the booking for this round; false when another round already did, or when it is no longer pending or
 * confirmed (cancelled since the round listed it) ([AGD-25]).
 */
async function claim(bookingId: string, now: Date): Promise<boolean> {
  const claimed = await db
    .update(bookings)
    .set({ reminderSentAt: now })
    .where(and(eq(bookings.id, bookingId), isNull(bookings.reminderSentAt), inArray(bookings.status, [...OCCUPYING_STATUSES])))
    .returning({ id: bookings.id });
  return claimed.length === 1;
}

/** Still pending or confirmed, read again right before sending. */
async function stillDue(bookingId: string): Promise<boolean> {
  const [row] = await db.select({ status: bookings.status }).from(bookings).where(eq(bookings.id, bookingId));
  return row !== undefined && OCCUPYING_STATUSES.includes(row.status);
}

/** Gives the claim back (the booking was cancelled meanwhile): it gets a reminder if it is ever brought back. */
async function release(bookingId: string, claimedAt: Date): Promise<void> {
  await db
    .update(bookings)
    .set({ reminderSentAt: null })
    .where(and(eq(bookings.id, bookingId), eq(bookings.reminderSentAt, claimedAt)));
}

function valuesOf(view: BookingView, contactName: string | null, agenda: AgendaSettingsSnapshot): ReminderValues {
  return {
    "contact.name": view.contactName ?? contactName ?? "",
    "service.name": view.service.name,
    "booking.date": bookingDayText(view.startsAt, agenda.timezone),
    "booking.time": bookingTimeText(view.startsAt, agenda.timezone),
    "resource.name": view.resource.name,
    "booking.people": String(view.people),
    "business.name": agenda.businessName,
  };
}

/** The latest choice of the contact in the email channels is «baja» ([CUM-03]). */
async function optedOutOfEmail(contactId: string): Promise<boolean> {
  const [latest] = await db
    .select({ type: consents.type })
    .from(consents)
    .where(and(eq(consents.contactId, contactId), inArray(consents.channelType, [...EMAIL_CHANNEL_TYPES]), inArray(consents.type, ["opt_out", "opt_in"])))
    .orderBy(desc(consents.createdAt))
    .limit(1);
  return latest?.type === "opt_out";
}

type SendOutcome = { ok: true; via: string } | { ok: false; reason: string };

async function sendByWhatsApp(settings: Settings, view: BookingView, values: ReminderValues, now: Date): Promise<SendOutcome> {
  if (!settings.whatsappChannelId || !settings.templateName || !settings.templateLanguage) return { ok: false, reason: "Falta elegir el número y la plantilla de WhatsApp." };
  const sent = await sendTemplateMessage(
    {
      channelId: settings.whatsappChannelId,
      contactId: view.contactId ?? "",
      templateName: settings.templateName,
      language: settings.templateLanguage,
      variables: templateVariablesFor(settings.templateVariables, values),
    },
    { now },
  );
  return sent.status === "failed" ? { ok: false, reason: sent.error?.message ?? "No se pudo enviar." } : { ok: true, via: "whatsapp" };
}

type Mailbox = { channelId: string; channelType: EmailChannelType; address: string };

/** The business's own mailboxes that can send now: connected, not the demo's and not waiting for a new connection. */
async function usableMailboxes(): Promise<Mailbox[]> {
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

/**
 * The contact's latest real thread in one of those mailboxes whose reply reaches them: the newest customer email of
 * the thread is theirs (a thread takes emails from anyone, and the reminder carries their booking); null when none.
 */
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
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.createdAt))
    .limit(THREAD_CANDIDATES);
  for (const row of rows) {
    // The simulator's conversations never leave the app ([AJU-13]).
    if (row.metadata.simulated === true) continue;
    const mailbox = mailboxes.find((item) => item.channelId === row.channelId);
    if (mailbox && (await replyRecipientContactId(row.id, mailbox.channelType, null)) === contactId) return { conversationId: row.id, mailbox };
  }
  return null;
}

/** Where the answer to a system email goes: the connected mailbox (so it reaches the inbox), else the business's email. */
async function replyAddress(mailboxes: readonly Mailbox[]): Promise<string | undefined> {
  const candidates = [mailboxes[0]?.address, (await loadBusinessSettings()).contactEmail];
  for (const candidate of candidates) {
    const parsed = emailSchema.safeParse(candidate ?? "");
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

async function sendByEmail(
  settings: Settings,
  view: BookingView,
  values: ReminderValues,
  agenda: AgendaSettingsSnapshot,
  options: { mailer: MailerOptions; now: Date },
): Promise<SendOutcome> {
  const contactId = view.contactId ?? "";
  if (await optedOutOfEmail(contactId)) return { ok: false, reason: "El cliente se ha dado de baja del correo." };
  const defaults = defaultReminderEmail(bookingWord(agenda.terminology));
  const subject = renderReminderText(settings.emailSubject?.trim() || defaults.subject, values);
  const body = renderReminderText(settings.emailBody?.trim() || defaults.body, values);
  const mailboxes = await usableMailboxes();
  const thread = await contactThread(contactId, mailboxes);
  if (thread) {
    // A reply in the customer's thread: it keeps the thread's subject, so the text says it all.
    const sent = await sendOutbound({ conversationId: thread.conversationId, sender: { type: "system" }, text: body, metadata: { bookingReminder: view.id }, now: options.now });
    return sent.status === "failed" ? { ok: false, reason: sent.error?.message ?? "No se pudo enviar." } : { ok: true, via: thread.mailbox.channelType };
  }
  const [contact] = await db.select({ email: contacts.email }).from(contacts).where(eq(contacts.id, contactId));
  if (!contact?.email) return { ok: false, reason: "El cliente no tiene email." };
  const email = bookingReminderEmail({ brand: await getEmailBrand(), subject, body });
  const result = await sendSystemEmail({ kind: "reminder", to: contact.email, replyTo: await replyAddress(mailboxes), ...email }, options.mailer);
  return result.ok ? { ok: true, via: result.via } : { ok: false, reason: result.message };
}

/** One round: sends the reminders that are due. Never throws for one booking; each outcome goes to its history. */
export async function runBookingReminders(options: { now?: Date; mailer?: MailerOptions } = {}): Promise<ReminderRoundResult> {
  const now = options.now ?? new Date();
  const settings = await loadSettings();
  const result: ReminderRoundResult = { sent: 0, failed: 0 };
  if (!settings?.enabled || settings.leadMinutes <= 0) return result;
  const agenda = await loadAgendaSettings();
  for (const bookingId of await dueBookings(now, settings.leadMinutes)) {
    if (!(await claim(bookingId, now))) continue;
    const view = await selectBookingView(bookingId, agenda.timezone);
    if (!view?.contactId) continue;
    let outcome: SendOutcome;
    try {
      const [contact] = await db.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, view.contactId));
      const values = valuesOf(view, contact?.name ?? null, agenda);
      // Cancelled by someone since the round listed it: nothing goes out ([AGD-25]).
      if (!(await stillDue(bookingId))) {
        await release(bookingId, now);
        continue;
      }
      outcome =
        settings.channel === "email"
          ? await sendByEmail(settings, view, values, agenda, { mailer: options.mailer ?? {}, now })
          : await sendByWhatsApp(settings, view, values, now);
    } catch (error) {
      if (!(error instanceof AppError) && !(error instanceof ReminderMappingError)) {
        console.error(`[agenda] Recordatorio fallido: ${safeErrorMessage(error)}`);
      }
      outcome = { ok: false, reason: error instanceof AppError ? error.userMessage : error instanceof ReminderMappingError ? error.message : "Error inesperado." };
    }
    if (outcome.ok) {
      result.sent++;
      await recordBookingEvent(db, bookingId, SYSTEM, "reminder_sent", { channel: settings.channel, via: outcome.via }, now);
    } else {
      result.failed++;
      await recordBookingEvent(db, bookingId, SYSTEM, "reminder_failed", { channel: settings.channel, reason: outcome.reason }, now);
    }
  }
  return result;
}
