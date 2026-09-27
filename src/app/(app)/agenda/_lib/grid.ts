// Geometry of the Agenda time grid ([AGD-16], [AGD-17], [AGD-28]): where each booking goes on the business-local
// wall clock, side by side when they overlap, snapping a dragged time to the slot interval, the hint of a place that
// cannot work and the people per slot of the capacity view. Pure and without server imports: the client grid uses it
// while dragging. Times are minutes after local midnight; the server re-checks every change.

export type MinuteRange = { startMin: number; endMin: number };

const MINUTES_PER_DAY = 1_440;
const HOUR = 60;
/** Grid when the business has no opening hours yet: 09:00–20:00. */
const DEFAULT_OPEN: MinuteRange = { startMin: 9 * HOUR, endMin: 20 * HOUR };

const pad = (value: number) => String(value).padStart(2, "0");

/** "2026-09-28T10:00:00+02:00" → "2026-09-28". */
export function localDateOf(isoLocal: string): string {
  return isoLocal.slice(0, 10);
}

/** "2026-09-28T10:00:00+02:00" → 600. */
export function localMinuteOf(isoLocal: string): number {
  return Number(isoLocal.slice(11, 13)) * HOUR + Number(isoLocal.slice(14, 16));
}

/**
 * The part of a booking shown on `date`, in minutes of that day; null when it does not touch it. On the night the
 * clocks go back the wall-clock end can read earlier than the start (02:45 → 02:15): it is drawn with its real length.
 */
export function dayMinutes(startLocal: string, endLocal: string, date: string): MinuteRange | null {
  const startDate = localDateOf(startLocal);
  const endDate = localDateOf(endLocal);
  if (startDate > date || endDate < date) return null;
  if (startDate !== date) {
    if (endDate !== date) return { startMin: 0, endMin: MINUTES_PER_DAY };
    const endMin = localMinuteOf(endLocal);
    return endMin > 0 ? { startMin: 0, endMin } : null;
  }
  const startMin = localMinuteOf(startLocal);
  if (endDate !== date) return { startMin, endMin: MINUTES_PER_DAY };
  const wallEnd = localMinuteOf(endLocal);
  const realLength = Math.round((Date.parse(endLocal) - Date.parse(startLocal)) / 60_000);
  return { startMin, endMin: Math.min(MINUTES_PER_DAY, wallEnd > startMin ? wallEnd : startMin + Math.max(1, realLength)) };
}

/**
 * Lanes for overlapping items: each group of items that overlap (directly or through others) shares its width;
 * an item takes the first lane free at its start.
 */
export function layoutLanes(items: readonly ({ id: string } & MinuteRange)[]): Map<string, { lane: number; lanes: number }> {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const result = new Map<string, { lane: number; lanes: number }>();
  let group: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;
  const close = () => {
    for (const member of group) result.set(member.id, { lane: member.lane, lanes: laneEnds.length });
    group = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    if (item.startMin >= groupEnd) close();
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else laneEnds[lane] = item.endMin;
    group.push({ id: item.id, lane });
    groupEnd = Math.max(groupEnd, item.endMin);
  }
  close();
  return result;
}

/** First and last minute of the grid: the opening hours and the bookings shown, in whole hours plus one around. */
export function gridBounds(open: readonly MinuteRange[], items: readonly MinuteRange[]): MinuteRange {
  const ranges = [...(open.length ? open : [DEFAULT_OPEN]), ...items];
  const first = Math.min(...ranges.map((range) => range.startMin));
  const last = Math.max(...ranges.map((range) => range.endMin));
  return {
    startMin: Math.max(0, Math.floor(first / HOUR) * HOUR - HOUR),
    endMin: Math.min(MINUTES_PER_DAY, Math.ceil(last / HOUR) * HOUR + HOUR),
  };
}

/** The nearest multiple of the slot interval, within the day. */
export function snapMinutes(minutes: number, step: number): number {
  const snapped = Math.round(minutes / step) * step;
  return Math.min(MINUTES_PER_DAY, Math.max(0, snapped));
}

/** "2026-09-28" + 615 → "2026-09-28T10:15" (midnight at the end of a day is the next day's 00:00). */
export function toLocalDateTime(date: string, minutes: number): string {
  if (minutes >= MINUTES_PER_DAY) {
    const [year, month, day] = date.split("-").map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}T00:00`;
  }
  return `${date}T${pad(Math.floor(minutes / HOUR))}:${pad(minutes % HOUR)}`;
}

/** 545 → "09:05"; 1440 → "24:00". */
export function minutesLabel(minutes: number): string {
  return `${pad(Math.floor(minutes / HOUR))}:${pad(minutes % HOUR)}`;
}

const overlaps = (a: MinuteRange, b: MinuteRange) => a.startMin < b.endMin && b.startMin < a.endMin;

/**
 * Why a place probably cannot take the booking while it is dragged: outside the opening hours, or (one booking per
 * resource) on top of another one. Only a hint: the server decides with the same rules as the AI ([AGD-17]).
 */
export function dropHint(target: MinuteRange, open: readonly MinuteRange[], others: readonly MinuteRange[], exclusive: boolean): string | null {
  if (!open.some((range) => range.startMin <= target.startMin && target.endMin <= range.endMin)) return "Fuera de horario";
  if (exclusive && others.some((other) => overlaps(other, target))) return "Ocupado";
  return null;
}

/** People booked in each slot of [from, to) with any, for «6/8» in the capacity view ([AGD-11]). */
export function occupancy(items: readonly (MinuteRange & { people: number })[], from: number, to: number, step: number): { startMin: number; people: number }[] {
  const result: { startMin: number; people: number }[] = [];
  for (let start = from; start < to; start += step) {
    const slot = { startMin: start, endMin: start + step };
    const people = items.filter((item) => overlaps(item, slot)).reduce((sum, item) => sum + item.people, 0);
    if (people > 0) result.push({ startMin: start, people });
  }
  return result;
}
