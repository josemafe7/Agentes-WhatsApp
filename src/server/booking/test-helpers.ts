// Agenda fixtures for Vitest: a hairdresser's week (Monday–Saturday 09:00–14:00 and 16:00–20:00 in Europe/Madrid),
// two professionals and a few services, written through Drizzle like the seed does. Tests pass a fixed `now`
// (Sunday 2026-09-27, 10:00 local) so the dates never expire.
import "server-only";
import { db } from "@/db";
import {
  bookingEvents,
  bookings,
  businessHours,
  closures,
  reminderSettings,
  resources,
  resourceSchedules,
  resourceTimeOff,
  serviceResources,
  services,
} from "@/db/schema";
import type { AgendaMode, ResourceType } from "@/lib/enums";
import { createBusiness } from "@/test/factories";
import { parseLocalDateTime } from "./time";

export const TZ = "Europe/Madrid";
/** Sunday before the test week. */
export const NOW = new Date("2026-09-27T08:00:00Z");

/** Business-local "YYYY-MM-DDTHH:mm" → instant. */
export function at(local: string): Date {
  const instant = parseLocalDateTime(local, TZ);
  if (!instant) throw new Error(`Hora de prueba no válida: ${local}`);
  return instant;
}

const hm = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const weekRanges = (days: number[], ...ranges: [string, string][]) =>
  days.flatMap((weekday) => ranges.map(([start, end]) => ({ weekday, startMin: hm(start), endMin: end === "24:00" ? 1_440 : hm(end) })));

export const OPENING: [string, string][] = [
  ["09:00", "14:00"],
  ["16:00", "20:00"],
];
const MON_SAT = [1, 2, 3, 4, 5, 6];

/** Deletes every agenda row (children first). */
export async function clearAgenda(): Promise<void> {
  await db.delete(bookingEvents);
  await db.delete(bookings);
  await db.delete(resourceTimeOff);
  await db.delete(serviceResources);
  await db.delete(resourceSchedules);
  await db.delete(services);
  await db.delete(resources);
  await db.delete(businessHours);
  await db.delete(closures);
  await db.delete(reminderSettings);
}

export async function addResource(options: { name: string; capacity?: number; type?: ResourceType; active?: boolean; ranges?: [string, string][]; days?: number[]; sortOrder?: number }) {
  const [row] = await db
    .insert(resources)
    .values({ name: options.name, type: options.type ?? "person", capacity: options.capacity ?? 1, active: options.active ?? true, sortOrder: options.sortOrder ?? 0 })
    .returning();
  await db.insert(resourceSchedules).values(weekRanges(options.days ?? MON_SAT, ...(options.ranges ?? OPENING)).map((range) => ({ resourceId: row.id, ...range })));
  return row;
}

export async function addService(resourceIds: string[], overrides: Partial<typeof services.$inferInsert> = {}) {
  const [row] = await db
    .insert(services)
    .values({ name: "Corte", durationMin: 30, minPeople: 1, maxPeople: 1, ...overrides })
    .returning();
  if (resourceIds.length) await db.insert(serviceResources).values(resourceIds.map((resourceId) => ({ serviceId: row.id, resourceId })));
  return row;
}

/** Business (Madrid, 30-minute slots) and its opening hours; clears any earlier agenda. */
export async function createAgendaBusiness(options: { mode?: AgendaMode; step?: number; hours?: [string, string][]; days?: number[] } = {}) {
  await clearAgenda();
  await createBusiness({ timezone: TZ, agendaMode: options.mode ?? "individual", slotIntervalMin: options.step ?? 30, terminology: { booking: "cita", resource: "profesional", customer: "cliente" } });
  await db.insert(businessHours).values(weekRanges(options.days ?? MON_SAT, ...(options.hours ?? OPENING)));
}

/** The hairdresser: Laura and Marta, «Corte» (30 min) by both and «Tinte» (60 min, manual confirmation) by Laura. */
export async function createHairdresser(options: { step?: number } = {}) {
  await createAgendaBusiness({ step: options.step });
  const laura = await addResource({ name: "Laura", sortOrder: 0 });
  const marta = await addResource({ name: "Marta", sortOrder: 1 });
  const cut = await addService([laura.id, marta.id], { name: "Corte", durationMin: 30, price: 18, descriptionForAgent: "Corte con lavado." });
  const dye = await addService([laura.id], { name: "Tinte", durationMin: 60, requiresManualConfirmation: true, sortOrder: 1 });
  return { laura, marta, cut, dye };
}
