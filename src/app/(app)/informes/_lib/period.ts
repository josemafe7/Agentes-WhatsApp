// The period of the reports in words ([INF-01]): «Septiembre de 2026», «Del 1 al 15 de septiembre de 2026», and the
// months offered in «Otro periodo». Days are business-local "YYYY-MM-DD" strings; the month arithmetic and the month
// and day names are the agenda's (same words everywhere). Pure: used by the page and the client components.
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { periodLabel, stepDate } from "@/app/(app)/agenda/_lib/calendar";
import type { ReportPeriod } from "@/data/reports";

/** Months listed in «Otro periodo», the current one included. */
export const MONTH_OPTIONS = 24;

/** A day as a Date at local midnight of this runtime, only to write its name (never to compute instants). */
function asCalendarDate(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

const formatDay = (day: string, pattern: string) => format(asCalendarDate(day), pattern, { locale: es });

/** «Septiembre de 2026». */
export function monthLabel(month: string): string {
  return periodLabel("mes", `${month}-01`);
}

/** The month before (-1) or after (1) "YYYY-MM". */
export function shiftMonth(month: string, direction: -1 | 1): string {
  return stepDate("mes", `${month}-01`, direction).slice(0, 7);
}

/** «Septiembre de 2026», «Jueves, 24 de septiembre de 2026» or «Del 1 al 15 de septiembre de 2026». */
export function reportPeriodLabel(period: Pick<ReportPeriod, "kind" | "month" | "firstDay" | "lastDay">): string {
  if (period.kind === "month" && period.month) return monthLabel(period.month);
  const { firstDay, lastDay } = period;
  if (firstDay === lastDay) return periodLabel("dia", firstDay);
  const last = formatDay(lastDay, "d 'de' MMMM 'de' yyyy");
  if (firstDay.slice(0, 4) !== lastDay.slice(0, 4)) return `Del ${formatDay(firstDay, "d 'de' MMMM 'de' yyyy")} al ${last}`;
  if (firstDay.slice(0, 7) !== lastDay.slice(0, 7)) return `Del ${formatDay(firstDay, "d 'de' MMMM")} al ${last}`;
  return `Del ${formatDay(firstDay, "d")} al ${last}`;
}

/** The current month and the ones before it, plus the one on screen if it is older or later. */
export function monthOptions(currentMonth: string, selectedMonth: string | null, count: number = MONTH_OPTIONS): { value: string; label: string }[] {
  const months = [currentMonth];
  while (months.length < count) months.push(shiftMonth(months[months.length - 1], -1));
  if (selectedMonth && !months.includes(selectedMonth)) months.push(selectedMonth);
  return months.sort((a, b) => b.localeCompare(a)).map((value) => ({ value, label: monthLabel(value) }));
}

/** «20 sep», under the bars of a chart. */
export function shortDayLabel(day: string): string {
  return formatDay(day, "d MMM");
}

/** «20 sep 2026», in tables and tooltips. */
export function dayLabel(day: string): string {
  return formatDay(day, "d MMM yyyy");
}

/** «sep 2026», under the bars of a chart. */
export function shortMonthLabel(month: string): string {
  return formatDay(`${month}-01`, "MMM yyyy");
}
