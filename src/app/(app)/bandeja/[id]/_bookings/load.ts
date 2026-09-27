// The contact's next bookings next to the conversation ([BAN-15], [CTO-02]), read with the same checks as the contact's
// card; «Nueva cita» here books for the conversation's contact and links the conversation ([AGD-19]).
import "server-only";
import { loadContactBookings } from "@/app/(app)/contactos/[id]/_bookings/load";
import type { BookingWords } from "@/app/(app)/contactos/[id]/_bookings/presentation";
import type { BookingView } from "@/data/bookings";
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";

/** How many next bookings fit in the side panel; the rest are on the contact's card. */
export const PANEL_BOOKINGS = 3;

export type ConversationBookings = {
  conversationId: string;
  contactId: string;
  timezone: string;
  words: BookingWords;
  upcoming: BookingView[];
  /** Upcoming bookings not shown here. */
  moreUpcoming: number;
  canBook: boolean;
};

type ConversationRef = { conversationId: string; channelId: string; contactId: string | null };

export async function loadConversationBookings(actor: Actor, conversation: ConversationRef, now: Date = new Date()): Promise<ConversationBookings | null> {
  if (!conversation.contactId || !can(actor, PERMISSIONS.inbox.view, { channelId: conversation.channelId })) return null;
  const card = await loadContactBookings(actor, conversation.contactId, now);
  if (!card) return null;
  return {
    conversationId: conversation.conversationId,
    contactId: conversation.contactId,
    timezone: card.timezone,
    words: card.words,
    upcoming: card.upcoming.slice(0, PANEL_BOOKINGS),
    moreUpcoming: Math.max(0, card.upcoming.length - PANEL_BOOKINGS),
    canBook: card.canBook,
  };
}
