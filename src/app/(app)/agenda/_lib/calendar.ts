// Days of each Agenda view, their names in Spanish and the opening hours drawn on them ([AGD-05], [AGD-16],
// [AGD-28]). Days are business-local "YYYY-MM-DD" strings; the arithmetic is the agenda's own (src/server/booking/
// time.ts, pure). Used by the page on the server: client components receive the result.
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { addDays, instantToLocal, weekdayOf } from "@/server/booking/time";
import type { AgendaView } from "./search-params";

export type DayRange = { from: string; to: string };
export type MinuteRange = { startMin: number; endMin: number };
type WeeklyHours = { weekday: number; startMin: number; endMin: number };
type Closure = { startDate: string; endDate: string; reason: string | null };

const DAYS_PER_WEEK = 7;

/** A day as a Date at local midnight of this runtime, only to format its name (never to compute instants). */
function asCalendarDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

const formatDay = (date: string, pattern: string) => format(asCalendarDate(date), pattern, { locale: es });
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Today and the current minute in the business time zone. */
export function nowLocal(timezone: string, now: Date = new Date()): { date: string; minutes: number } {
  const { date, minutes } = instantToLocal(now, timezone);
  return { date, minutes };
}

function mondayOf(date: string): string {
  return addDays(date, 1 - weekdayOf(date));
}

function firstOfMonth(date: string): string {
  return `${date.slice(0, 8)}01`;
}

function lastOfMonth(date: string): string {
  const [year, month] = date.split("-").map(Number);
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return addDays(nextMonth, -1);
}

/** Days shown by each view: one day, Monday to Sunday, or the whole weeks around a month. */
export function viewRange(view: AgendaView, date: string): DayRange {
  if (view === "semana") {
    const monday = mondayOf(date);
    return { from: monday, to: addDays(monday, DAYS_PER_WEEK - 1) };
  }
  if (view === "mes") {
    const from = mondayOf(firstOfMonth(date));
    const last = lastOfMonth(date);
    return { from, to: addDays(last, DAYS_PER_WEEK - weekdayOf(last)) };
  }
  return { from: date, to: date };
}

/** The day that «Anterior» (-1) or «Siguiente» (1) opens. A month moves to the 1st of the other month. */
export function stepDate(view: AgendaView, date: string, direction: -1 | 1): string {
  if (view === "semana") return addDays(date, direction * DAYS_PER_WEEK);
  if (view === "mes") {
    const [year, month] = date.split("-").map(Number);
    const index = year * 12 + (month - 1) + direction;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
  }
  return addDays(date, direction);
}

/** «Lunes, 28 de septiembre de 2026», «Semana del 21 al 27 de septiembre», «Septiembre de 2026». */
export function periodLabel(view: AgendaView, date: string): string {
  if (view === "mes") return capitalize(formatDay(date, "MMMM 'de' yyyy"));
  if (view === "semana") {
    const { from, to } = viewRange("semana", date);
    if (from.slice(0, 4) !== to.slice(0, 4)) return `Semana del ${formatDay(from, "d 'de' MMMM 'de' yyyy")} al ${formatDay(to, "d 'de' MMMM 'de' yyyy")}`;
    if (from.slice(0, 7) !== to.slice(0, 7)) return `Semana del ${formatDay(from, "d 'de' MMMM")} al ${formatDay(to, "d 'de' MMMM")}`;
    return `Semana del ${formatDay(from, "d")} al ${formatDay(to, "d 'de' MMMM")}`;
  }
  return capitalize(formatDay(date, "EEEE, d 'de' MMMM 'de' yyyy"));
}

/** Column heading of a day: «lun», «28» and «lunes, 28 de septiembre» for screen readers. */
export function dayHeading(date: string): { weekday: string; day: string; long: string } {
  return { weekday: formatDay(date, "EEE"), day: formatDay(date, "d"), long: formatDay(date, "EEEE, d 'de' MMMM") };
}

/** Weeks of the month grid (Monday first), each day marked as in the month or around it. */
export function monthWeeks(date: string): { date: string; inMonth: boolean }[][] {
  const { from, to } = viewRange("mes", date);
  const month = date.slice(0, 7);
  const weeks: { date: string; inMonth: boolean }[][] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (weekdayOf(day) === 1) weeks.push([]);
    weeks[weeks.length - 1].push({ date: day, inMonth: day.slice(0, 7) === month });
  }
  return weeks;
}

/** The business closure (holiday) that covers the day, if any. */
export function closureOf(date: string, closures: readonly Closure[]): { reason: string | null } | null {
  const closure = closures.find((item) => item.startDate <= date && item.endDate >= date);
  return closure ? { reason: closure.reason } : null;
}

/** Open ranges of the day in local minutes, joined and in order; none on closed days and holidays. */
export function openRanges(date: string, hours: readonly WeeklyHours[], closures: readonly Closure[]): MinuteRange[] {
  if (closureOf(date, closures)) return [];
  const weekday = weekdayOf(date);
  const ranges = hours
    .filter((range) => range.weekday === weekday && range.endMin > range.startMin)
    .map((range) => ({ startMin: range.startMin, endMin: range.endMin }))
    .sort((a, b) => a.startMin - b.startMin);
  const merged: MinuteRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.startMin <= last.endMin) last.endMin = Math.max(last.endMin, range.endMin);
    else merged.push({ ...range });
  }
  return merged;
}

/** The minutes open in both lists (a resource works only inside the business's hours, [AGD-05]). */
export function intersectRanges(a: readonly MinuteRange[], b: readonly MinuteRange[]): MinuteRange[] {
  const result: MinuteRange[] = [];
  for (const first of a) {
    for (const second of b) {
      const startMin = Math.max(first.startMin, second.startMin);
      const endMin = Math.min(first.endMin, second.endMin);
      if (endMin > startMin) result.push({ startMin, endMin });
    }
  }
  return result.sort((x, y) => x.startMin - y.startMin);
}
