// Free slots as the «Nueva cita» dialog offers them ([AGD-08], [AGD-10], [AGD-28]): one business-local day at a time,
// each slot with the exact text the booking is created with (formatLocalMinute: the offset only when that time
// happens twice), and the repeated hour of the change of time told apart so no time is lost or duplicated.
import "server-only";
import { bookingDayText, formatLocalMinute, instantToLocal, localToInstant } from "@/server/booking";

export type SlotChoice = {
  /** What «Crear» sends back: "2026-09-28T10:00" (or "2026-10-25T02:30+02:00" for a repeated time). */
  value: string;
  /** Business-local day, "YYYY-MM-DD". */
  date: string;
  /** «lunes 28 de septiembre». */
  dayLabel: string;
  /** «10:00». */
  time: string;
  /** Only the day clocks go back: which of the two equal times this is. */
  note: string | null;
};

/** "YYYY-MM-DDTHH:mm": longer only when the offset was added for a repeated time. */
const PLAIN_LENGTH = 16;

/** One free slot (or an alternative after a taken one) in the business's time zone. */
export function slotChoice(start: Date, timeZone: string): SlotChoice {
  const value = formatLocalMinute(start, timeZone);
  const date = value.slice(0, 10);
  let note: string | null = null;
  if (value.length > PLAIN_LENGTH) {
    const first = localToInstant(date, instantToLocal(start, timeZone).minutes, timeZone, "earlier");
    note = first.getTime() === start.getTime() ? "antes del cambio de hora" : "después del cambio de hora";
  }
  return { value, date, dayLabel: bookingDayText(start, timeZone), time: value.slice(11, PLAIN_LENGTH), note };
}

export type NextFreeDay = { date: string; dayLabel: string };

/** The chosen day's slots, in order, and the first later day that has any (to jump to it when this one is full). */
export function daySlots(slots: readonly { start: Date }[], date: string, timeZone: string): { slots: SlotChoice[]; next: NextFreeDay | null } {
  const choices = slots.map((slot) => slotChoice(slot.start, timeZone));
  const later = choices.find((choice) => choice.date > date);
  return { slots: choices.filter((choice) => choice.date === date), next: later ? { date: later.date, dayLabel: later.dayLabel } : null };
}
