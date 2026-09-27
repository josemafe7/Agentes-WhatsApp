// Free slots of the availability engine as the booking dialog shows them ([AGD-08], [AGD-13], [AGD-17]): the value
// sent back is the exact local time with its offset, so the two 02:30 of the night the clocks go back stay two
// different choices and each comes back to its own instant ([AGD-10]).
import type { AvailableSlot } from "@/server/booking";
import { bookingDayText } from "@/server/booking/format";
import { isRepeatedLocalTime, localToInstant } from "@/server/booking/time";
import { localDateOf, localMinuteOf } from "./grid";

export type SlotOption = {
  /** "2026-09-29T10:00:00+02:00": what the server receives as the start. */
  value: string;
  date: string;
  time: string;
  /** «10:00», or «02:30 (antes del cambio de hora)» on the night the clocks go back. */
  label: string;
  /** «martes 29 de septiembre». */
  dayLabel: string;
  resourceIds: string[];
  /** Places left (capacity mode) or free resources. */
  remaining: number;
};

export function toSlotOptions(slots: readonly AvailableSlot[], timezone: string): SlotOption[] {
  return slots.map((slot) => {
    const date = localDateOf(slot.startLocal);
    const minutes = localMinuteOf(slot.startLocal);
    const time = slot.startLocal.slice(11, 16);
    let label = time;
    if (isRepeatedLocalTime(date, minutes, timezone)) {
      const first = localToInstant(date, minutes, timezone, "earlier").getTime() === slot.start.getTime();
      label = `${time} (${first ? "antes" : "después"} del cambio de hora)`;
    }
    return { value: slot.startLocal, date, time, label, dayLabel: bookingDayText(slot.start, timezone), resourceIds: [...slot.resourceIds], remaining: slot.remaining };
  });
}
