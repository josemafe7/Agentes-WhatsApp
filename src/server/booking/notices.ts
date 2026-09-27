// What a booking tells people ([AGD-22], [AGD-23]):
// - the team hears about a booking waiting for manual confirmation (a notice, filtered by the channel it came from);
// - the customer hears, through the same conversation, when a person confirms, moves or cancels their booking.
// When the AI books, changes or cancels, its one reply of the turn is the confirmation ([AGD-23], [MOT-10]): the
// tools give it the text, and nothing is sent apart. A notice never goes to a test conversation, a disabled channel,
// a customer who opted out there ([CUM-03]) or a closed WhatsApp window (a person may send a template instead).
import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import type { NotificationEvent } from "@/data/notification-settings";
import { channels, consents, conversations } from "@/db/schema";
import { whatsappWindowState } from "@/lib/meta/window";
import { notify } from "@/server/notifications/notify";
import { sendOutbound } from "@/server/outbound/send";
import { recordBookingEvent } from "./events";
import { bookingDayText, bookingTimeText, bookingWord } from "./format";
import type { AgendaSettingsSnapshot } from "./load";
import { loadAgendaSettings } from "./load";
import type { BookingView } from "./views";

export const BOOKING_PENDING_EVENT: NotificationEvent = "booking_pending";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Tells the team a booking waits for manual confirmation ([AGD-22]); only people who see its channel. */
export async function notifyPendingBooking(view: BookingView, settings: AgendaSettingsSnapshot): Promise<void> {
  const word = bookingWord(settings.terminology);
  await notify({
    event: BOOKING_PENDING_EVENT,
    title: `${capitalize(word)} pendiente de confirmar: ${view.contactName ?? "sin nombre"}`,
    body: `${view.service.name} · ${bookingDayText(view.startsAt, settings.timezone)}, ${bookingTimeText(view.startsAt, settings.timezone)}`,
    link: `/agenda?cita=${view.id}`,
    channelId: view.channel?.id ?? null,
  });
}

export type BookingNoticeKind = "confirmed" | "moved" | "cancelled";

/** The customer's text for each change, with the business's word for a booking. */
export function bookingNoticeText(kind: BookingNoticeKind, view: Pick<BookingView, "service" | "startsAt">, settings: Pick<AgendaSettingsSnapshot, "terminology" | "timezone">): string {
  const word = bookingWord(settings.terminology);
  const when = `el ${bookingDayText(view.startsAt, settings.timezone)} a las ${bookingTimeText(view.startsAt, settings.timezone)}`;
  switch (kind) {
    case "confirmed":
      return `Tu ${word} de ${view.service.name} ${when} está confirmada. ¡Te esperamos!`;
    case "moved":
      return `Hemos cambiado tu ${word} de ${view.service.name}: ahora es ${when}.`;
    case "cancelled":
      return `Tu ${word} de ${view.service.name} ${when} queda cancelada.`;
  }
}

export type BookingNoticeResult =
  | { sent: true; messageId: string }
  | { sent: false; reason: "no_conversation" | "test" | "channel_disabled" | "opted_out" | "window_closed" | "failed" };

async function optedOut(contactId: string, channelId: string): Promise<boolean> {
  const [latest] = await db
    .select({ type: consents.type })
    .from(consents)
    .where(and(eq(consents.contactId, contactId), eq(consents.channelId, channelId), inArray(consents.type, ["opt_out", "opt_in"])))
    .orderBy(desc(consents.createdAt))
    .limit(1);
  return latest?.type === "opt_out";
}

/**
 * Sends the customer, in the booking's conversation, what a person just did with their booking. System code: the
 * data layer calls it after checking the person's permission. Never throws for a notice that cannot go out.
 */
export async function sendBookingNotice(view: BookingView, kind: BookingNoticeKind, options: { now?: Date } = {}): Promise<BookingNoticeResult> {
  if (view.isTest) return { sent: false, reason: "test" };
  if (!view.conversationId) return { sent: false, reason: "no_conversation" };
  const now = options.now ?? new Date();
  const [target] = await db
    .select({
      contactId: conversations.contactId,
      isTest: conversations.isTest,
      lastInboundAt: conversations.lastInboundAt,
      metadata: conversations.metadata,
      channelId: channels.id,
      channelType: channels.type,
      channelStatus: channels.status,
    })
    .from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(eq(conversations.id, view.conversationId));
  if (!target || !target.contactId) return { sent: false, reason: "no_conversation" };
  if (target.isTest) return { sent: false, reason: "test" };
  if (target.channelStatus === "disabled") return { sent: false, reason: "channel_disabled" };
  if (await optedOut(target.contactId, target.channelId)) return { sent: false, reason: "opted_out" };
  if (target.channelType === "whatsapp" && !whatsappWindowState(target.lastInboundAt, now, target.metadata).open) return { sent: false, reason: "window_closed" };
  const settings = await loadAgendaSettings();
  const sent = await sendOutbound({ conversationId: view.conversationId, sender: { type: "system" }, text: bookingNoticeText(kind, view, settings), now });
  if (sent.status === "failed") return { sent: false, reason: "failed" };
  await recordBookingEvent(db, view.id, { type: "system" }, "notice_sent", { kind, messageId: sent.messageId }, now);
  return { sent: true, messageId: sent.messageId };
}
