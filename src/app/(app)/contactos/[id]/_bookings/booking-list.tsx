// A contact's bookings as a list ([CTO-02], [AGD-14]): day and time in the business's time zone ([AGD-28]), service
// and resource with its colour, the state and the origin of DESIGN.md; each one opens its card in the agenda
// ([AGD-19]). No hooks: the contact's card and the conversation's side panel render it on the server.
import Link from "next/link";
import type { BookingView } from "@/data/bookings";
import { RESOURCE_COLOR_CLASSES } from "@/lib/booking-display";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { agendaBookingHref, BOOKING_SOURCE_VIEW, BOOKING_STATUS_VIEW } from "./presentation";

export type BookingListItem = Pick<BookingView, "id" | "status" | "source" | "startsAt" | "people" | "service" | "resource" | "channel">;

type BookingListProps = { bookings: BookingListItem[]; timezone: string; now: Date };

function dayText(startsAt: Date, timezone: string, now: Date): string {
  const sameYear = formatDateTime(startsAt, timezone, { pattern: "yyyy" }) === formatDateTime(now, timezone, { pattern: "yyyy" });
  return formatDateTime(startsAt, timezone, { pattern: sameYear ? "EEE d MMM" : "EEE d MMM yyyy" });
}

export function BookingStatusBadge({ status }: { status: BookingListItem["status"] }) {
  const { label, icon: Icon, className } = BOOKING_STATUS_VIEW[status];
  return (
    <span className={cn("inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium", className)}>
      <Icon aria-hidden className="size-3" />
      {label}
    </span>
  );
}

export function BookingList({ bookings, timezone, now }: BookingListProps) {
  return (
    <ul className="-mx-2 grid">
      {bookings.map((booking) => {
        const source = BOOKING_SOURCE_VIEW[booking.source];
        const SourceIcon = source.icon;
        const origin = booking.source === "ai" && booking.channel ? `${source.label} · ${booking.channel.name}` : source.label;
        const details = [booking.service.name, booking.resource.name, booking.people > 1 ? `${booking.people} personas` : null].filter(Boolean).join(" · ");
        return (
          <li key={booking.id}>
            <Link
              href={agendaBookingHref(booking.id)}
              className="flex min-h-10 items-stretch gap-2.5 rounded-lg px-2 py-2 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-12"
            >
              <span aria-hidden className={cn("w-[3px] shrink-0 rounded-full", RESOURCE_COLOR_CLASSES[booking.resource.color])} />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex items-start justify-between gap-2">
                  <span className="font-medium tabular-nums first-letter:uppercase">
                    <time dateTime={booking.startsAt.toISOString()}>
                      {dayText(booking.startsAt, timezone, now)} · {formatDateTime(booking.startsAt, timezone, { preset: "time" })}
                    </time>
                  </span>
                  <BookingStatusBadge status={booking.status} />
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate" title={details}>
                    {details}
                  </span>
                  <SourceIcon aria-hidden className={cn("size-3.5 shrink-0", source.className)} />
                  <span className="sr-only">{origin}</span>
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
