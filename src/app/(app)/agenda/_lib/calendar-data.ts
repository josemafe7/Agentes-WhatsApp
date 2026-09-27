// Turns what src/data returns into what the Agenda's client components draw ([AGD-16], [AGD-28]): the columns of the
// time grid (days, or resources on a day), where each booking and time off goes, the month grid and the booking's
// card. Server side (the page); times stay business-local strings.
import type { ResourceItem } from "@/data/agenda-config";
import { timeToMinutes } from "@/data/business-hours";
import type { BookingDetail, BookingView } from "@/data/bookings";
import type { TimeOffItem } from "@/data/bookings-time-off";
import type { AgendaMode } from "@/lib/enums";
import { formatDateTime } from "@/lib/format";
import { addDays, weekdayOf } from "@/server/booking/time";
import { closureOf, dayHeading, intersectRanges, monthWeeks, openRanges, type DayRange } from "./calendar";
import { dayMinutes, localDateOf, type MinuteRange } from "./grid";
import { historyLines } from "./history";
import type { AgendaWords } from "./labels";
import type { CalendarBooking, CalendarTimeOff, GridColumn, Placement } from "./types";

export type AgendaFrame = {
  hours: { weekday: number; startMin: number; endMin: number }[];
  closures: { startDate: string; endDate: string; reason: string | null }[];
};

const MINUTE_MS = 60_000;

export function toCalendarBooking(view: BookingView): CalendarBooking {
  return {
    id: view.id,
    status: view.status,
    source: view.source,
    isTest: view.isTest,
    startLocal: view.startLocal,
    endLocal: view.endLocal,
    durationMin: Math.round((view.endsAt.getTime() - view.startsAt.getTime()) / MINUTE_MS),
    people: view.people,
    serviceName: view.service.name,
    resourceId: view.resource.id,
    resourceName: view.resource.name,
    resourceColor: view.resource.color,
    contactName: view.contactName,
    channel: view.channel ? { name: view.channel.name, type: view.channel.type } : null,
  };
}

export function toCalendarTimeOff(item: TimeOffItem): CalendarTimeOff {
  return { id: item.id, kind: item.kind, resourceId: item.resource.id, resourceName: item.resource.name, startLocal: item.startLocal, endLocal: item.endLocal, reason: item.reason };
}

/** «lun 28 sep, 10:00 – 12:00» (or both days when it spans more than one). */
export function timeOffWhen(item: TimeOffItem, timezone: string): string {
  const start = formatDateTime(item.startsAt, timezone, { pattern: "EEE d MMM, HH:mm" });
  const sameDay = localDateOf(item.startLocal) === localDateOf(item.endLocal);
  return `${start} – ${formatDateTime(item.endsAt, timezone, { pattern: sameDay ? "HH:mm" : "EEE d MMM, HH:mm" })}`;
}

function closedLabel(date: string, frame: AgendaFrame, open: MinuteRange[]): string | null {
  const closure = closureOf(date, frame.closures);
  if (closure) return closure.reason ? `Cerrado · ${closure.reason}` : "Cerrado";
  return open.length === 0 ? "Cerrado" : null;
}

/** One column per day (day and week views). */
export function dayColumns(range: DayRange, frame: AgendaFrame, today: string): GridColumn[] {
  const columns: GridColumn[] = [];
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    const open = openRanges(date, frame.hours, frame.closures);
    const heading = dayHeading(date);
    columns.push({
      key: date,
      date,
      resourceId: null,
      title: `${heading.weekday} ${heading.day}`,
      subtitle: null,
      ariaLabel: heading.long,
      open,
      closedLabel: closedLabel(date, frame, open),
      isToday: date === today,
      resourceColor: null,
      capacity: null,
    });
  }
  return columns;
}

/** The resource's hours of that weekday, "HH:MM" → minutes ("00:00" as an end is midnight). */
function scheduleOf(resource: ResourceItem, date: string): MinuteRange[] {
  const weekday = weekdayOf(date);
  return resource.schedule
    .filter((range) => range.weekday === weekday)
    .map((range) => ({ startMin: timeToMinutes(range.start) ?? 0, endMin: timeToMinutes(range.end, { end: true }) ?? 0 }))
    .filter((range) => range.endMin > range.startMin);
}

/**
 * Resources shown as columns: the ones filtered, or every active one plus inactive ones that still have bookings on
 * the day (an inactive resource keeps its bookings, [AGD-03]).
 */
export function visibleResources(resources: ResourceItem[], filtered: readonly string[], bookings: readonly CalendarBooking[]): ResourceItem[] {
  if (filtered.length) return resources.filter((resource) => filtered.includes(resource.id));
  const withBookings = new Set(bookings.map((booking) => booking.resourceId));
  return resources.filter((resource) => resource.active || withBookings.has(resource.id));
}

/** One column per resource on one day (resources view), open where the business and the resource both are. */
export function resourceColumns(date: string, resources: ResourceItem[], frame: AgendaFrame, today: string, mode: AgendaMode): GridColumn[] {
  const business = openRanges(date, frame.hours, frame.closures);
  return resources.map((resource) => {
    const open = intersectRanges(business, scheduleOf(resource, date));
    return {
      key: resource.id,
      date,
      resourceId: resource.id,
      title: resource.name,
      subtitle: !resource.active ? "Inactivo" : mode === "capacity" ? `Aforo ${resource.capacity}` : null,
      ariaLabel: resource.name,
      open,
      closedLabel: closedLabel(date, frame, business) ?? (open.length === 0 ? "No trabaja este día" : null),
      isToday: date === today,
      resourceColor: resource.color,
      capacity: mode === "capacity" ? resource.capacity : null,
    };
  });
}

/** Where each item goes: the column of its day (or of its resource on that day), in minutes of that day. */
export function placeItems(columns: GridColumn[], items: readonly { id: string; resourceId: string; startLocal: string; endLocal: string }[]): Placement[] {
  const placements: Placement[] = [];
  for (const column of columns) {
    for (const item of items) {
      if (column.resourceId && item.resourceId !== column.resourceId) continue;
      const range = dayMinutes(item.startLocal, item.endLocal, column.date);
      if (!range) continue;
      placements.push({
        key: `${item.id}:${column.key}`,
        columnKey: column.key,
        id: item.id,
        ...range,
        startsHere: localDateOf(item.startLocal) === column.date,
        endsHere: localDateOf(item.endLocal) === column.date,
      });
    }
  }
  return placements;
}

export type MonthDayData = {
  date: string;
  day: string;
  label: string;
  inMonth: boolean;
  isToday: boolean;
  closedLabel: string | null;
  bookings: CalendarBooking[];
};

/** Weeks of the month with each day's bookings (by start) and whether it is closed. */
export function monthDays(date: string, bookings: readonly CalendarBooking[], frame: AgendaFrame, today: string): MonthDayData[][] {
  return monthWeeks(date).map((week) =>
    week.map((cell) => {
      const open = openRanges(cell.date, frame.hours, frame.closures);
      const heading = dayHeading(cell.date);
      return {
        date: cell.date,
        day: heading.day,
        label: heading.long,
        inMonth: cell.inMonth,
        isToday: cell.date === today,
        closedLabel: closedLabel(cell.date, frame, open),
        bookings: bookings.filter((booking) => localDateOf(booking.startLocal) === cell.date),
      };
    }),
  );
}

export type PanelContext = {
  timezone: string;
  words: AgendaWords;
  resourceNames: ReadonlyMap<string, string>;
  contactHref: string | null;
  conversationHref: string | null;
};

/**
 * «Enviado el …», or that the reminder could not go out and why: it is taken once and never retried ([AGD-25]), so
 * `reminderSentAt` is set either way and only the history tells them apart.
 */
function reminderText(detail: BookingDetail, timezone: string): string | null {
  if (!detail.reminderSentAt) return null;
  const when = formatDateTime(detail.reminderSentAt, timezone);
  const last = detail.history.findLast((item) => item.action === "reminder_sent" || item.action === "reminder_failed");
  if (last?.action !== "reminder_failed") return `Enviado el ${when}`;
  const reason = typeof last.changes.reason === "string" ? last.changes.reason : null;
  return `No se ha podido enviar (${when})${reason ? `: ${reason}` : ""}`;
}

/** The booking's card: when, origin, author, reminder, history and what «Cambiar» starts from. */
export function panelBooking(detail: BookingDetail, context: PanelContext) {
  const { timezone } = context;
  const booking = toCalendarBooking(detail);
  const day = formatDateTime(detail.startsAt, timezone, { pattern: "EEEE d 'de' MMMM" });
  const origin =
    detail.source === "ai"
      ? `IA${detail.channel ? ` · ${detail.channel.name}` : ""}`
      : detail.source === "web"
        ? "Web"
        : `Persona${detail.createdByName ? ` · ${detail.createdByName}` : ""}`;
  return {
    ...booking,
    whenText: `${day} · ${detail.startLocal.slice(11, 16)}–${detail.endLocal.slice(11, 16)}`,
    notes: detail.notes,
    createdByName: detail.createdByName,
    createdText: `${formatDateTime(detail.createdAt, timezone)}${detail.createdByName ? ` · ${detail.createdByName}` : ""}`,
    cancelReason: detail.cancelReason,
    reminderText: reminderText(detail, timezone),
    originText: origin,
    contactHref: context.contactHref,
    conversationHref: context.conversationHref,
    history: historyLines(detail.history, { timezone, resourceNames: context.resourceNames, words: context.words }),
    editable: {
      id: detail.id,
      serviceId: detail.service.id,
      serviceName: detail.service.name,
      resourceId: detail.resource.id,
      startLocal: detail.startLocal,
      durationMin: booking.durationMin,
      people: detail.people,
      notes: detail.notes,
      contactId: detail.contactId,
      contactName: detail.contactName,
      canNotify: !detail.isTest && detail.conversationId !== null,
    },
  };
}
