// The conversation as the screen shows it (DESIGN.md «Bandeja y conversación»): day separators («Hoy», «Ayer»,
// «lunes, 21 de septiembre») in the business time zone, messages grouped by consecutive author, and the team's
// internal notes in their place in time ([BAN-05], [BAN-07]). Pure.
import { tz } from "@date-fns/tz";
import { differenceInCalendarDays } from "date-fns";
import { DEFAULT_TIMEZONE, formatDateTime, isValidTimeZone } from "@/lib/format";

type Timed = { id: string; createdAt: Date };
type TimelineMessage = Timed & { senderType: "contact" | "ai" | "human" | "system"; authorName: string | null };

export type TimelineItem<M, N> =
  | { kind: "day"; key: string; label: string }
  | { kind: "message"; key: string; message: M; first: boolean; last: boolean }
  | { kind: "note"; key: string; note: N };

const zoneOf = (timezone: string) => (isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE);
const dayKey = (date: Date, timezone: string) => formatDateTime(date, timezone, { pattern: "yyyy-MM-dd" });

export function dayLabel(date: Date, timezone: string, now: Date): string {
  const zone = zoneOf(timezone);
  const days = differenceInCalendarDays(now, date, { in: tz(zone) });
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";
  const sameYear = formatDateTime(date, zone, { pattern: "yyyy" }) === formatDateTime(now, zone, { pattern: "yyyy" });
  return formatDateTime(date, zone, { pattern: sameYear ? "EEEE, d 'de' MMMM" : "EEEE, d 'de' MMMM 'de' yyyy" });
}

const byTime = (a: Timed, b: Timed) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Older pages plus the latest one, without repeats, oldest first (the latest copy of a message wins). */
export function mergeMessages<M extends Timed>(older: readonly M[], latest: readonly M[]): M[] {
  const byId = new Map<string, M>();
  for (const message of [...older, ...latest]) byId.set(message.id, message);
  return [...byId.values()].sort(byTime);
}

const authorKey = (message: TimelineMessage) => (message.senderType === "system" ? null : `${message.senderType}:${message.authorName ?? ""}`);

/**
 * Messages and notes in order. While older messages are still to load (`complete` false), notes older than the first
 * loaded message wait, so they never show up far from their context.
 */
export function buildTimeline<M extends TimelineMessage, N extends Timed>(
  messages: readonly M[],
  notes: readonly N[],
  options: { timezone: string; now: Date; complete: boolean },
): TimelineItem<M, N>[] {
  const zone = zoneOf(options.timezone);
  const sorted = [...messages].sort(byTime);
  const firstAt = sorted[0]?.createdAt.getTime() ?? Number.POSITIVE_INFINITY;
  const visibleNotes = notes.filter((note) => options.complete || note.createdAt.getTime() >= firstAt);
  type Entry = { kind: "message"; value: M } | { kind: "note"; value: N };
  const entries: Entry[] = [
    ...sorted.map((value) => ({ kind: "message" as const, value })),
    ...visibleNotes.map((value) => ({ kind: "note" as const, value })),
  ].sort((a, b) => byTime(a.value, b.value) || (a.kind === b.kind ? 0 : a.kind === "message" ? -1 : 1));

  const items: TimelineItem<M, N>[] = [];
  let currentDay: string | null = null;
  let previous: Extract<TimelineItem<M, N>, { kind: "message" }> | null = null;
  for (const entry of entries) {
    const day = dayKey(entry.value.createdAt, zone);
    if (day !== currentDay) {
      currentDay = day;
      previous = null;
      items.push({ kind: "day", key: `day-${day}`, label: dayLabel(entry.value.createdAt, zone, options.now) });
    }
    if (entry.kind === "note") {
      previous = null;
      items.push({ kind: "note", key: `note-${entry.value.id}`, note: entry.value });
      continue;
    }
    const key = authorKey(entry.value);
    const continues: boolean = previous !== null && key !== null && authorKey(previous.message) === key;
    if (continues && previous) previous.last = false;
    const item: Extract<TimelineItem<M, N>, { kind: "message" }> = { kind: "message", key: `message-${entry.value.id}`, message: entry.value, first: !continues, last: true };
    items.push(item);
    previous = item;
  }
  return items;
}
