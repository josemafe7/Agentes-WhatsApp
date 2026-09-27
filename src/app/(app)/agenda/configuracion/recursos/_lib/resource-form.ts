// Resources screen helpers ([AGD-02], [AGD-28]): the weekly schedule in one line, the absence the form sends and how an
// absence reads. Times are business-local; the server turns them into instants with the business time zone.
import { formatDateTime } from "@/lib/format";

type Range = { weekday: number; start: string; end: string };

const WEEKDAY_SHORT: Record<number, string> = { 1: "Lun", 2: "Mar", 3: "Mié", 4: "Jue", 5: "Vie", 6: "Sáb", 7: "Dom" };
const MINUTE_MS = 60_000;

/** «Lun–Vie 09:00–14:00 y 16:00–20:00 · Sáb 09:00–14:00»: consecutive days with the same ranges go together. */
export function scheduleSummary(ranges: readonly Range[]): string {
  const dayText = (weekday: number) =>
    ranges
      .filter((range) => range.weekday === weekday)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((range) => `${range.start}–${range.end}`)
      .join(" y ");
  const groups: { from: number; to: number; text: string }[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    const text = dayText(weekday);
    if (!text) continue;
    const last = groups.at(-1);
    if (last && last.to === weekday - 1 && last.text === text) last.to = weekday;
    else groups.push({ from: weekday, to: weekday, text });
  }
  if (groups.length === 0) return "Sin horario";
  return groups
    .map((group) => `${group.from === group.to ? WEEKDAY_SHORT[group.from] : `${WEEKDAY_SHORT[group.from]}–${WEEKDAY_SHORT[group.to]}`} ${group.text}`)
    .join(" · ");
}

export type AbsenceFormValues = {
  resourceId: string;
  /** Whole days (from the start of the first day to the end of the last) or a range with hours. */
  wholeDays: boolean;
  startDate: string;
  /** Empty = the same day. */
  endDate: string;
  startTime: string;
  endTime: string;
  reason: string;
};

/** The absence as the server takes it: bare days "YYYY-MM-DD" (the end day included) or "YYYY-MM-DDTHH:mm". */
export function absencePayload(values: AbsenceFormValues) {
  const endDate = values.endDate || values.startDate;
  return {
    resourceId: values.resourceId,
    kind: "absence" as const,
    start: values.wholeDays ? values.startDate : `${values.startDate}T${values.startTime}`,
    end: values.wholeDays ? endDate : `${endDate}T${values.endTime}`,
    reason: values.reason,
  };
}

const isLocalMidnight = (instant: Date, timeZone: string) => formatDateTime(instant, timeZone, { preset: "time" }) === "00:00";

/** «12 oct 2026 – 16 oct 2026» for whole days, «12 oct 2026, 10:00 – 12:30» with hours; in the business time zone. */
export function timeOffLabel(item: { startsAt: Date; endsAt: Date }, timeZone: string): string {
  const date = (instant: Date) => formatDateTime(instant, timeZone, { preset: "date" });
  if (isLocalMidnight(item.startsAt, timeZone) && isLocalMidnight(item.endsAt, timeZone)) {
    // The end is the midnight after the last day: one minute earlier is still that day, whatever its length.
    const first = date(item.startsAt);
    const last = date(new Date(item.endsAt.getTime() - MINUTE_MS));
    return first === last ? first : `${first} – ${last}`;
  }
  const start = formatDateTime(item.startsAt, timeZone);
  const sameDay = date(item.startsAt) === date(item.endsAt);
  return `${start} – ${sameDay ? formatDateTime(item.endsAt, timeZone, { preset: "time" }) : formatDateTime(item.endsAt, timeZone)}`;
}
