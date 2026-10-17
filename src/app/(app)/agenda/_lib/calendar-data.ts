// Turns what src/data returns into what the Agenda's client components draw ([AGD-16], [AGD-28]–[AGD-31]): the
// columns of the time grid (days, or resources on a day), where each booking and time off goes, the open time in which
// nobody is free, the month grid with how many bookings each day has and how full it is, and the booking's card.
// Server side (the page); times stay business-local strings.
import type { ResourceItem } from "@/data/agenda-config";
import { timeToMinutes } from "@/data/business-hours";
import type { BookingDetail, BookingView } from "@/data/bookings";
import type { TimeOffItem } from "@/data/bookings-time-off";
import type { AgendaMode } from "@/lib/enums";
import { formatDateTime } from "@/lib/format";
import { addDays, weekdayOf } from "@/server/booking/time";
import { closureOf, dayHeading, intersectRanges, mergeRanges, monthWeeks, openRanges, rangesMinutes, subtractRanges, type DayRange } from "./calendar";
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
    customerConfirmed: view.customerConfirmedAt !== null,
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
      busy: [],
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

/**
 * [AGD-29] Professionals whose free time the day and the week count: the ones filtered or, without a filter, every
 * active one.
 */
export function workingResources(resources: ResourceItem[], filtered: readonly string[]): ResourceItem[] {
  return resources.filter((resource) => (filtered.length ? filtered.includes(resource.id) : resource.active));
}

/**
 * [AGD-29] Time off drawn on the grid: all of it by resource or when filtering by professional. In the day and the
 * week without that filter, only blocks: one professional's absence is not drawn across the whole day, it shows as
 * time nobody else has free.
 */
export function drawnTimeOff(timeOff: readonly CalendarTimeOff[], byResource: boolean, filtered: readonly string[]): CalendarTimeOff[] {
  return byResource || filtered.length ? [...timeOff] : timeOff.filter((item) => item.kind === "block");
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
      busy: [],
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

/** Statuses that take their time (the others free it, [AGD-09]). */
const OCCUPYING: readonly string[] = ["pending", "confirmed"];

/** A resource's working time on a day: its own hours inside the business's ([AGD-05]). */
function workingRanges(resource: ResourceItem, date: string, frame: AgendaFrame): MinuteRange[] {
  return intersectRanges(openRanges(date, frame.hours, frame.closures), scheduleOf(resource, date));
}

/** The part of each item on `date`, in minutes of that day. */
function dayParts(items: readonly { startLocal: string; endLocal: string }[], date: string): MinuteRange[] {
  return items.flatMap((item) => dayMinutes(item.startLocal, item.endLocal, date) ?? []);
}

/** Minutes in which the people booked reach the capacity (capacity mode). */
function fullRanges(bookings: readonly CalendarBooking[], date: string, capacity: number): MinuteRange[] {
  const edges = new Map<number, number>();
  for (const booking of bookings) {
    const part = dayMinutes(booking.startLocal, booking.endLocal, date);
    if (!part) continue;
    edges.set(part.startMin, (edges.get(part.startMin) ?? 0) + booking.people);
    edges.set(part.endMin, (edges.get(part.endMin) ?? 0) - booking.people);
  }
  const full: MinuteRange[] = [];
  let people = 0;
  let start: number | null = null;
  for (const minute of [...edges.keys()].sort((a, b) => a - b)) {
    people += edges.get(minute) ?? 0;
    if (people >= capacity && start === null) start = minute;
    else if (people < capacity && start !== null) {
      full.push({ startMin: start, endMin: minute });
      start = null;
    }
  }
  return full;
}

/**
 * [AGD-29] The open time of a column in which nobody of `resources` is free: a stretch is free while at least one of
 * them works then (business hours ∩ their own) with no absence or block and, by resource, no booking that takes it
 * (pending or confirmed; in capacity mode, while the people booked do not fill it). Margins between bookings count as
 * free, as on the grid.
 */
export function busyRanges(
  date: string,
  open: readonly MinuteRange[],
  resources: readonly ResourceItem[],
  bookings: readonly CalendarBooking[],
  timeOff: readonly CalendarTimeOff[],
  frame: AgendaFrame,
  mode: AgendaMode,
): MinuteRange[] {
  const free = resources.flatMap((resource) => {
    const own = bookings.filter((booking) => booking.resourceId === resource.id && OCCUPYING.includes(booking.status));
    const taken = mode === "capacity" ? fullRanges(own, date, resource.capacity) : dayParts(own, date);
    const off = dayParts(timeOff.filter((item) => item.resourceId === resource.id), date);
    return subtractRanges(workingRanges(resource, date, frame), [...off, ...taken]);
  });
  return subtractRanges(open, free);
}

export type MonthDayData = {
  date: string;
  day: string;
  label: string;
  inMonth: boolean;
  isToday: boolean;
  /** «Cerrado», «Cerrado · 2 citas» or with the holiday's reason, when the whole day is closed. */
  closedLabel: string | null;
  /** Bookings that start that day, without the cancelled ones. */
  count: number;
  /** Booked time over the working time of its professionals (people over capacity in capacity mode); null when nobody works. */
  ratio: number | null;
  /** The first bookings of the day, by start, for a glance on wide screens. */
  previews: CalendarBooking[];
};

export type MonthContext = {
  frame: AgendaFrame;
  today: string;
  resources: readonly ResourceItem[];
  timeOff: readonly CalendarTimeOff[];
  mode: AgendaMode;
  resourceIds: readonly string[];
  serviceIds: readonly string[];
  words: { booking: string; bookings: string };
};

/** Bookings shown under each day of the month on wide screens. */
const MONTH_PREVIEWS = 2;

/** Items on every day they touch, so each day only looks at its own. */
function byDay<T extends { startLocal: string; endLocal: string }>(items: readonly T[]): Map<string, T[]> {
  const days = new Map<string, T[]>();
  for (const item of items) {
    const last = localDateOf(item.endLocal);
    for (let day = localDateOf(item.startLocal); day <= last; day = addDays(day, 1)) days.set(day, [...(days.get(day) ?? []), item]);
  }
  return days;
}

/**
 * [AGD-31] How full a day is: in individual mode, the booked time of each professional over their working time
 * (business hours ∩ their own, without absences and blocks); in capacity mode, people by duration over capacity by
 * open time. Only the time inside the working time counts, so it never passes 1. Null when nobody works that day.
 */
function dayRatio(date: string, bookings: readonly CalendarBooking[], timeOff: readonly CalendarTimeOff[], context: MonthContext): number | null {
  const shown = visibleResources([...context.resources], context.resourceIds, bookings);
  const resources = context.serviceIds.length ? shown.filter((resource) => resource.serviceIds.some((id) => context.serviceIds.includes(id))) : shown;
  let booked = 0;
  let available = 0;
  for (const resource of resources) {
    const off = dayParts(timeOff.filter((item) => item.resourceId === resource.id), date);
    const working = subtractRanges(workingRanges(resource, date, context.frame), off);
    const own = bookings.filter((booking) => booking.resourceId === resource.id);
    if (context.mode === "capacity") {
      available += resource.capacity * rangesMinutes(working);
      for (const booking of own) booked += booking.people * rangesMinutes(intersectRanges(dayParts([booking], date), working));
    } else {
      available += rangesMinutes(working);
      booked += rangesMinutes(intersectRanges(mergeRanges(dayParts(own, date)), working));
    }
  }
  return available > 0 ? Math.min(1, booked / available) : null;
}

/** Weeks of the month: each day with how many bookings it has, how full it is, whether it is closed and its first bookings. */
export function monthDays(date: string, bookings: readonly CalendarBooking[], context: MonthContext): MonthDayData[][] {
  const bookingsByDay = byDay(bookings);
  const timeOffByDay = byDay(context.timeOff);
  return monthWeeks(date).map((week) =>
    week.map((cell) => {
      const open = openRanges(cell.date, context.frame.hours, context.frame.closures);
      const heading = dayHeading(cell.date);
      const touching = bookingsByDay.get(cell.date) ?? [];
      const starting = touching.filter((booking) => localDateOf(booking.startLocal) === cell.date);
      const counted = touching.filter((booking) => booking.status !== "cancelled");
      const count = starting.filter((booking) => booking.status !== "cancelled").length;
      const closed = closedLabel(cell.date, context.frame, open);
      return {
        date: cell.date,
        day: heading.day,
        label: heading.long,
        inMonth: cell.inMonth,
        isToday: cell.date === context.today,
        closedLabel: closed && count > 0 ? `${closed} · ${count} ${count === 1 ? context.words.booking : context.words.bookings}` : closed,
        count,
        ratio: dayRatio(cell.date, counted, timeOffByDay.get(cell.date) ?? [], context),
        previews: starting.slice(0, MONTH_PREVIEWS),
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

const ROUTE_NAMES: Record<string, string> = { whatsapp: "WhatsApp", telegram: "Telegram", email: "correo" };

/**
 * Each reminder of the booking for its current time ([AGD-25]): «Enviado por WhatsApp el …», or that it did not go and
 * why. A booking reminded by the single reminder of before phase 12 says when that one went.
 */
function reminderLines(detail: BookingDetail, timezone: string): string[] {
  const lines = detail.reminders.map((item) => {
    const lead = item.lead ? `${item.lead.charAt(0).toUpperCase()}${item.lead.slice(1)}: ` : "";
    const when = formatDateTime(item.at, timezone);
    if (item.status === "sent") return `${lead}enviado${item.channel ? ` por ${ROUTE_NAMES[item.channel]}` : ""} el ${when}`;
    if (item.status === "sending") return `${lead}enviándose`;
    return `${lead}no enviado${item.reason ? ` (${item.reason})` : ""}`;
  });
  if (lines.length === 0 && detail.reminderSentAt) return [`Enviado el ${formatDateTime(detail.reminderSentAt, timezone)}`];
  return lines;
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
    reminderLines: reminderLines(detail, timezone),
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
      // Only who may reply in its conversation is offered «Avisar al cliente» (the server checks it again, [AGD-23]).
      canNotify: detail.canNotify,
    },
  };
}
