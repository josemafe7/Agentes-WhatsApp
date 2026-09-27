// What the availability engine needs, read from the database with the given executor (inside a booking's
// transaction, the transaction itself, so the re-check sees the latest committed state, [AGD-13]). System reads:
// callers check permissions. Only the columns the engine uses are selected.
import "server-only";
import { and, asc, eq, gt, gte, inArray, lt, lte } from "drizzle-orm";
import { loadBusinessSettings } from "@/data/settings";
import { db, type Executor } from "@/db";
import { bookings, businessHours, closures, resources, resourceSchedules, resourceTimeOff, serviceResources, services } from "@/db/schema";
import type { Terminology } from "@/db/schema";
import type { AgendaMode } from "@/lib/enums";
import { DEFAULT_TIMEZONE, isValidTimeZone } from "@/lib/format";
import { type AvailabilityBooking, type AvailabilityResource, type AvailabilityService, OCCUPYING_STATUSES, type WeeklyRange } from "./availability";
import { addDays, DAY_MS, instantToLocal } from "./time";

export type AgendaSettingsSnapshot = {
  timezone: string;
  mode: AgendaMode;
  /** Slot step in minutes ([AGD-08]). */
  stepMinutes: number;
  terminology: Terminology;
  businessName: string;
};

/** Business time zone (a valid one, Europe/Madrid otherwise), agenda mode, slot step and words. */
export async function loadAgendaSettings(executor: Executor = db): Promise<AgendaSettingsSnapshot> {
  const settings = await loadBusinessSettings(executor);
  return {
    timezone: isValidTimeZone(settings.timezone) ? settings.timezone : DEFAULT_TIMEZONE,
    mode: settings.agendaMode,
    stepMinutes: settings.slotIntervalMin > 0 ? settings.slotIntervalMin : 15,
    terminology: settings.terminology,
    businessName: settings.name,
  };
}

export const serviceColumns = {
  id: services.id,
  name: services.name,
  category: services.category,
  durationMin: services.durationMin,
  bufferBeforeMin: services.bufferBeforeMin,
  bufferAfterMin: services.bufferAfterMin,
  price: services.price,
  descriptionForAgent: services.descriptionForAgent,
  minPeople: services.minPeople,
  maxPeople: services.maxPeople,
  minAdvanceMin: services.minAdvanceMin,
  maxAdvanceDays: services.maxAdvanceDays,
  requiresManualConfirmation: services.requiresManualConfirmation,
  active: services.active,
  sortOrder: services.sortOrder,
};
export type ServiceRow = Pick<typeof services.$inferSelect, keyof typeof serviceColumns>;

export type LoadedService = { row: ServiceRow; engine: AvailabilityService };

/** Engine view of a service row and the resources linked to it. */
export function toEngineService(row: ServiceRow, resourceIds: readonly string[]): AvailabilityService {
  return {
    id: row.id,
    durationMin: row.durationMin,
    bufferBeforeMin: row.bufferBeforeMin,
    bufferAfterMin: row.bufferAfterMin,
    minPeople: row.minPeople,
    maxPeople: row.maxPeople,
    minAdvanceMin: row.minAdvanceMin,
    maxAdvanceDays: row.maxAdvanceDays,
    active: row.active,
    resourceIds,
  };
}

/** Service ids → the resources that do each one, in display order. */
export async function loadServiceResourceIds(executor: Executor, serviceIds: readonly string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>(serviceIds.map((id) => [id, []]));
  if (serviceIds.length === 0) return result;
  const rows = await executor
    .select({ serviceId: serviceResources.serviceId, resourceId: serviceResources.resourceId })
    .from(serviceResources)
    .innerJoin(resources, eq(resources.id, serviceResources.resourceId))
    .where(inArray(serviceResources.serviceId, [...serviceIds]))
    .orderBy(asc(resources.sortOrder), asc(resources.name));
  for (const row of rows) result.get(row.serviceId)?.push(row.resourceId);
  return result;
}

export async function loadService(executor: Executor, serviceId: string): Promise<LoadedService | null> {
  const [row] = await executor.select(serviceColumns).from(services).where(eq(services.id, serviceId));
  if (!row) return null;
  const resourceIds = (await loadServiceResourceIds(executor, [row.id])).get(row.id) ?? [];
  return { row, engine: toEngineService(row, resourceIds) };
}

export type EngineData = {
  resources: AvailabilityResource[];
  bookings: AvailabilityBooking[];
  businessHours: WeeklyRange[];
  closures: { startDate: string; endDate: string }[];
};

/** Margin around the range for absences, blocks and bookings: longer than any service plus its margins. */
const WINDOW_MARGIN_MS = 2 * DAY_MS;

/** Resources (with schedules and time off), occupying bookings, business hours and closures around [from, to). */
export async function loadEngineData(
  executor: Executor,
  params: { resourceIds: readonly string[]; from: Date; to: Date; timezone: string },
): Promise<EngineData> {
  const windowStart = new Date(params.from.getTime() - WINDOW_MARGIN_MS);
  const windowEnd = new Date(params.to.getTime() + WINDOW_MARGIN_MS);
  const firstDay = addDays(instantToLocal(windowStart, params.timezone).date, -1);
  const lastDay = addDays(instantToLocal(windowEnd, params.timezone).date, 1);
  const ids = [...params.resourceIds];
  const [resourceRows, scheduleRows, timeOffRows, bookingRows, hours, closureRows] = await Promise.all([
    ids.length
      ? executor
          .select({ id: resources.id, capacity: resources.capacity, active: resources.active })
          .from(resources)
          .where(inArray(resources.id, ids))
          .orderBy(asc(resources.sortOrder), asc(resources.name))
      : Promise.resolve([]),
    ids.length
      ? executor
          .select({ resourceId: resourceSchedules.resourceId, weekday: resourceSchedules.weekday, startMin: resourceSchedules.startMin, endMin: resourceSchedules.endMin })
          .from(resourceSchedules)
          .where(inArray(resourceSchedules.resourceId, ids))
      : Promise.resolve([]),
    ids.length
      ? executor
          .select({ resourceId: resourceTimeOff.resourceId, startsAt: resourceTimeOff.startsAt, endsAt: resourceTimeOff.endsAt })
          .from(resourceTimeOff)
          .where(and(inArray(resourceTimeOff.resourceId, ids), lt(resourceTimeOff.startsAt, windowEnd), gt(resourceTimeOff.endsAt, windowStart)))
      : Promise.resolve([]),
    ids.length
      ? executor
          .select({
            id: bookings.id,
            resourceId: bookings.resourceId,
            blockedStartAt: bookings.blockedStartAt,
            blockedEndAt: bookings.blockedEndAt,
            people: bookings.people,
            status: bookings.status,
          })
          .from(bookings)
          .where(
            and(
              inArray(bookings.resourceId, ids),
              inArray(bookings.status, [...OCCUPYING_STATUSES]),
              lt(bookings.blockedStartAt, windowEnd),
              gt(bookings.blockedEndAt, windowStart),
            ),
          )
      : Promise.resolve([]),
    executor.select({ weekday: businessHours.weekday, startMin: businessHours.startMin, endMin: businessHours.endMin }).from(businessHours),
    executor
      .select({ startDate: closures.startDate, endDate: closures.endDate })
      .from(closures)
      .where(and(lte(closures.startDate, lastDay), gte(closures.endDate, firstDay))),
  ]);
  return {
    resources: resourceRows.map((row) => ({
      ...row,
      schedule: scheduleRows.filter((range) => range.resourceId === row.id),
      timeOff: timeOffRows.filter((off) => off.resourceId === row.id),
    })),
    bookings: bookingRows,
    businessHours: hours,
    closures: closureRows,
  };
}
