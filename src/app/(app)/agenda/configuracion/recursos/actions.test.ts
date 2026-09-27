// Server Actions of Agenda › Configuración › Recursos called directly ([SEG-04], [PER-01], [AGD-02], [AGD-03]).
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as null | { session: { id: string }; user: { id: string } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));

import { db } from "@/db";
import { bookings, resources, resourceSchedules, resourceTimeOff, serviceResources } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { at, createHairdresser } from "@/server/booking/test-helpers";
import { createUser } from "@/test/factories";
import { addAbsenceAction, removeTimeOffAction, saveResourceAction } from "./actions";

const signInAs = async (role: Role) => {
  const person = await createUser(role);
  state.session = { session: { id: `s-${person.userId}` }, user: { id: person.userId } };
};

let hair: Awaited<ReturnType<typeof createHairdresser>>;

beforeEach(async () => {
  state.session = null;
  hair = await createHairdresser();
});

const terrace = () => ({
  type: "table",
  name: "Terraza",
  color: "emerald",
  capacity: 24,
  active: true,
  serviceIds: [hair.cut.id],
  schedule: [
    { weekday: 2, start: "13:00", end: "16:00" },
    { weekday: 2, start: "20:00", end: "23:30" },
    { weekday: 6, start: "13:00", end: "00:00" },
  ],
});

describe("saveResourceAction", () => {
  it("[AGD-02] creates a resource with its type, colour, capacity, services and several ranges a day", async () => {
    await signInAs("owner");
    const result = await saveResourceAction(terrace());
    expect(result).toMatchObject({ ok: true, message: "Recurso creado." });
    if (!result.ok) return;
    const id = result.data?.id ?? "";
    const [row] = await db.select().from(resources).where(eq(resources.id, id));
    expect(row).toMatchObject({ type: "table", name: "Terraza", color: "emerald", capacity: 24, active: true });
    const ranges = await db.select().from(resourceSchedules).where(eq(resourceSchedules.resourceId, id)).orderBy(asc(resourceSchedules.weekday), asc(resourceSchedules.startMin));
    expect(ranges.map(({ weekday, startMin, endMin }) => ({ weekday, startMin, endMin }))).toEqual([
      { weekday: 2, startMin: 780, endMin: 960 },
      { weekday: 2, startMin: 1_200, endMin: 1_410 },
      { weekday: 6, startMin: 780, endMin: 1_440 },
    ]);
    const links = await db.select().from(serviceResources).where(eq(serviceResources.resourceId, id));
    expect(links.map((link) => link.serviceId)).toEqual([hair.cut.id]);
  });

  it("[AGD-02] [AGD-03] edits a resource: schedule replaced, services replaced, deactivated with its bookings kept", async () => {
    await signInAs("admin");
    const [booking] = await db
      .insert(bookings)
      .values({ serviceId: hair.cut.id, resourceId: hair.marta.id, startsAt: at("2026-09-29T10:00"), endsAt: at("2026-09-29T10:30"), blockedStartAt: at("2026-09-29T10:00"), blockedEndAt: at("2026-09-29T10:30"), source: "human" })
      .returning();
    const result = await saveResourceAction({
      resourceId: hair.marta.id,
      type: "person",
      name: "Marta López",
      color: "violet",
      capacity: 1,
      active: false,
      serviceIds: [hair.cut.id, hair.dye.id],
      schedule: [{ weekday: 1, start: "10:00", end: "14:00" }],
    });
    expect(result).toMatchObject({ ok: true, message: "Recurso guardado." });
    const [row] = await db.select().from(resources).where(eq(resources.id, hair.marta.id));
    expect(row).toMatchObject({ name: "Marta López", color: "violet", active: false });
    expect(await db.select().from(resourceSchedules).where(eq(resourceSchedules.resourceId, hair.marta.id))).toHaveLength(1);
    expect(await db.select().from(serviceResources).where(eq(serviceResources.resourceId, hair.marta.id))).toHaveLength(2);
    expect(await db.select().from(bookings).where(eq(bookings.id, booking.id))).toHaveLength(1);
  });

  it("[AJU-15] refuses overlapping ranges and a wrong colour, by the field, and saves nothing", async () => {
    await signInAs("owner");
    const overlapping = await saveResourceAction({ ...terrace(), schedule: [{ weekday: 1, start: "09:00", end: "14:00" }, { weekday: 1, start: "13:00", end: "15:00" }] });
    expect(overlapping.ok).toBe(false);
    if (!overlapping.ok) expect(overlapping.fieldErrors?.["day-1"]).toBeDefined();
    const colour = await saveResourceAction({ ...terrace(), color: "#ff0000" });
    expect(colour.ok).toBe(false);
    if (!colour.ok) expect(colour.fieldErrors?.color).toBeDefined();
    expect(await db.select().from(resources).where(eq(resources.name, "Terraza"))).toHaveLength(0);
  });

  it.each<Role>(["supervisor", "agent", "viewer"])("[PER-01] %s cannot create or edit resources", async (role) => {
    await signInAs(role);
    expect(await saveResourceAction(terrace())).toEqual({ ok: false, error: "No tienes permiso para hacer esto." });
    expect(await saveResourceAction({ ...terrace(), resourceId: hair.laura.id, name: "Otra" })).toEqual({ ok: false, error: "No tienes permiso para hacer esto." });
    expect(await db.select().from(resources).where(eq(resources.name, "Terraza"))).toHaveLength(0);
    expect((await db.select().from(resources).where(eq(resources.id, hair.laura.id)))[0].name).toBe("Laura");
  });
});

describe("absences: addAbsenceAction and removeTimeOffAction", () => {
  const holidays = () => ({ resourceId: hair.laura.id, kind: "absence", start: "2026-10-12", end: "2026-10-16", reason: "Vacaciones" });

  it.each<Role>(["owner", "admin", "supervisor"])("[AGD-02] [PER-01] %s adds whole days of absence and removes them", async (role) => {
    await signInAs(role);
    const added = await addAbsenceAction(holidays());
    expect(added).toMatchObject({ ok: true, message: "Ausencia añadida." });
    const [row] = await db.select().from(resourceTimeOff).where(eq(resourceTimeOff.resourceId, hair.laura.id));
    expect(row).toMatchObject({ kind: "absence", reason: "Vacaciones", startsAt: at("2026-10-12T00:00"), endsAt: at("2026-10-17T00:00") });
    expect(await removeTimeOffAction(row.id)).toEqual({ ok: true, message: "Ausencia quitada." });
    expect(await db.select().from(resourceTimeOff)).toHaveLength(0);
  });

  it("[AGD-09] says how many bookings fall inside; they stay in the agenda", async () => {
    await signInAs("owner");
    await db
      .insert(bookings)
      .values({ serviceId: hair.cut.id, resourceId: hair.laura.id, startsAt: at("2026-10-13T10:00"), endsAt: at("2026-10-13T10:30"), blockedStartAt: at("2026-10-13T10:00"), blockedEndAt: at("2026-10-13T10:30"), source: "human" });
    const added = await addAbsenceAction(holidays());
    expect(added).toMatchObject({ ok: true, data: { overlappingBookings: 1 } });
    expect(await db.select().from(bookings)).toHaveLength(1);
  });

  it("refuses an end before the start", async () => {
    await signInAs("owner");
    const result = await addAbsenceAction({ ...holidays(), start: "2026-10-12T12:00", end: "2026-10-12T10:00" });
    expect(result.ok).toBe(false);
    expect(await db.select().from(resourceTimeOff)).toHaveLength(0);
  });

  it.each<Role>(["agent", "viewer"])("[PER-01] %s cannot add or remove absences", async (role) => {
    const [existing] = await db.insert(resourceTimeOff).values({ resourceId: hair.laura.id, kind: "absence", startsAt: at("2026-11-02T00:00"), endsAt: at("2026-11-03T00:00") }).returning();
    await signInAs(role);
    expect(await addAbsenceAction(holidays())).toEqual({ ok: false, error: "No tienes permiso para hacer esto." });
    expect(await removeTimeOffAction(existing.id)).toEqual({ ok: false, error: "No tienes permiso para hacer esto." });
    expect(await db.select().from(resourceTimeOff)).toHaveLength(1);
  });
});
