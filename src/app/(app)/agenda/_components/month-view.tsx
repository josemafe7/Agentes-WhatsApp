import Link from "next/link";
import { cn } from "@/lib/utils";
import type { AgendaWords } from "../_lib/labels";
import type { CalendarBooking } from "../_lib/types";
import { bookingBlockStyle, bookingStatusClass, SourceIcon } from "./booking-visuals";

/** Bookings shown per day before «+N más» (DESIGN.md «Mes»). */
const SHOWN_PER_DAY = 3;
const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

export type MonthDay = {
  date: string;
  day: string;
  label: string;
  inMonth: boolean;
  isToday: boolean;
  /** «Cerrado» or the holiday's reason. */
  closedLabel: string | null;
  dayHref: string;
  bookings: CalendarBooking[];
};

type MonthViewProps = { weeks: MonthDay[][]; hrefs: Record<string, string>; words: AgendaWords };

/** Month view ([AGD-16]): up to three bookings a day and «+N más», which opens the day. */
export function MonthView({ weeks, hrefs, words }: MonthViewProps) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div className="grid min-w-[42rem] grid-cols-7">
        {WEEKDAYS.map((weekday) => (
          <div key={weekday} className="border-b px-2 py-1.5 text-xs font-medium text-muted-foreground not-first:border-l">
            {weekday}
          </div>
        ))}
        {weeks.flat().map((day) => {
          const extra = day.bookings.length - SHOWN_PER_DAY;
          return (
            <div
              key={day.date}
              className={cn(
                "flex min-h-28 min-w-0 flex-col gap-1 border-b p-1.5 [&:not(:nth-child(7n+1))]:border-l",
                !day.inMonth && "bg-muted/40 text-muted-foreground",
                day.closedLabel && "bg-muted",
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <Link
                  href={day.dayHref}
                  aria-label={day.label}
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-full text-sm tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                    day.isToday && "bg-primary font-medium text-primary-foreground hover:bg-primary",
                  )}
                >
                  {day.day}
                </Link>
                {day.closedLabel ? <span className="truncate text-xs text-muted-foreground">{day.closedLabel}</span> : null}
              </div>
              <ul className="grid gap-1">
                {day.bookings.slice(0, SHOWN_PER_DAY).map((booking) => (
                  <li key={booking.id} className="min-w-0">
                    <Link
                      href={hrefs[booking.id] ?? day.dayHref}
                      scroll={false}
                      className={cn(
                        "flex min-w-0 items-center gap-1 rounded-sm border border-l-[3px] px-1 py-0.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        bookingStatusClass(booking.status),
                      )}
                      style={bookingBlockStyle(booking.resourceColor, booking.status)}
                      title={`${booking.startLocal.slice(11, 16)} · ${booking.contactName ?? `Sin ${words.customer}`} · ${booking.serviceName} · ${booking.resourceName}`}
                    >
                      <span className="tabular-nums">{booking.startLocal.slice(11, 16)}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{booking.contactName ?? booking.serviceName}</span>
                      <SourceIcon source={booking.source} className="size-3" />
                    </Link>
                  </li>
                ))}
              </ul>
              {extra > 0 ? (
                <Link href={day.dayHref} className="rounded-sm px-1 text-xs font-medium text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                  +{extra} más
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
