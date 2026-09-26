// Demo dates are relative to the day the demo is loaded, in the business time zone ([ARR-07], [AGD-28]).
import { tz } from "@date-fns/tz";
import { addDays, format } from "date-fns";

/** Local calendar date "YYYY-MM-DD" `offsetDays` days after `now` in `timeZone`. */
export function localDateString(now: Date, timeZone: string, offsetDays = 0): string {
  const zone = tz(timeZone);
  return format(addDays(now, offsetDays, { in: zone }), "yyyy-MM-dd", { in: zone });
}
