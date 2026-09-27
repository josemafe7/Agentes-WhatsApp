// The availability engine ([AGD-05]–[AGD-12], [HER-05]): a pure function from the agenda's data to the free slots.
// No database, no clock: everything comes in the input, so it is tested exhaustively (DST, capacity, buffers…).
//
// Rules, in the order they are checked:
// - Only an active service with a single kind of resource is offered ([AGD-07]); the group must be within its
//   minimum and maximum and fit in a resource's capacity ([AGD-11]).
// - Slot starts are a grid every `stepMinutes` of elapsed time from each local midnight, so on change-of-time days
//   every real instant is covered once: nonexistent local times never appear and a repeated hour appears twice with
//   its own offset ([AGD-10]).
// - The visible range [start, start + duration) must lie inside the business hours (closures remove whole local
//   days) AND the resource's weekly schedule ([AGD-05]); neither is ever extended by the other.
// - The occupied range [start − buffer before, end + buffer after) must not touch the resource's absences or
//   blocks, and must fit with its bookings ([AGD-09]). Buffers are preparation and clean-up: they may fall just
//   outside opening hours, but they need the resource free.
// - Only pending and confirmed bookings occupy; cancelled, completed and no-show free the slot ([AGD-09]).
// - Individual mode: a resource takes one booking at a time. Capacity mode: the people at the busiest moment plus
//   the new group must not exceed the capacity ([AGD-06], [AGD-11]).
// - Advance: start ≥ now + minimum notice and ≤ now + maximum days ([AGD-09]).
// - «Cualquiera»: a slot is free when any resource that does the service is free ([AGD-12]).
import "server-only";
import type { AgendaMode, BookingStatus } from "@/lib/enums";
import type { ClosureRange, OpeningRange } from "@/lib/opening-hours";
import { addDays, DAY_MS, formatLocalIso, instantToLocal, type LocalDate, localToInstant, MINUTE_MS, MINUTES_PER_DAY, weekdayOf } from "./time";

/** Only these statuses take the slot ([AGD-09]). */
export const OCCUPYING_STATUSES: readonly BookingStatus[] = ["pending", "confirmed"];
/** Longest range one call may scan (a month view with the weeks around it fits). */
export const MAX_RANGE_DAYS = 62;
export const MIN_STEP_MINUTES = 1;
export const ANY_RESOURCE = "any";

export type WeeklyRange = OpeningRange;

export type AvailabilityService = {
  id: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minPeople: number;
  maxPeople: number;
  /** Minimum notice in minutes. */
  minAdvanceMin: number;
  /** Furthest day ahead; null = no limit. */
  maxAdvanceDays: number | null;
  active: boolean;
  /** Resources that can do it (service_resources), as alternatives. */
  resourceIds: readonly string[];
  /** Needs two resources at once (professional and room): prepared, never offered yet ([AGD-07]). */
  needsSecondResource?: boolean;
};

export type AvailabilityResource = {
  id: string;
  capacity: number;
  /** Inactive resources accept no new bookings ([AGD-03]). */
  active: boolean;
  schedule: readonly WeeklyRange[];
  /** Absences and blocked slots ([AGD-02], [AGD-18]). */
  timeOff: readonly { startsAt: Date; endsAt: Date }[];
};

export type AvailabilityBooking = {
  id: string;
  resourceId: string;
  /** Start − buffer before and end + buffer after, as stored. */
  blockedStartAt: Date;
  blockedEndAt: Date;
  people: number;
  status: BookingStatus;
};

export type AvailabilityInput = {
  service: AvailabilityService;
  /** In display order: «cualquiera» assigns the first that fits. */
  resources: readonly AvailabilityResource[];
  bookings: readonly AvailabilityBooking[];
  businessHours: readonly WeeklyRange[];
  closures: readonly ClosureRange[];
  timezone: string;
  mode: AgendaMode;
  /** Slot starts from `from` (included) to `to` (excluded). */
  from: Date;
  to: Date;
  /** A resource id or "any" ([AGD-12]). */
  resourceId: string;
  people: number;
  stepMinutes: number;
  now: Date;
  /** Visible length when a person stretches or shortens a booking; default the service duration. */
  durationMin?: number;
  /** The booking being moved or changed: it does not block itself. */
  excludeBookingId?: string;
  /** Changing a booking without moving it: the advance limits do not apply. */
  ignoreAdvance?: boolean;
  /** Stop after this many slots. */
  limit?: number;
};

export type FreeResource = {
  resourceId: string;
  /** Individual mode: 1 (one booking fits). Capacity mode: seats still free at the busiest moment. */
  remaining: number;
};

export type AvailableSlot = {
  start: Date;
  end: Date;
  /** Business-local time with its offset ("2026-10-25T02:30:00+02:00"). */
  startLocal: string;
  endLocal: string;
  /** Resources free for this slot, in display order. */
  resourceIds: string[];
  /** Individual mode: free resources. Capacity mode: free seats summed over the free resources. */
  remaining: number;
};

/** Why nothing can be offered, whatever the dates. */
export type UnavailableReason = "service_inactive" | "second_resource" | "group_size" | "group_too_large" | "no_resources";

export type AvailabilityResult = { slots: AvailableSlot[]; reason: UnavailableReason | null };

/** Visible and occupied ranges of a booking that starts at `start`. */
export function bookingTimes(
  start: Date,
  service: Pick<AvailabilityService, "durationMin" | "bufferBeforeMin" | "bufferAfterMin">,
  durationMin: number = service.durationMin,
): { startsAt: Date; endsAt: Date; blockedStartAt: Date; blockedEndAt: Date } {
  const endsAt = new Date(start.getTime() + durationMin * MINUTE_MS);
  return {
    startsAt: start,
    endsAt,
    blockedStartAt: new Date(start.getTime() - service.bufferBeforeMin * MINUTE_MS),
    blockedEndAt: new Date(endsAt.getTime() + service.bufferAfterMin * MINUTE_MS),
  };
}

// ─── Intervals (epoch ms, half-open) ─────────────────────────────────────────────────────────────────────

type Interval = { start: number; end: number };

/** Sorted, with overlapping or touching intervals joined. */
function merge(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const result: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (end > start) result.push({ start, end });
    if (a[i].end < b[j].end) i++;
    else j++;
  }
  return result;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;
const contains = (outer: Interval[], inner: Interval) => outer.some((range) => range.start <= inner.start && inner.end <= range.end);

/**
 * Weekly ranges as instants over `days`. The end of a range takes the later of two repeated times, and an edge in a
 * nonexistent time is the instant the clocks jump (src/server/booking/time.ts).
 */
function weeklyIntervals(ranges: readonly WeeklyRange[], days: readonly LocalDate[], timeZone: string, closed?: ReadonlySet<LocalDate>): Interval[] {
  const intervals: Interval[] = [];
  for (const day of days) {
    if (closed?.has(day)) continue;
    const weekday = weekdayOf(day);
    for (const range of ranges) {
      if (range.weekday !== weekday || range.endMin <= range.startMin) continue;
      const start = localToInstant(day, range.startMin, timeZone, "earlier", "clamp").getTime();
      const end =
        range.endMin >= MINUTES_PER_DAY
          ? localToInstant(addDays(day, 1), 0, timeZone, "earlier", "clamp").getTime()
          : localToInstant(day, range.endMin, timeZone, "later", "clamp").getTime();
      intervals.push({ start, end });
    }
  }
  return merge(intervals);
}

function closedDays(closures: readonly ClosureRange[], days: readonly LocalDate[]): Set<LocalDate> {
  return new Set(days.filter((day) => closures.some((closure) => closure.startDate <= day && day <= closure.endDate)));
}

function localDays(from: Date, to: Date, timeZone: string, marginDays: number): LocalDate[] {
  const first = addDays(instantToLocal(from, timeZone).date, -marginDays);
  const last = addDays(instantToLocal(new Date(Math.max(from.getTime(), to.getTime() - 1)), timeZone).date, marginDays);
  const days: LocalDate[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}

// ─── The engine ──────────────────────────────────────────────────────────────────────────────────────────

type PreparedResource = {
  id: string;
  capacity: number;
  working: Interval[];
  timeOff: Interval[];
  bookings: { range: Interval; people: number }[];
};

type Prepared = {
  input: AvailabilityInput;
  durationMs: number;
  beforeMs: number;
  afterMs: number;
  resources: PreparedResource[];
  earliest: number;
  latest: number;
};

function staticReason(input: AvailabilityInput, candidates: readonly AvailabilityResource[]): UnavailableReason | null {
  const { service, people } = input;
  if (!service.active) return "service_inactive";
  if (service.needsSecondResource) return "second_resource";
  if (!Number.isInteger(people) || people < Math.max(1, service.minPeople) || people > service.maxPeople) return "group_size";
  if (candidates.length === 0) return "no_resources";
  if (candidates.every((resource) => people > resource.capacity)) return "group_too_large";
  return null;
}

function validate(input: AvailabilityInput): void {
  const step = input.stepMinutes;
  if (!Number.isInteger(step) || step < MIN_STEP_MINUTES || step > MINUTES_PER_DAY) throw new RangeError("Intervalo de huecos no válido.");
  const duration = input.durationMin ?? input.service.durationMin;
  if (!Number.isInteger(duration) || duration < 1 || duration > MINUTES_PER_DAY) throw new RangeError("Duración no válida.");
  if (input.to.getTime() - input.from.getTime() > (MAX_RANGE_DAYS + 1) * DAY_MS) throw new RangeError("El rango de fechas es demasiado largo.");
}

/** Resources of the service that may take this booking: active, doing the service, and the one asked for. */
function candidateResources(input: AvailabilityInput): AvailabilityResource[] {
  const doing = new Set(input.service.resourceIds);
  return input.resources.filter(
    (resource) => resource.active && doing.has(resource.id) && (input.resourceId === ANY_RESOURCE || resource.id === input.resourceId),
  );
}

function prepare(input: AvailabilityInput, candidates: readonly AvailabilityResource[]): Prepared {
  const { service, timezone } = input;
  const durationMs = (input.durationMin ?? service.durationMin) * MINUTE_MS;
  const beforeMs = service.bufferBeforeMin * MINUTE_MS;
  const afterMs = service.bufferAfterMin * MINUTE_MS;
  // A day either side: a slot near midnight or a range that crosses it still sees its whole working time.
  const days = localDays(input.from, new Date(input.to.getTime() + durationMs), timezone, 1);
  const business = weeklyIntervals(input.businessHours, days, timezone, closedDays(input.closures, days));
  const resources = candidates
    .filter((resource) => input.people <= resource.capacity)
    .map((resource) => ({
      id: resource.id,
      capacity: resource.capacity,
      working: intersect(business, weeklyIntervals(resource.schedule, days, timezone)),
      timeOff: resource.timeOff.map((off) => ({ start: off.startsAt.getTime(), end: off.endsAt.getTime() })),
      bookings: input.bookings
        .filter((booking) => booking.resourceId === resource.id && booking.id !== input.excludeBookingId && OCCUPYING_STATUSES.includes(booking.status))
        .map((booking) => ({ range: { start: booking.blockedStartAt.getTime(), end: booking.blockedEndAt.getTime() }, people: booking.people })),
    }));
  const now = input.now.getTime();
  const earliest = input.ignoreAdvance ? Number.NEGATIVE_INFINITY : now + service.minAdvanceMin * MINUTE_MS;
  const latest = input.ignoreAdvance || service.maxAdvanceDays === null ? Number.POSITIVE_INFINITY : now + service.maxAdvanceDays * DAY_MS;
  return { input, durationMs, beforeMs, afterMs, resources, earliest, latest };
}

/** People at the busiest moment of `range` (a booking's load counts from its occupied start to its occupied end). */
function peakLoad(bookings: PreparedResource["bookings"], range: Interval): number {
  const inside = bookings.filter((booking) => overlaps(booking.range, range));
  // The load only rises when a booking starts: the peak is at the range start or at one of those starts.
  const moments = [range.start, ...inside.map((booking) => booking.range.start).filter((start) => start > range.start)];
  let peak = 0;
  for (const moment of moments) {
    const load = inside.filter((booking) => booking.range.start <= moment && moment < booking.range.end).reduce((sum, booking) => sum + booking.people, 0);
    peak = Math.max(peak, load);
  }
  return peak;
}

function freeResourcesAt(prepared: Prepared, start: number): FreeResource[] {
  const { input, durationMs, beforeMs, afterMs } = prepared;
  if (start < prepared.earliest || start > prepared.latest) return [];
  const visible = { start, end: start + durationMs };
  const occupied = { start: start - beforeMs, end: visible.end + afterMs };
  const free: FreeResource[] = [];
  for (const resource of prepared.resources) {
    if (!contains(resource.working, visible)) continue;
    if (resource.timeOff.some((off) => overlaps(off, occupied))) continue;
    if (input.mode === "individual") {
      if (resource.bookings.some((booking) => overlaps(booking.range, occupied))) continue;
      free.push({ resourceId: resource.id, remaining: 1 });
    } else {
      const load = peakLoad(resource.bookings, occupied);
      if (load + input.people > resource.capacity) continue;
      free.push({ resourceId: resource.id, remaining: resource.capacity - load });
    }
  }
  return free;
}

/** The free slots between `from` and `to` ([AGD-08]). */
export function computeAvailability(input: AvailabilityInput): AvailabilityResult {
  validate(input);
  const candidates = candidateResources(input);
  const reason = staticReason(input, candidates);
  if (reason) return { slots: [], reason };
  const prepared = prepare(input, candidates);
  const { timezone } = input;
  const stepMs = input.stepMinutes * MINUTE_MS;
  const from = input.from.getTime();
  const to = input.to.getTime();
  const limit = input.limit ?? Number.POSITIVE_INFINITY;
  const slots: AvailableSlot[] = [];
  for (const day of localDays(input.from, input.to, timezone, 0)) {
    const dayStart = localToInstant(day, 0, timezone).getTime();
    const dayEnd = localToInstant(addDays(day, 1), 0, timezone).getTime();
    for (let start = dayStart; start < dayEnd; start += stepMs) {
      if (start < from || start >= to) continue;
      const free = freeResourcesAt(prepared, start);
      if (free.length === 0) continue;
      const end = new Date(start + prepared.durationMs);
      slots.push({
        start: new Date(start),
        end,
        startLocal: formatLocalIso(new Date(start), timezone),
        endLocal: formatLocalIso(end, timezone),
        resourceIds: free.map((resource) => resource.resourceId),
        remaining: free.reduce((sum, resource) => sum + resource.remaining, 0),
      });
      if (slots.length >= limit) return { slots, reason: null };
    }
  }
  return { slots, reason: null };
}

/**
 * The resources free for a booking that starts exactly at `input.from` (any minute, not only the grid), best first:
 * in capacity mode the one with the fewest seats left that still fits, so big rooms stay for big groups; otherwise
 * display order. Empty when the slot is not free ([AGD-13]).
 */
export function freeResourcesForStart(input: Omit<AvailabilityInput, "to" | "limit">): { resources: FreeResource[]; reason: UnavailableReason | null } {
  const full: AvailabilityInput = { ...input, to: new Date(input.from.getTime() + 1) };
  validate(full);
  const candidates = candidateResources(full);
  const reason = staticReason(full, candidates);
  if (reason) return { resources: [], reason };
  const free = freeResourcesAt(prepare(full, candidates), input.from.getTime());
  if (input.mode === "capacity") free.sort((a, b) => a.remaining - b.remaining);
  return { resources: free, reason: null };
}

/**
 * Up to `count` slots for the agent to offer ([AGD-21]): spread over the range (the first one, then each next one at
 * least `gapMinutes` later or on another day), topped up with the next free ones when there are fewer; by time.
 */
export function pickSuggestions(slots: readonly AvailableSlot[], timeZone: string, count = 3, gapMinutes = 120): AvailableSlot[] {
  const picked: AvailableSlot[] = [];
  for (const slot of slots) {
    const last = picked[picked.length - 1];
    const otherDay = last && instantToLocal(last.start, timeZone).date !== instantToLocal(slot.start, timeZone).date;
    if (!last || otherDay || slot.start.getTime() - last.start.getTime() >= gapMinutes * MINUTE_MS) picked.push(slot);
    if (picked.length >= count) break;
  }
  for (const slot of slots) {
    if (picked.length >= count) break;
    if (!picked.includes(slot)) picked.push(slot);
  }
  return picked.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** The `count` slots closest in time to `around` (a slot that was just taken), in chronological order ([AGD-13]). */
export function closestSlots(slots: readonly AvailableSlot[], around: Date, count = 3): AvailableSlot[] {
  const target = around.getTime();
  return [...slots]
    .sort((a, b) => Math.abs(a.start.getTime() - target) - Math.abs(b.start.getTime() - target) || a.start.getTime() - b.start.getTime())
    .slice(0, count)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}
