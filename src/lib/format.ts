// Spanish (es-ES) formatting for dates, numbers and money; dates always in the business time zone.
import { tz } from "@date-fns/tz";
import { differenceInCalendarDays, format, isSameYear } from "date-fns";
import { es } from "date-fns/locale";

export const DEFAULT_TIMEZONE = "Europe/Madrid";

const LOCALE = "es-ES";
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAYS_SHOWN_AS_WEEKDAY = 7;
// Below one cent, show significant digits so AI costs per message do not read as 0,00.
const ONE_CENT = 0.01;
const SUB_CENT_SIGNIFICANT_DIGITS = 2;

export type DateInput = Date | number | string;

/** Named formats: «12 oct 2026, 10:42», «12 oct 2026», «10:42», «lunes, 12 de octubre». */
export type DateTimePreset = "datetime" | "date" | "time" | "long-date";

const PRESET_PATTERNS: Record<DateTimePreset, string> = {
  datetime: "d MMM yyyy, HH:mm",
  date: "d MMM yyyy",
  time: "HH:mm",
  "long-date": "EEEE, d 'de' MMMM",
};

/** True for an IANA time zone the runtime knows (e.g. "Europe/Madrid"). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone });
    return true;
  } catch {
    return false;
  }
}

function toDate(value: DateInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function zoneContext(timeZone: string) {
  return tz(isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE);
}

/** Date/time in the business time zone with a preset (default «12 oct 2026, 10:42») or a date-fns pattern. */
export function formatDateTime(
  date: DateInput,
  timeZone: string = DEFAULT_TIMEZONE,
  opts: { preset?: DateTimePreset; pattern?: string } = {},
): string {
  const value = toDate(date);
  if (!value) return "";
  const pattern = opts.pattern ?? PRESET_PATTERNS[opts.preset ?? "datetime"];
  return format(value, pattern, { locale: es, in: zoneContext(timeZone) });
}

/** Short relative time: «ahora», «hace 5 min», «hace 3 h», «ayer», «martes», «12 sep», «en 10 min», «mañana». */
export function formatRelative(
  date: DateInput,
  timeZone: string = DEFAULT_TIMEZONE,
  now: DateInput = new Date(),
): string {
  const value = toDate(date);
  const reference = toDate(now);
  if (!value || !reference) return "";

  const context = zoneContext(timeZone);
  const diffMs = reference.getTime() - value.getTime();
  const absMs = Math.abs(diffMs);
  const calendarDays = differenceInCalendarDays(reference, value, { in: context });

  if (absMs < MINUTE_MS) return "ahora";
  const past = diffMs > 0;
  if (absMs < HOUR_MS) {
    const minutes = Math.floor(absMs / MINUTE_MS);
    return past ? `hace ${minutes} min` : `en ${minutes} min`;
  }
  if (calendarDays === 0) {
    const hours = Math.floor(absMs / HOUR_MS);
    return past ? `hace ${hours} h` : `en ${hours} h`;
  }
  if (calendarDays === 1) return "ayer";
  if (calendarDays === -1) return "mañana";
  if (calendarDays > 1 && calendarDays < DAYS_SHOWN_AS_WEEKDAY) {
    return format(value, "EEEE", { locale: es, in: context });
  }
  const sameYear = isSameYear(reference, value, { in: context });
  return format(value, sameYear ? "d MMM" : "d MMM yyyy", { locale: es, in: context });
}

/** Number in Spanish format («12.345», «1234», «1.234,5»); pass Intl options for percentages, etc. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat(LOCALE, options).format(value);
}

/** Control characters (line breaks, tabs, BEL…) and the Unicode line and paragraph separators. */
const LINE_BREAKING = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;

/**
 * One line of plain text: control characters and line breaks become spaces and runs of spaces collapse. For text
 * from outside (a name a visitor typed, a channel's profile name) that goes into a prompt, a title or a subject:
 * it can never start a line of its own ([HER-09]).
 */
export function toSingleLine(value: string, maxLength?: number): string {
  const flat = value.replace(LINE_BREAKING, " ").replace(/\s+/g, " ").trim();
  return maxLength !== undefined && flat.length > maxLength ? flat.slice(0, maxLength).trimEnd() : flat;
}

/**
 * The text with the spaces and tabs at the end of each line removed. A loop, not `/[ \t]+\n/g`: that pattern starts
 * again at every space of a long run and its time grows with the square of the run, so a file or web page (text from
 * outside) could block the server with a few megabytes of spaces.
 */
export function trimLineEnds(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      let end = line.length;
      while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t")) end -= 1;
      return end === line.length ? line : line.slice(0, end);
    })
    .join("\n");
}

/** Amount in US dollars («12,34 US$»); amounts below one cent keep two significant digits («0,0023 US$»). */
export function formatCurrencyUSD(amount: number): string {
  if (!Number.isFinite(amount)) return "";
  const subCent = amount !== 0 && Math.abs(amount) < ONE_CENT;
  return formatNumber(amount, {
    style: "currency",
    currency: "USD",
    ...(subCent ? { maximumSignificantDigits: SUB_CENT_SIGNIFICANT_DIGITS } : {}),
  });
}
