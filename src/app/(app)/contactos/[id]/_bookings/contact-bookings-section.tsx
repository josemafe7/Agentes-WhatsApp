// «Citas» of the contact's card ([CTO-02]): the upcoming ones and the past or cancelled ones, each opening its card
// in the agenda ([AGD-19]), and «Nueva cita» with the contact already chosen for whoever may book ([PER-01]). Server
// component: only what src/data returned for this person reaches the page ([SEG-04], [PER-02]).
import { CalendarDays, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { Actor } from "@/lib/permissions";
import { BookingList } from "./booking-list";
import { loadContactBookings } from "./load";
import { NewBookingDialog } from "./new-booking-dialog";

/** Past bookings shown before «Ver N más». */
const PAST_SHOWN = 5;

type ContactBookingsSectionProps = { actor: Actor; contactId: string; contactName: string };

function Subheading({ children }: { children: string }) {
  return <h3 className="text-xs font-medium text-muted-foreground">{children}</h3>;
}

export async function ContactBookingsSection({ actor, contactId, contactName }: ContactBookingsSectionProps) {
  const now = new Date();
  const data = await loadContactBookings(actor, contactId, now);
  if (!data) return null;
  const { words, timezone, upcoming, past } = data;
  const [recent, older] = [past.slice(0, PAST_SHOWN), past.slice(PAST_SHOWN)];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          <h2>{words.title}</h2>
        </CardTitle>
        {data.canBook ? (
          <CardAction>
            <NewBookingDialog target={{ contactId }} contactName={contactName} label={words.newBooking} />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        {upcoming.length === 0 && past.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays aria-hidden className="size-4 shrink-0" />
            {words.none}
          </p>
        ) : (
          <>
            <div className="grid gap-1">
              <Subheading>Próximas</Subheading>
              {upcoming.length > 0 ? <BookingList bookings={upcoming} timezone={timezone} now={now} /> : <p className="text-sm text-muted-foreground">Ninguna por ahora.</p>}
            </div>
            {past.length > 0 ? (
              <div className="grid gap-1">
                <Subheading>Pasadas y canceladas</Subheading>
                <BookingList bookings={recent} timezone={timezone} now={now} />
                {older.length > 0 ? (
                  <Collapsible>
                    <CollapsibleContent>
                      <BookingList bookings={older} timezone={timezone} now={now} />
                    </CollapsibleContent>
                    <CollapsibleTrigger asChild>
                      <Button type="button" variant="ghost" size="sm">
                        <ChevronDown aria-hidden className="transition-transform group-data-[state=open]/button:rotate-180 motion-reduce:transition-none" />
                        <span className="group-data-[state=open]/button:hidden">Ver {older.length} más</span>
                        <span className="hidden group-data-[state=open]/button:inline">Ver menos</span>
                      </Button>
                    </CollapsibleTrigger>
                  </Collapsible>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
