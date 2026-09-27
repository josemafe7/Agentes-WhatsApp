// Business-local time ⇄ UTC instants for the agenda ([AGD-10], [AGD-28]). The database keeps UTC; people and the
// agent read and write the business's wall clock. Pure (no server imports): the zone's own rules (tzOffset of
// @date-fns/tz) decide the changes of time, and the two awkward cases are resolved on purpose:
// - a local time that does not exist (clocks go forward, e.g. 02:30 on 2027-03-28 in Madrid) moves forward by the
//   gap, like Temporal's "compatible" choice;
// - a local time that happens twice (clocks go back, e.g. 02:30 on 2026-10-25 in Madrid) takes the earlier
//   occurrence unless the caller asks for the later one (the end of a range) or gives the offset.
import "server-only";
import { tzOffset } from "@date-fns/tz";

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;
export const MINUTES_PER_DAY = 1_440;

/** A business-local calendar day, "YYYY-MM-DD". */
export type LocalDate = string;
export type Disambiguation = "earlier" | "later";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/** "YYYY-MM-DDTHH:mm" (or with a space, seconds and an offset such as "+02:00" or "Z"). */
const DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/;

const pad = (value: number, length = 2) => String(Math.trunc(Math.abs(value))).padStart(length, "0");

function dateParts(date: LocalDate): [number, number, number] | null {
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  // Rejects 2026-02-30 and friends.
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return [year, month, day];
}

export function isLocalDate(value: string): boolean {
  return dateParts(value) !== null;
}

function requireDate(date: LocalDate): [number, number, number] {
  const parts = dateParts(date);
  if (!parts) throw new RangeError(`Fecha no válida: ${date}`);
  return parts;
}

/** The local day and time read as if they were UTC ("wall clock" milliseconds). */
function wallMs(date: LocalDate, minutes: number): number {
  const [year, month, day] = requireDate(date);
  return Date.UTC(year, month - 1, day) + minutes * MINUTE_MS;
}

function dateOfWall(wall: number): LocalDate {
  const value = new Date(wall);
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

/** `date` plus `days` calendar days. */
export function addDays(date: LocalDate, days: number): LocalDate {
  return dateOfWall(wallMs(date, 0) + days * DAY_MS);
}

/** Calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((wallMs(to, 0) - wallMs(from, 0)) / DAY_MS);
}

/** ISO weekday as stored in schedules: 1 = Monday … 7 = Sunday. */
export function weekdayOf(date: LocalDate): number {
  const day = new Date(wallMs(date, 0)).getUTCDay();
  return day === 0 ? 7 : day;
}

function offsetMinutes(timeZone: string, instant: number): number {
  const offset = tzOffset(timeZone, new Date(instant));
  if (Number.isNaN(offset)) throw new RangeError(`Zona horaria no válida: ${timeZone}`);
  return offset;
}

/**
 * Every instant at which the clock of `timeZone` shows `date` at `minutes` after midnight (1440 = the next
 * midnight): none in a gap, two in a repeated hour, one otherwise. Sorted.
 */
function instantsOf(date: LocalDate, minutes: number, timeZone: string): number[] {
  const wall = wallMs(date, minutes);
  // Offsets in force around this wall time: a change of time within a day either side is caught.
  const offsets = new Set([offsetMinutes(timeZone, wall - DAY_MS), offsetMinutes(timeZone, wall), offsetMinutes(timeZone, wall + DAY_MS)]);
  const instants: number[] = [];
  for (const offset of offsets) {
    const instant = wall - offset * MINUTE_MS;
    if (offsetMinutes(timeZone, instant) === offset && !instants.includes(instant)) instants.push(instant);
  }
  return instants.sort((a, b) => a - b);
}

/**
 * What a nonexistent local time becomes: "shift" moves it forward by the gap (02:30 → 03:30, Temporal's
 * "compatible"; for a time someone typed), "clamp" gives the instant the clocks jump (02:30 → 03:00; for the edges of
 * opening ranges: open «from 02:30» means open as soon as the clock reads 03:00, and «until 02:30» closes then).
 */
export type SkippedTime = "shift" | "clamp";

/** First instant of the gap's new offset between `from` (old offset) and `to` (new offset), to the minute. */
function jumpInstant(timeZone: string, from: number, to: number): number {
  const after = offsetMinutes(timeZone, to);
  let low = Math.floor(from / MINUTE_MS);
  let high = Math.ceil(to / MINUTE_MS);
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (offsetMinutes(timeZone, middle * MINUTE_MS) === after) high = middle;
    else low = middle;
  }
  return high * MINUTE_MS;
}

/** The instant the business clock shows `date` + `minutes`, with the choices explained at the top of this file. */
export function localToInstant(
  date: LocalDate,
  minutes: number,
  timeZone: string,
  disambiguation: Disambiguation = "earlier",
  skipped: SkippedTime = "shift",
): Date {
  const instants = instantsOf(date, minutes, timeZone);
  if (instants.length > 0) return new Date(disambiguation === "later" ? instants[instants.length - 1] : instants[0]);
  // A gap only happens when the offset grows: read with the smaller (older) offset the time lands after the jump,
  // read with the larger one it lands before it.
  const wall = wallMs(date, minutes);
  const offsets = [offsetMinutes(timeZone, wall - DAY_MS), offsetMinutes(timeZone, wall + DAY_MS)];
  const shifted = wall - Math.min(...offsets) * MINUTE_MS;
  if (skipped === "shift") return new Date(shifted);
  return new Date(jumpInstant(timeZone, wall - Math.max(...offsets) * MINUTE_MS, shifted));
}

/** Whether that local time happens twice (clocks going back). */
export function isRepeatedLocalTime(date: LocalDate, minutes: number, timeZone: string): boolean {
  return instantsOf(date, minutes, timeZone).length > 1;
}

/** Whether that local time does not exist (clocks going forward). */
export function isSkippedLocalTime(date: LocalDate, minutes: number, timeZone: string): boolean {
  return instantsOf(date, minutes, timeZone).length === 0;
}

export type LocalParts = {
  date: LocalDate;
  /** Minutes after local midnight. */
  minutes: number;
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** UTC offset in minutes (120 for CEST). */
  offset: number;
};

/** How the business clock reads `instant`. */
export function instantToLocal(instant: Date, timeZone: string): LocalParts {
  const offset = offsetMinutes(timeZone, instant.getTime());
  const wall = instant.getTime() + offset * MINUTE_MS;
  const date = dateOfWall(wall);
  const value = new Date(wall);
  return { date, minutes: value.getUTCHours() * 60 + value.getUTCMinutes(), weekday: weekdayOf(date), offset };
}

function offsetText(offset: number): string {
  return `${offset < 0 ? "-" : "+"}${pad(offset / 60)}:${pad(offset % 60)}`;
}

/** "2026-10-25T02:30:00+02:00": the business-local time with its offset, unambiguous even on change days. */
export function formatLocalIso(instant: Date, timeZone: string): string {
  const { date, offset } = instantToLocal(instant, timeZone);
  const wall = new Date(instant.getTime() + offset * MINUTE_MS);
  return `${date}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}${offsetText(offset)}`;
}

/**
 * "2026-10-25T02:30" for the agent and the forms; the offset is added only when that local time happens twice, so
 * the same text always comes back to the same instant (parseLocalDateTime).
 */
export function formatLocalMinute(instant: Date, timeZone: string): string {
  const { date, minutes, offset } = instantToLocal(instant, timeZone);
  const text = `${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  return isRepeatedLocalTime(date, minutes, timeZone) ? `${text}${offsetText(offset)}` : text;
}

/**
 * Reads a business-local "YYYY-MM-DDTHH:mm" (optionally with seconds and an offset that picks one of two repeated
 * times) or a bare date "YYYY-MM-DD" (its midnight). Null when it is not a valid local date and time.
 */
export function parseLocalDateTime(value: string, timeZone: string, disambiguation: Disambiguation = "earlier"): Date | null {
  const text = value.trim();
  if (dateParts(text)) return localToInstant(text, 0, timeZone, disambiguation);
  const match = DATE_TIME_PATTERN.exec(text);
  if (!match || !dateParts(match[1])) return null;
  const [hours, minutes, seconds] = [Number(match[2]), Number(match[3]), Number(match[4] ?? 0)];
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const minuteOfDay = hours * 60 + minutes;
  const zone = match[5];
  if (zone) {
    // An explicit offset only chooses between the instants of that local time; a wrong one is not accepted.
    const wanted = zone === "Z" ? 0 : (zone.startsWith("-") ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)));
    const instant = instantsOf(match[1], minuteOfDay, timeZone).find((candidate) => offsetMinutes(timeZone, candidate) === wanted);
    return instant === undefined ? null : new Date(instant + seconds * 1_000);
  }
  return new Date(localToInstant(match[1], minuteOfDay, timeZone, disambiguation).getTime() + seconds * 1_000);
}

/** Start of the local day (its first instant) and of the next one: 23, 24 or 25 hours apart. */
export function localDayBounds(date: LocalDate, timeZone: string): { start: Date; end: Date } {
  return { start: localToInstant(date, 0, timeZone), end: localToInstant(addDays(date, 1), 0, timeZone) };
}
