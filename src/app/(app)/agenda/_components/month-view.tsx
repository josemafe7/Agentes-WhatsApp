import Link from "next/link";
import { cn } from "@/lib/utils";
import type { MonthDayData } from "../_lib/calendar-data";
import type { AgendaWords } from "../_lib/labels";
import { CUSTOMER_CONFIRMED, CustomerConfirmedMark, ResourceDot } from "./booking-visuals";

const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

export type MonthDay = MonthDayData & { dayHref: string };

type MonthViewProps = { weeks: MonthDay[][]; hrefs: Record<string, string>; words: AgendaWords };

const percent = (ratio: number) => Math.round(ratio * 100);

/** «martes, 13 de octubre: 5 citas, 70 % ocupado» (or «Cerrado…»), the name of the link that opens the day. */
function dayName(day: MonthDay, words: AgendaWords): string {
  const what = day.closedLabel ?? `${day.count} ${day.count === 1 ? words.booking : words.bookings}`;
  return `${day.label}: ${what}${day.ratio !== null ? `, ${percent(day.ratio)} % ocupado` : ""}`;
}

/**
 * Month view ([AGD-31]): each day says how many bookings it has and how full it is (a bar), and the whole day opens it.
 * On wide screens the first two bookings show under it, each with its card. Closed days and holidays are muted and say
 * «Cerrado» (with their bookings, if any). It fits a phone without scrolling sideways.
 */
export function MonthView({ weeks, hrefs, words }: MonthViewProps) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((weekday) => (
          <div key={weekday} className="border-b px-1.5 py-1.5 text-xs font-medium text-muted-foreground not-first:border-l md:px-2">
            {weekday}
          </div>
        ))}
        {weeks.flat().map((day) => (
          <div
            key={day.date}
            className={cn(
              "relative flex min-h-16 min-w-0 flex-col gap-1 border-b px-0.5 py-1 md:min-h-28 md:p-1.5 [&:not(:nth-child(7n+1))]:border-l",
              !day.inMonth && "text-muted-foreground",
              day.closedLabel && "bg-muted",
            )}
          >
            <Link
              href={day.dayHref}
              aria-label={dayName(day, words)}
              className="absolute inset-0 outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            />
            <div aria-hidden className="pointer-events-none relative flex items-center justify-between gap-1">
              <span
                className={cn(
                  "inline-flex size-6 items-center justify-center rounded-full text-sm tabular-nums md:size-7",
                  day.isToday && "bg-primary font-medium text-primary-foreground",
                )}
              >
                {day.day}
              </span>
              {day.closedLabel ? (
                <span className="hidden truncate text-xs text-muted-foreground md:inline">{day.closedLabel}</span>
              ) : day.count > 0 ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {day.count}
                  <span className="max-md:hidden"> {day.count === 1 ? words.booking : words.bookings}</span>
                </span>
              ) : null}
            </div>
            {day.closedLabel ? (
              <span aria-hidden className="pointer-events-none relative overflow-hidden text-xs tracking-tight whitespace-nowrap text-muted-foreground md:hidden">
                {day.count > 0 ? `Cerrado · ${day.count}` : "Cerrado"}
              </span>
            ) : null}
            {day.ratio !== null && !day.closedLabel ? (
              <div aria-hidden className="pointer-events-none relative h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-muted-foreground" style={{ width: `${percent(day.ratio)}%` }} />
              </div>
            ) : null}
            {day.previews.length ? (
              <ul className="relative hidden gap-0.5 md:grid">
                {day.previews.map((booking) => (
                  <li key={booking.id} className="min-w-0">
                    <Link
                      href={hrefs[booking.id] ?? day.dayHref}
                      scroll={false}
                      title={`${booking.startLocal.slice(11, 16)} · ${booking.contactName ?? `Sin ${words.customer}`} · ${booking.serviceName} · ${booking.resourceName}`}
                      className={cn(
                        "flex min-w-0 items-center gap-1 rounded-sm px-0.5 text-xs text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                        booking.status === "cancelled" && "line-through opacity-50",
                      )}
                    >
                      <ResourceDot color={booking.resourceColor} className="size-2" />
                      <span className="shrink-0 tabular-nums text-muted-foreground">{booking.startLocal.slice(11, 16)}</span>
                      <span className="min-w-0 flex-1 truncate">{booking.contactName ?? booking.serviceName}</span>
                      {booking.customerConfirmed ? (
                        <>
                          <CustomerConfirmedMark />
                          <span className="sr-only">{CUSTOMER_CONFIRMED}</span>
                        </>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
