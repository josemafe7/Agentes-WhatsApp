// «Dentro» or «fuera de horario» ([AJU-03], [TRA-03], [CAN-08]): the business's weekly ranges and closures read in
// its own time zone, so changes of time (DST) are handled by the zone, not by us.
import { formatDateTime } from "./format";

/** Local minutes from 00:00; weekday 1 = Monday … 7 = Sunday (as stored). */
export type OpeningRange = { weekday: number; startMin: number; endMin: number };
/** Local calendar dates YYYY-MM-DD, both ends included. */
export type ClosureRange = { startDate: string; endDate: string };

export function isWithinOpeningHours(
  at: Date,
  timezone: string,
  hours: readonly OpeningRange[],
  closures: readonly ClosureRange[] = [],
): boolean {
  const day = formatDateTime(at, timezone, { pattern: "yyyy-MM-dd" });
  if (closures.some((closure) => closure.startDate <= day && day <= closure.endDate)) return false;
  const weekday = Number(formatDateTime(at, timezone, { pattern: "i" }));
  const [hour, minute] = formatDateTime(at, timezone, { pattern: "HH:mm" }).split(":").map(Number);
  const minutes = hour * 60 + minute;
  return hours.some((range) => range.weekday === weekday && range.startMin <= minutes && minutes < range.endMin);
}
