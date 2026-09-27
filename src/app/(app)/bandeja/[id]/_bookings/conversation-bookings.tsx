// The contact's next bookings in the conversation's side panel ([BAN-15], [CTO-02]) and «Nueva cita» linked to this
// conversation: the booking keeps the conversation, its channel and its contact, created by a person ([AGD-14],
// [AGD-19]). Server component: only what src/data returned for this person reaches the page ([SEG-04], [PER-02]).
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { BookingList } from "@/app/(app)/contactos/[id]/_bookings/booking-list";
import { NewBookingDialog } from "@/app/(app)/contactos/[id]/_bookings/new-booking-dialog";
import type { Actor } from "@/lib/permissions";
import { contactDisplayName } from "../../_lib/presentation";
import { loadConversationBookings } from "./load";

type ConversationBookingsProps = {
  actor: Actor;
  conversationId: string;
  channelId: string;
  contact: { id: string; name: string | null } | null;
  /** Link to the contact's card, where every booking is. */
  canOpenContact: boolean;
};

export async function ConversationBookings({ actor, conversationId, channelId, contact, canOpenContact }: ConversationBookingsProps) {
  const now = new Date();
  const data = contact ? await loadConversationBookings(actor, { conversationId, channelId, contactId: contact.id }, now) : null;
  if (!data || !contact) return null;
  const { words, upcoming, moreUpcoming } = data;

  return (
    <section className="flex flex-col gap-2 border-b px-4 py-4 last:border-b-0">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Próximas {words.title.toLocaleLowerCase("es-ES")}</h3>
        {data.canBook ? <NewBookingDialog target={{ conversationId }} contactName={contactDisplayName(contact.name)} label={words.newBooking} /> : null}
      </div>
      {upcoming.length > 0 ? <BookingList bookings={upcoming} timezone={data.timezone} now={now} /> : <p className="text-sm text-muted-foreground">Ninguna por ahora.</p>}
      {moreUpcoming > 0 && canOpenContact ? (
        <Link href={`/contactos/${contact.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary-text hover:underline">
          Ver {moreUpcoming} más en su ficha
          <ExternalLink aria-hidden className="size-3.5" />
        </Link>
      ) : null}
    </section>
  );
}
