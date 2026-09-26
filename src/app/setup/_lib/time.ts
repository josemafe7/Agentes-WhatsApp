// "HH:mm" ⇄ minutes from 00:00 for the hours form (the database keeps local minutes, [AJU-03]).

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "09:30" → 570; "24:00" → 1440 (end of day); anything else → null. */
export function timeToMinutes(value: string): number | null {
  if (value === "24:00") return MINUTES_PER_DAY;
  const match = TIME_PATTERN.exec(value);
  return match ? Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]) : null;
}

/** 570 → "09:30"; 1440 → "24:00". */
export function minutesToTime(minutes: number): string {
  const clamped = Math.min(Math.max(Math.round(minutes), 0), MINUTES_PER_DAY);
  const hours = Math.floor(clamped / MINUTES_PER_HOUR);
  const rest = clamped % MINUTES_PER_HOUR;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
