// Geometry of the Agenda time grid ([AGD-16], [AGD-17], [AGD-28]–[AGD-30]): where each booking goes on the
// business-local wall clock, side by side when they overlap (three at most in the week, the rest behind «+N»), the
// hours the grid covers and the closed stretches folded into a narrow band, how minutes turn into height and back,
// snapping a dragged time to the slot interval, the hint of a place that cannot work, the people per slot of the
// capacity view and the rows of a booking shortened at whole words. Pure and without server imports: the client grid
// uses it while dragging. Times are minutes after local midnight; the server re-checks every change.

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

type LaneGroup<T> = { members: { item: T; lane: number }[]; lanes: number };

/** Groups of items that overlap (directly or through others); an item takes the first lane free at its start. */
function laneGroups<T extends { id: string } & MinuteRange>(items: readonly T[]): LaneGroup<T>[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const groups: LaneGroup<T>[] = [];
  let members: { item: T; lane: number }[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;
  const close = () => {
    if (members.length) groups.push({ members, lanes: laneEnds.length });
    members = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    if (item.startMin >= groupEnd) close();
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else laneEnds[lane] = item.endMin;
    members.push({ item, lane });
    groupEnd = Math.max(groupEnd, item.endMin);
  }
  close();
  return groups;
}

/** Lanes for overlapping items: each group of items that overlap shares its width. */
export function layoutLanes(items: readonly ({ id: string } & MinuteRange)[]): Map<string, { lane: number; lanes: number }> {
  const result = new Map<string, { lane: number; lanes: number }>();
  for (const group of laneGroups(items)) for (const member of group.members) result.set(member.item.id, { lane: member.lane, lanes: group.lanes });
  return result;
}

/** Bookings shown side by side in a day of the week before the rest go behind «+N» ([AGD-29]). */
export const WEEK_MAX_LANES = 3;

export type LaneOverflow = { key: string; startMin: number; endMin: number; ids: string[] };
export type CappedLane = { lane: number; lanes: number; overflow: boolean };

/**
 * [AGD-29] Lanes with a cap: an item that would take a lane past `max` is one more booking at once than fit (its lane
 * is only taken when the ones before are busy at its start), so it goes behind the «+N» of its group, which spans the
 * hidden ones. The items shown in a group with «+N» leave room for it.
 */
export function layoutCappedLanes(items: readonly ({ id: string } & MinuteRange)[], max: number): { lanes: Map<string, CappedLane>; overflow: LaneOverflow[] } {
  const lanes = new Map<string, CappedLane>();
  const overflow: LaneOverflow[] = [];
  for (const group of laneGroups(items)) {
    const hidden = group.members.filter((member) => member.lane >= max).map((member) => member.item);
    const shown = Math.min(group.lanes, max);
    for (const member of group.members) {
      if (member.lane < max) lanes.set(member.item.id, { lane: member.lane, lanes: shown, overflow: hidden.length > 0 });
    }
    if (hidden.length) {
      overflow.push({
        key: `${hidden[0].id}:more`,
        startMin: Math.min(...hidden.map((item) => item.startMin)),
        endMin: Math.max(...hidden.map((item) => item.endMin)),
        ids: hidden.map((item) => item.id),
      });
    }
  }
  return { lanes, overflow };
}

/**
 * [AGD-30] First and last minute of the grid: from the first opening to the last closing of the days shown (no
 * margin), widened only for a booking outside them, so none is hidden. Absences and blocks never widen it.
 */
export function gridBounds(open: readonly MinuteRange[], bookings: readonly MinuteRange[]): MinuteRange {
  const ranges = [...(open.length ? open : [DEFAULT_OPEN]), ...bookings];
  return {
    startMin: Math.max(0, Math.min(...ranges.map((range) => range.startMin))),
    endMin: Math.min(MINUTES_PER_DAY, Math.max(...ranges.map((range) => range.endMin))),
  };
}

export type GridFold = MinuteRange & { label: string };

/** A closed stretch shorter than this is not worth folding: the band would take about as much room. */
const MIN_FOLD_MINUTES = 45;

/**
 * [AGD-30] Stretches folded into a narrow band: inside the grid, closed on every column shown (a day closed all day is
 * closed then too), at least `MIN_FOLD_MINUTES` long and with no booking, block or absence drawn in them.
 */
export function foldedStretches(
  columns: readonly { open: readonly MinuteRange[] }[],
  bounds: MinuteRange,
  bookings: readonly MinuteRange[],
  timeOff: readonly MinuteRange[],
): GridFold[] {
  const open = columns
    .flatMap((column) => column.open)
    .map((range) => ({ ...range }))
    .sort((a, b) => a.startMin - b.startMin);
  const gaps: MinuteRange[] = [];
  let cursor = bounds.startMin;
  for (const range of open) {
    if (range.startMin > cursor) gaps.push({ startMin: cursor, endMin: Math.min(range.startMin, bounds.endMin) });
    cursor = Math.max(cursor, range.endMin);
  }
  return gaps
    .filter((gap) => gap.startMin > bounds.startMin && gap.endMin < bounds.endMin && gap.endMin - gap.startMin >= MIN_FOLD_MINUTES)
    .filter((gap) => ![...bookings, ...timeOff].some((item) => overlaps(item, gap)))
    .map((gap) => ({ ...gap, label: `Cerrado de ${minutesLabel(gap.startMin)} a ${minutesLabel(gap.endMin)}` }));
}

export type GridScale = {
  bounds: MinuteRange;
  folds: readonly GridFold[];
  height: number;
  /** Pixels from the top of the grid of a minute of the day (inside a fold, its band). */
  toY: (minutes: number) => number;
  /** The minute at a height: inside a band, the fold's start in its upper half and its end in the lower one. */
  toMinute: (y: number) => number;
  /** The fold whose band is at that height, if any. */
  foldAt: (y: number) => GridFold | null;
};

/** [AGD-30] Height of the grid with its folds: linear (`pxPerMin`) inside the open parts, `foldPx` per fold. */
export function gridScale(bounds: MinuteRange, folds: readonly GridFold[], pxPerMin: number, foldPx: number): GridScale {
  const sorted = [...folds].sort((a, b) => a.startMin - b.startMin);
  // Each fold with the height where its band starts.
  const bands = sorted.map((fold, index) => {
    const before = sorted.slice(0, index).reduce((sum, other) => sum + (other.endMin - other.startMin) * pxPerMin - foldPx, 0);
    return { fold, top: (fold.startMin - bounds.startMin) * pxPerMin - before };
  });
  const removed = sorted.reduce((sum, fold) => sum + (fold.endMin - fold.startMin) * pxPerMin - foldPx, 0);
  const height = (bounds.endMin - bounds.startMin) * pxPerMin - removed;
  const toY = (minutes: number) => {
    const clamped = Math.min(Math.max(minutes, bounds.startMin), bounds.endMin);
    let y = (clamped - bounds.startMin) * pxPerMin;
    for (const { fold, top } of bands) {
      if (clamped >= fold.endMin) y -= (fold.endMin - fold.startMin) * pxPerMin - foldPx;
      else if (clamped > fold.startMin) return top + ((clamped - fold.startMin) / (fold.endMin - fold.startMin)) * foldPx;
    }
    return y;
  };
  const foldAt = (y: number) => bands.find(({ top }) => y >= top && y < top + foldPx)?.fold ?? null;
  const toMinute = (y: number) => {
    let offset = 0;
    for (const { fold, top } of bands) {
      if (y < top) break;
      if (y < top + foldPx) return y - top < foldPx / 2 ? fold.startMin : fold.endMin;
      offset += (fold.endMin - fold.startMin) * pxPerMin - foldPx;
    }
    return Math.min(bounds.endMin, Math.max(bounds.startMin, bounds.startMin + (y + offset) / pxPerMin));
  };
  return { bounds, folds: sorted, height, toY, toMinute, foldAt };
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

/** `prefix` and as many whole words of `name` as fit, ended in «…» when some are left out; null if not even one. */
function fitName(prefix: string, name: string, fits: (candidate: string) => boolean): string | null {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (fits(`${prefix}${words.join(" ")}`)) return `${prefix}${words.join(" ")}`;
  for (let count = words.length - 1; count >= 1; count -= 1) {
    const candidate = `${prefix}${words.slice(0, count).join(" ")}…`;
    if (fits(candidate)) return candidate;
  }
  return null;
}

export type BookingCardText = {
  /** Lines of text the card has room for. */
  lines: number;
  fits: (text: string) => boolean;
  time: string;
  timeRange: string;
  who: string;
  /** Service and professional («Sesión · Álvaro»), or just the service when the column already says who. */
  service: string;
  serviceOnly: string;
};

/**
 * [AGD-29] The rows of a booking on the grid: its time, the customer's name and the service, and the professional if
 * it fits. When everything does not fit, the time and the first name, ended in «…» at a whole word (one under the
 * other if they do not fit side by side); with one short line and no room for both, the first name, since the hour
 * lines already say the time. Never cut in the middle of a word: what does not fit even as one word is «…» (the
 * whole text is in the booking's tooltip and card).
 */
export function bookingCardRows(card: BookingCardText): string[] {
  const { lines, fits, time, timeRange, who, service, serviceOnly } = card;
  const serviceRow = fits(service) ? service : (fitName("", serviceOnly, fits) ?? "…");
  const name = fitName("", who, fits) ?? "…";
  if (lines >= 3) return [fits(timeRange) ? timeRange : fits(time) ? time : "…", name, serviceRow];
  if (lines === 2) {
    const together = fitName(`${time} `, who, fits);
    return together ? [together, serviceRow] : [fits(time) ? time : "…", name];
  }
  const whole = `${time} ${who} · ${serviceOnly}`;
  if (fits(whole)) return [whole];
  return [fitName(`${time} `, who, fits) ?? fitName("", who, fits) ?? (fits(time) ? time : "…")];
}

