// Booking reminders ([AGD-24], [AGD-25]): off by default. When on, a recurring job looks every minute for the reminders
// that are due (up to three per booking, src/server/booking/reminder-config.ts) and sends each one through the first of
// its channels, in order, that the customer can receive (src/server/booking/reminder-channels.ts); if a channel refuses
// it, through the next one, while the booking has not started. One that went out by a channel never goes by another.
// - Once for each time of the booking: a row of booking_reminder_sends (booking, reminder, time) is the claim, taken
//   before anything is sent, so two rounds at once never send it twice; a booking moved to another time gets its
//   reminders again for the new time, and those whose new moment had already passed do not go.
// - Never for cancelled, completed, no-show or test bookings; not one whose moment had passed when the booking was made
//   or moved (the customer just got the confirmation); one missed while the app was stopped goes on its return only
//   while the next reminder of that booking is not due yet and the booking is more than 15 minutes away.
// - What does not go out stays in the booking's history with why, in a few words ([AGD-25]).
// A failure Meta reports later ([AGD-24]) continues with the next channel through reminder-fallback.ts.
import "server-only";
import { and, asc, eq, gt, inArray, isNotNull, lte } from "drizzle-orm";
import { loadBusinessSettings } from "@/data/settings";
import { db } from "@/db";
import { bookingReminderSends, bookings, contacts } from "@/db/schema";
import type { ReminderAttempt, ReminderRule } from "@/lib/reminder-rules";
import { leadLabel, ROUTE_LABELS } from "@/lib/reminder-rules";
import { getSectorPreset } from "@/lib/sectors";
import { getJobQueue, type JobQueue } from "@/server/adapters/job-queue";
import type { MailerOptions } from "@/server/mailer";
import { safeErrorMessage } from "@/server/redact";
import { OCCUPYING_STATUSES } from "./availability";
import { type BookingActor, recordBookingEvent } from "./events";
import { bookingDayText, bookingTimeText } from "./format";
import { type AgendaSettingsSnapshot, loadAgendaSettings } from "./load";
import { tryRoute, type ReminderContext } from "./reminder-channels";
import { loadReminderConfig, longestLeadMs, reminderDueAt } from "./reminder-config";
import type { ReminderValues } from "./reminder-fields";
import { MINUTE_MS } from "./time";
import { type BookingView, selectBookingView } from "./views";

export const BOOKING_REMINDERS_JOB = "booking.reminders";
export const BOOKING_REMINDERS_KEY = "booking.reminders";
/** How often due reminders are looked for: every minute, so «15 minutos antes» is never late. */
export const REMINDERS_INTERVAL_MS = 60_000;
/** Later than this after its moment, a reminder is one the app missed while it was stopped. */
export const LATE_AFTER_MS = 10 * MINUTE_MS;
/** A missed reminder still goes only while the booking is further away than this ([AGD-25]). */
const MISSED_MIN_AHEAD_MS = 15 * MINUTE_MS;
/** Reminders sent in one round at most; the rest wait for the next round. */
const MAX_PER_ROUND = 50;
const SYSTEM: BookingActor = { type: "system" };

/** Keeps the recurring job alive while reminders are on (idempotent), or removes the pending one when they go off. */
export async function syncBookingReminderJob(enabled: boolean, options: { queue?: JobQueue; now?: Date } = {}): Promise<void> {
  const queue = options.queue ?? getJobQueue();
  if (enabled) {
    await queue.ensureRecurring({ type: BOOKING_REMINDERS_JOB, key: BOOKING_REMINDERS_KEY, intervalMs: REMINDERS_INTERVAL_MS, firstRunAt: options.now });
  } else {
    await queue.cancel({ dedupeKey: `recurring:${BOOKING_REMINDERS_KEY}` });
  }
}

export type ReminderRoundResult = { sent: number; failed: number; notSent: number };

type Candidate = { id: string; startsAt: Date; createdAt: Date; startsAtSetAt: Date | null; reminderSentAt: Date | null };

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

/** «Sin permiso de avisos y sin email»: the reasons once each, the first one capitalised. */
export function joinReasons(reasons: readonly string[]): string {
  const unique = [...new Set(reasons)];
  const words = unique.map((reason, index) => (index === 0 ? reason : reason.charAt(0).toLowerCase() + reason.slice(1)));
  return words.length <= 1 ? (words[0] ?? "Ningún canal disponible") : `${words.slice(0, -1).join(", ")} y ${words[words.length - 1]}`;
}

/** Why a due reminder does not go, or null when it goes now ([AGD-25]). */
export function notGoingReason(
  rule: ReminderRule,
  booking: Candidate,
  all: readonly ReminderRule[],
  timeZone: string,
  now: Date,
): { kind: "wait" } | { kind: "skip" } | { kind: "not_sent"; reason: string } | null {
  const due = reminderDueAt(rule.lead, booking.startsAt, timeZone);
  if (due > now) return { kind: "wait" };
  // The single reminder of before phase 12 already went for this time: what was due by then is covered.
  if (booking.reminderSentAt && (!booking.startsAtSetAt || booking.startsAtSetAt <= booking.reminderSentAt) && due <= booking.reminderSentAt) return { kind: "skip" };
  const setAt = booking.startsAtSetAt ?? booking.createdAt;
  if (due < setAt) return { kind: "not_sent", reason: booking.startsAtSetAt ? "Cambió de hora después de su momento" : "Se reservó después de su momento" };
  if (now.getTime() - due.getTime() > LATE_AFTER_MS) {
    const nextDue = all
      .map((other) => reminderDueAt(other.lead, booking.startsAt, timeZone))
      .filter((other) => other > due)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const nextAlreadyDue = nextDue !== undefined && nextDue <= now;
    if (nextAlreadyDue || booking.startsAt.getTime() - now.getTime() <= MISSED_MIN_AHEAD_MS) return { kind: "not_sent", reason: "La app no estaba en marcha a su hora" };
  }
  return null;
}

/** Takes the reminder of this booking time for this round; null when another round already did. */
async function claim(booking: Candidate, rule: ReminderRule, dueAt: Date, status: "sending" | "not_sent", reason: string | null, now: Date): Promise<string | null> {
  const [row] = await db
    .insert(bookingReminderSends)
    .values({ bookingId: booking.id, ruleId: rule.id, startsAt: booking.startsAt, dueAt, status, reason, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: [bookingReminderSends.bookingId, bookingReminderSends.ruleId, bookingReminderSends.startsAt] })
    .returning({ id: bookingReminderSends.id });
  return row?.id ?? null;
}

const at = (now: Date) => now.toISOString();

/**
 * Tries the reminder's channels from `from` on, in order; records each attempt and the outcome on its row and in the
 * booking's history. Shared by the round and by the fallback after a failure Meta reports later.
 */
export async function deliverReminder(
  sendId: string,
  rule: ReminderRule,
  from: number,
  options: { now: Date; mailer?: MailerOptions; earlier?: ReminderAttempt[] },
): Promise<"sent" | "failed" | "not_sent" | "gone"> {
  const { now } = options;
  const [row] = await db.select().from(bookingReminderSends).where(eq(bookingReminderSends.id, sendId));
  if (!row) return "gone";
  const agenda = await loadAgendaSettings();
  const view = await selectBookingView(row.bookingId, agenda.timezone);
  // Cancelled, moved or started since: nothing more goes for this time ([AGD-24]).
  if (!view?.contactId || !OCCUPYING_STATUSES.includes(view.status) || view.startsAt.getTime() !== row.startsAt.getTime() || view.startsAt <= now) {
    await db.update(bookingReminderSends).set({ status: "not_sent", reason: "La cita ya no está pendiente", updatedAt: now }).where(eq(bookingReminderSends.id, sendId));
    return "gone";
  }
  const [contact] = await db.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, view.contactId));
  const business = await loadBusinessSettings();
  const ctx: ReminderContext = {
    sendId,
    rule,
    view: { ...view, contactId: view.contactId },
    values: valuesOf(view, contact?.name ?? null, agenda),
    agenda,
    healthData: business.sector ? getSectorPreset(business.sector).healthData : false,
    now,
    mailer: options.mailer ?? {},
  };
  const attempts: ReminderAttempt[] = [...(options.earlier ?? row.attempts)];
  for (const route of rule.routes.slice(from)) {
    const result = await tryRoute(route, ctx);
    if (result.outcome === "sent") {
      attempts.push({ channel: route, outcome: "sent", at: at(now) });
      await db
        .update(bookingReminderSends)
        .set({ status: "sent", channel: route, messageId: result.messageId, attempts, reason: null, sentAt: now, updatedAt: now })
        .where(eq(bookingReminderSends.id, sendId));
      await recordBookingEvent(db, row.bookingId, SYSTEM, "reminder_sent", { ruleId: rule.id, lead: leadLabel(rule.lead), channel: route, via: result.via }, now);
      return "sent";
    }
    attempts.push({ channel: route, outcome: result.outcome, reason: result.reason, at: at(now) });
    if (result.outcome === "failed") {
      await recordBookingEvent(db, row.bookingId, SYSTEM, "reminder_failed", { ruleId: rule.id, channel: route, reason: result.reason }, now);
    }
  }
  const reasons = attempts.filter((attempt) => attempt.outcome !== "sent").map((attempt) => attempt.reason ?? `${ROUTE_LABELS[attempt.channel]} no disponible`);
  const failed = attempts.some((attempt) => attempt.outcome === "failed");
  const reason = joinReasons(reasons);
  await db
    .update(bookingReminderSends)
    .set({ status: failed ? "failed" : "not_sent", attempts, reason, updatedAt: now })
    .where(eq(bookingReminderSends.id, sendId));
  await recordBookingEvent(db, row.bookingId, SYSTEM, "reminder_not_sent", { ruleId: rule.id, lead: leadLabel(rule.lead), reason }, now);
  return failed ? "failed" : "not_sent";
}

/** One round: the reminders that are due. Never throws for one booking; each outcome goes to its history. */
export async function runBookingReminders(options: { now?: Date; mailer?: MailerOptions } = {}): Promise<ReminderRoundResult> {
  const now = options.now ?? new Date();
  const result: ReminderRoundResult = { sent: 0, failed: 0, notSent: 0 };
  const config = await loadReminderConfig();
  if (!config.enabled || config.rules.length === 0) return result;
  const agenda = await loadAgendaSettings();
  const windowEnd = new Date(now.getTime() + longestLeadMs(config.rules));
  // Every booking of the window: a cap here would leave the latest ones out until the earlier ones pass, and their
  // reminders would go late or not at all. What a round does is capped below (MAX_PER_ROUND).
  const candidates: Candidate[] = await db
    .select({ id: bookings.id, startsAt: bookings.startsAt, createdAt: bookings.createdAt, startsAtSetAt: bookings.startsAtSetAt, reminderSentAt: bookings.reminderSentAt })
    .from(bookings)
    .where(and(inArray(bookings.status, [...OCCUPYING_STATUSES]), eq(bookings.isTest, false), isNotNull(bookings.contactId), gt(bookings.startsAt, now), lte(bookings.startsAt, windowEnd)))
    .orderBy(asc(bookings.startsAt));
  if (candidates.length === 0) return result;
  // The reminders already taken for the times of the window (a send keeps the time of the booking it was for).
  const taken = new Set(
    (
      await db
        .select({ bookingId: bookingReminderSends.bookingId, ruleId: bookingReminderSends.ruleId, startsAt: bookingReminderSends.startsAt })
        .from(bookingReminderSends)
        .where(and(gt(bookingReminderSends.startsAt, now), lte(bookingReminderSends.startsAt, windowEnd)))
    ).map((row) => `${row.bookingId}:${row.ruleId}:${row.startsAt.getTime()}`),
  );
  let handled = 0;
  for (const booking of candidates) {
    for (const rule of config.rules) {
      if (handled >= MAX_PER_ROUND) return result;
      if (taken.has(`${booking.id}:${rule.id}:${booking.startsAt.getTime()}`)) continue;
      const decision = notGoingReason(rule, booking, config.rules, agenda.timezone, now);
      if (decision?.kind === "wait" || decision?.kind === "skip") continue;
      const dueAt = reminderDueAt(rule.lead, booking.startsAt, agenda.timezone);
      handled += 1;
      if (decision?.kind === "not_sent") {
        if (await claim(booking, rule, dueAt, "not_sent", decision.reason, now)) {
          result.notSent += 1;
          await recordBookingEvent(db, booking.id, SYSTEM, "reminder_not_sent", { ruleId: rule.id, lead: leadLabel(rule.lead), reason: decision.reason }, now);
        }
        continue;
      }
      const sendId = await claim(booking, rule, dueAt, "sending", null, now);
      if (!sendId) continue;
      try {
        const outcome = await deliverReminder(sendId, rule, 0, { now, mailer: options.mailer, earlier: [] });
        if (outcome === "sent") result.sent += 1;
        else if (outcome === "failed") result.failed += 1;
        else result.notSent += 1;
      } catch (error) {
        console.error(`[agenda] Recordatorio fallido: ${safeErrorMessage(error)}`);
        result.failed += 1;
        await db.update(bookingReminderSends).set({ status: "failed", reason: "Error inesperado", updatedAt: now }).where(eq(bookingReminderSends.id, sendId));
      }
    }
  }
  return result;
}
