import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { resourceTimeOff } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { createHairdresser, NOW } from "@/server/booking/test-helpers";
import { AuthError, NotFoundError, ValidationError } from "@/server/errors";
import { actorFor, createUser, type TestUser } from "@/test/factories";
import { getAvailability } from "./bookings";
import { addResourceTimeOff, listTimeOff, removeResourceTimeOff } from "./bookings-time-off";

const users = {} as Partial<Record<Role, TestUser>>;
let hair: Awaited<ReturnType<typeof createHairdresser>>;

beforeAll(async () => {
  for (const role of ["owner", "supervisor", "viewer"] as const) users[role] = await createUser(role);
});

beforeEach(async () => {
  hair = await createHairdresser();
});

const lauraSlots = async () =>
  (await getAvailability(actorFor("viewer"), { serviceId: hair.cut.id, from: "2026-09-28", to: "2026-09-29", resourceId: hair.laura.id }, { now: NOW })).slots.map((slot) => slot.startLocal.slice(0, 16));

describe("blocks and absences [AGD-18] [AGD-02] «Agenda: bloquear huecos y poner ausencias»", () => {
  it.each(["owner", "supervisor"] as const)("%s blocks a slot: it is no longer offered, it shows on the calendar and can be removed", async (role) => {
    const actor = (users[role] as TestUser).actor;
    const block = await addResourceTimeOff(actor, { resourceId: hair.laura.id, kind: "block", start: "2026-09-28T10:00", end: "2026-09-28T11:00", reason: "Formación" });
    expect(block.overlappingBookings).toBe(0);
    expect(await lauraSlots()).not.toContain("2026-09-28T10:30");
    const [listed] = await listTimeOff(actorFor("viewer"), { from: "2026-09-28", to: "2026-09-28" });
    expect(listed).toMatchObject({ kind: "block", reason: "Formación", resource: { id: hair.laura.id, name: "Laura" }, startLocal: "2026-09-28T10:00:00+02:00", endLocal: "2026-09-28T11:00:00+02:00" });
    await removeResourceTimeOff(actor, { timeOffId: block.id });
    expect(await lauraSlots()).toContain("2026-09-28T10:30");
    await expect(removeResourceTimeOff(actor, { timeOffId: block.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an absence of whole days covers them entirely", async () => {
    await addResourceTimeOff((users.supervisor as TestUser).actor, { resourceId: hair.laura.id, kind: "absence", start: "2026-09-28", end: "2026-09-29", reason: "Vacaciones" });
    expect(await lauraSlots()).toEqual([]);
  });

  it.each(["agent", "viewer"] as const)("%s cannot block nor add absences, nor remove them", async (role) => {
    const actor = role === "viewer" ? (users.viewer as TestUser).actor : actorFor(role);
    await expect(addResourceTimeOff(actor, { resourceId: hair.laura.id, kind: "block", start: "2026-09-28T10:00", end: "2026-09-28T11:00" })).rejects.toBeInstanceOf(AuthError);
    const block = await addResourceTimeOff((users.owner as TestUser).actor, { resourceId: hair.laura.id, kind: "block", start: "2026-09-28T12:00", end: "2026-09-28T13:00" });
    await expect(removeResourceTimeOff(actor, { timeOffId: block.id })).rejects.toBeInstanceOf(AuthError);
    expect(await db.select().from(resourceTimeOff)).toHaveLength(1);
    await db.delete(resourceTimeOff);
  });

  it("refuses wrong times and ranges", async () => {
    const owner = (users.owner as TestUser).actor;
    await expect(addResourceTimeOff(owner, { resourceId: hair.laura.id, kind: "block", start: "2026-09-28T11:00", end: "2026-09-28T10:00" })).rejects.toBeInstanceOf(ValidationError);
    await expect(addResourceTimeOff(owner, { resourceId: hair.laura.id, kind: "block", start: "ayer", end: "2026-09-28T10:00" })).rejects.toBeInstanceOf(ValidationError);
    await expect(addResourceTimeOff(owner, { resourceId: crypto.randomUUID(), kind: "block", start: "2026-09-28T10:00", end: "2026-09-28T11:00" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(listTimeOff(owner, { from: "2026-01-01", to: "2026-12-31" })).rejects.toBeInstanceOf(ValidationError);
  });
});
