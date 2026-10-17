// The two buttons of a reminder ([AGD-32], [AGD-33], [TG-13]) and what follows a reminder Meta could not deliver after
// accepting it ([AGD-24]). A tap is matched to its reminder by the message it answers (WhatsApp: the template's id at
// Meta, `context.id`; Telegram: the short code of the button) and acts only on that booking, of the customer who taps,
// while it is pending or confirmed, at the same time it had and not started yet ([HER-04]); otherwise it is a message
// like any other. «Confirmo» marks «Confirmada por el cliente» once and queues «¡Gracias! Te esperamos.» (the AI does not
// answer the tap); «Necesito cambiarla» reaches the conversation as the customer's message about that booking, for the
// AI or a person. A failure Meta reports later goes on with the next channel through the queue, never inside the
// webhook ([CAN-10]). System code.
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { bookingReminderSends, bookings, messages } from "@/db/schema";
import type { ReminderAttempt } from "@/lib/reminder-rules";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import type { MailerOptions } from "@/server/mailer";
import { buttonRoleOf, type QuotedMessage, type TappedButton } from "@/server/inbound/button-taps";
import { sendOutbound } from "@/server/outbound/send";
import { OCCUPYING_STATUSES } from "./availability";
import { recordBookingEvent } from "./events";
import { loadReminderConfig } from "./reminder-config";
import { deliverReminder } from "./reminders";

export const REMINDER_THANKS_JOB = "booking.reminder_thanks";
export const reminderThanksPayload = z.object({ conversationId: z.uuid(), bookingId: z.uuid(), startsAt: z.iso.datetime() });
export const REMINDER_FALLBACK_JOB = "booking.reminder_fallback";
export const reminderFallbackPayload = z.object({ sendId: z.uuid(), messageId: z.uuid(), reason: z.string().max(500).nullable() });

export type ReminderAction = "confirm" | "change";
type ReminderMetadata = { sendId: string; bookingId: string; startsAt: string; confirm: string | null; change: string | null };

function reminderOf(metadata: Record<string, unknown>): ReminderMetadata | null {
  const value = metadata.bookingReminder;
  if (typeof value !== "object" || value === null) return null;
  const { sendId, bookingId, startsAt, confirm, change } = value as Record<string, unknown>;
  if (typeof sendId !== "string" || typeof bookingId !== "string" || typeof startsAt !== "string") return null;
  return { sendId, bookingId, startsAt, confirm: typeof confirm === "string" ? confirm : null, change: typeof change === "string" ? change : null };
}

/** The reminder a WhatsApp button answers and what the button does there, if it is one of the two. */
export async function whatsappReminderTap(tx: Executor, quoted: QuotedMessage, button: TappedButton): Promise<{ sendId: string; action: ReminderAction } | null> {
  const reminder = reminderOf(quoted.metadata);
  if (!reminder) return null;
  const label = button.text ?? button.payload;
  if (label && label === reminder.confirm) return { sendId: reminder.sendId, action: "confirm" };
  if (label && label === reminder.change) return { sendId: reminder.sendId, action: "change" };
  const role = await buttonRoleOf(tx, quoted, button);
  return role === "confirm" || role === "change" ? { sendId: reminder.sendId, action: role } : null;
}

export type ReminderTapOutcome = { handled: boolean; thanks: z.infer<typeof reminderThanksPayload> | null };

/**
 * Inside the ingest transaction, for a tap on a reminder's button: what it does to the booking. `handled`: the AI does
 * not answer it. An invalid tap (another customer, a booking cancelled, moved or past) changes nothing.
 */
export async function recordReminderTap(
  tx: Executor,
  input: { contactId: string; conversationId: string; messageId: string; sendId: string; action: ReminderAction; now: Date },
): Promise<ReminderTapOutcome> {
  const none: ReminderTapOutcome = { handled: false, thanks: null };
  const [send] = await tx.select().from(bookingReminderSends).where(eq(bookingReminderSends.id, input.sendId));
  if (!send) return none;
  const [booking] = await tx
    .select({ id: bookings.id, contactId: bookings.contactId, status: bookings.status, startsAt: bookings.startsAt })
    .from(bookings)
    .where(eq(bookings.id, send.bookingId));
  const valid =
    booking &&
    booking.contactId === input.contactId &&
    OCCUPYING_STATUSES.includes(booking.status) &&
    booking.startsAt.getTime() === send.startsAt.getTime() &&
    booking.startsAt > input.now;
  if (!valid) return none;
  const [message] = await tx.select({ metadata: messages.metadata }).from(messages).where(eq(messages.id, input.messageId));
  await tx
    .update(messages)
    .set({ metadata: { ...(message?.metadata ?? {}), reminderReply: { action: input.action, bookingId: booking.id } }, updatedAt: input.now })
    .where(eq(messages.id, input.messageId));
  if (input.action === "change") return none;
  // A pending booking gets the mark too; confirming it is still a person's ([AGD-22]).
  const marked = await tx
    .update(bookings)
    .set({ customerConfirmedAt: input.now, updatedAt: input.now })
    .where(and(eq(bookings.id, booking.id), isNull(bookings.customerConfirmedAt), eq(bookings.startsAt, send.startsAt)))
    .returning({ id: bookings.id });
  if (marked.length === 0) return { handled: true, thanks: null };
  await recordBookingEvent(tx, booking.id, { type: "contact" }, "customer_confirmed", { channel: send.channel }, input.now);
  return { handled: true, thanks: { conversationId: input.conversationId, bookingId: booking.id, startsAt: send.startsAt.toISOString() } };
}

/** Queues the «¡Gracias!» of a «Confirmo», once for each time of the booking. */
export function enqueueReminderThanks(thanks: z.infer<typeof reminderThanksPayload>, options: { now?: Date; queue?: JobQueue } = {}) {
  return (options.queue ?? getJobQueue()).enqueue({
    type: REMINDER_THANKS_JOB,
    payload: thanks,
    runAt: options.now,
    dedupeKey: `reminder_thanks:${thanks.bookingId}:${thanks.startsAt}`,
    maxAttempts: 3,
  });
}

/** Job: «¡Gracias! Te esperamos.» (or the business's text), in the conversation of the tap. */
export async function sendReminderThanks(payload: z.infer<typeof reminderThanksPayload>, deps: { now?: Date } = {}): Promise<void> {
  const config = await loadReminderConfig();
  await sendOutbound({ conversationId: payload.conversationId, sender: { type: "system" }, text: config.thanksText, metadata: { reminderThanks: payload.bookingId }, now: deps.now });
}

/** From a «failed» status of a reminder's message: the next channel goes through the queue. */
export async function enqueueReminderFallback(input: z.infer<typeof reminderFallbackPayload>, options: { queue?: JobQueue } = {}) {
  return (options.queue ?? getJobQueue()).enqueue({
    type: REMINDER_FALLBACK_JOB,
    payload: input,
    dedupeKey: `reminder_fallback:${input.sendId}:${input.messageId}`,
    maxAttempts: 3,
  });
}

/** Job: the reminder whose message Meta could not deliver tries its next channels ([AGD-24]). */
export async function runReminderFallback(payload: z.infer<typeof reminderFallbackPayload>, deps: { now?: Date; mailer?: MailerOptions } = {}): Promise<void> {
  const now = deps.now ?? new Date();
  const [send] = await db.select().from(bookingReminderSends).where(eq(bookingReminderSends.id, payload.sendId));
  if (!send || send.status !== "sent" || send.messageId !== payload.messageId || !send.channel) return;
  const rule = (await loadReminderConfig()).rules.find((candidate) => candidate.id === send.ruleId);
  if (!rule) return;
  const reason = payload.reason ?? "No se pudo entregar";
  const attempts: ReminderAttempt[] = send.attempts.map((attempt) => (attempt.channel === send.channel && attempt.outcome === "sent" ? { ...attempt, outcome: "failed", reason } : attempt));
  await recordBookingEvent(db, send.bookingId, { type: "system" }, "reminder_failed", { ruleId: rule.id, channel: send.channel, reason }, now);
  await deliverReminder(send.id, rule, rule.routes.indexOf(send.channel) + 1, { now, earlier: attempts, mailer: deps.mailer });
}

/** The reminder a message was, for statuses.ts to know a failure needs the fallback. */
export function reminderSendOf(metadata: Record<string, unknown>): string | null {
  return reminderOf(metadata)?.sendId ?? null;
}
