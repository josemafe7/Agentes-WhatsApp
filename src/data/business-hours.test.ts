import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, businessHours, closures } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { AuthError, NotFoundError, ValidationError } from "@/server/errors";
import { actorFor, createBusiness } from "@/test/factories";
import {
  addClosure,
  deleteClosure,
  getBusinessHours,
  listClosures,
  loadBusinessHours,
  minutesToTime,
  replaceBusinessHours,
  timeToMinutes,
} from "./business-hours";

const owner = actorFor("owner");
const admin = actorFor("admin");
const denied: Role[] = ["supervisor", "agent", "viewer"];

beforeEach(async () => {
  await createBusiness();
  await db.delete(businessHours);
  await db.delete(closures);
});

describe("time helpers", () => {
  it("converts HH:MM to local minutes and back; 00:00 as an end means midnight", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("00:00", { end: true })).toBe(1440);
    expect(timeToMinutes("24:00", { end: true })).toBe(1440);
    expect(timeToMinutes("25:00")).toBeNull();
    expect(timeToMinutes("9:30")).toBeNull();
    expect(minutesToTime(570)).toBe("09:30");
    expect(minutesToTime(1440)).toBe("00:00");
  });
});

describe("Ajustes › Horario: weekly hours [AJU-03] [AJU-15]", () => {
  const splitShift = {
    ranges: [
      { weekday: 1, start: "16:00", end: "20:00" },
      { weekday: 1, start: "09:00", end: "13:30" },
      { weekday: 2, start: "09:00", end: "13:30" },
      { weekday: 5, start: "20:00", end: "00:00" },
    ],
  };

  it("saves several ranges per day and returns them in order", async () => {
    await replaceBusinessHours(owner, splitShift);
    expect(await getBusinessHours(admin)).toEqual([
      { weekday: 1, start: "09:00", end: "13:30" },
      { weekday: 1, start: "16:00", end: "20:00" },
      { weekday: 2, start: "09:00", end: "13:30" },
      { weekday: 5, start: "20:00", end: "00:00" },
    ]);
    expect(await loadBusinessHours()).toContainEqual({ weekday: 5, startMin: 1200, endMin: 1440 });
    expect((await db.select().from(auditLog)).map((entry) => entry.action)).toContain("settings.hours_updated");
  });

  it("replaces the whole week: days left out are closed", async () => {
    await replaceBusinessHours(owner, splitShift);
    await replaceBusinessHours(owner, { ranges: [{ weekday: 3, start: "10:00", end: "14:00" }] });
    expect(await getBusinessHours(owner)).toEqual([{ weekday: 3, start: "10:00", end: "14:00" }]);
    await replaceBusinessHours(owner, { ranges: [] });
    expect(await getBusinessHours(owner)).toEqual([]);
  });

  it("explains each wrong day next to that day and saves nothing", async () => {
    await replaceBusinessHours(owner, splitShift);
    const error = await replaceBusinessHours(owner, {
      ranges: [
        { weekday: 1, start: "09:00", end: "14:00" },
        { weekday: 1, start: "13:00", end: "17:00" },
        { weekday: 3, start: "18:00", end: "10:00" },
        { weekday: 4, start: "9h", end: "12:00" },
        { weekday: 6, start: "10:00", end: "10:00" },
      ],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    const fieldErrors = (error as ValidationError).fieldErrors ?? {};
    expect(Object.keys(fieldErrors).sort()).toEqual(["day-1", "day-3", "day-4", "day-6"]);
    expect(fieldErrors["day-1"]?.[0]).toBe("Los tramos del lunes se solapan.");
    expect(fieldErrors["day-3"]?.[0]).toBe("La hora de fin tiene que ser posterior a la de inicio.");
    expect(fieldErrors["day-4"]?.[0]).toBe("Escribe las horas como 09:30.");
    expect(await getBusinessHours(owner)).toHaveLength(4);
  });

  it("rejects unknown weekdays and too many ranges", async () => {
    await expect(replaceBusinessHours(owner, { ranges: [{ weekday: 8, start: "09:00", end: "10:00" }] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const many = Array.from({ length: 7 }, (_, i) => ({
      weekday: 2,
      start: `${String(8 + i).padStart(2, "0")}:00`,
      end: `${String(8 + i).padStart(2, "0")}:30`,
    }));
    const error = await replaceBusinessHours(owner, { ranges: many }).catch((e: unknown) => e);
    expect((error as ValidationError).fieldErrors?.["day-2"]?.[0]).toBe("Como mucho 6 tramos por día.");
  });

  it.each(denied)("%s cannot read or change the hours [PER-03] [PER-04]", async (role) => {
    await replaceBusinessHours(owner, splitShift);
    await expect(getBusinessHours(actorFor(role))).rejects.toBeInstanceOf(AuthError);
    await expect(replaceBusinessHours(actorFor(role), { ranges: [] })).rejects.toBeInstanceOf(AuthError);
    expect(await getBusinessHours(owner)).toHaveLength(4);
  });
});

describe("Ajustes › Horario: holidays and closures [AJU-03]", () => {
  it("adds a closure with its reason (one day or several) and lists them by date", async () => {
    await addClosure(owner, { startDate: "2026-12-24", endDate: "2026-12-26", reason: "Navidad" });
    await addClosure(admin, { startDate: "2026-10-12", endDate: "", reason: "" });
    const list = await listClosures(owner);
    expect(list.map(({ startDate, endDate, reason }) => ({ startDate, endDate, reason }))).toEqual([
      { startDate: "2026-10-12", endDate: "2026-10-12", reason: null },
      { startDate: "2026-12-24", endDate: "2026-12-26", reason: "Navidad" },
    ]);
    expect((await db.select().from(auditLog)).map((entry) => entry.action)).toContain("settings.closure_added");
  });

  it("rejects impossible dates and an end before the start, with the error next to the field", async () => {
    const wrongDate = await addClosure(owner, { startDate: "2026-02-30", endDate: "" }).catch((e: unknown) => e);
    expect((wrongDate as ValidationError).fieldErrors?.startDate?.[0]).toBe("Elige una fecha válida.");
    const reversed = await addClosure(owner, { startDate: "2026-12-26", endDate: "2026-12-24" }).catch((e: unknown) => e);
    expect((reversed as ValidationError).fieldErrors?.endDate?.[0]).toBe("La fecha de fin no puede ser anterior a la de inicio.");
    const tooLong = await addClosure(owner, { startDate: "2026-01-01", endDate: "2027-06-01" }).catch((e: unknown) => e);
    expect((tooLong as ValidationError).fieldErrors?.endDate?.[0]).toBe("Un cierre puede durar como mucho un año.");
    expect(await listClosures(owner)).toEqual([]);
  });

  it("deletes a closure; an unknown one is «not found»", async () => {
    await addClosure(owner, { startDate: "2026-08-15", reason: "Festivo" });
    const [closure] = await listClosures(owner);
    await deleteClosure(admin, { closureId: closure.id });
    expect(await listClosures(owner)).toEqual([]);
    await expect(deleteClosure(owner, { closureId: closure.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it.each(denied)("%s cannot list, add or delete closures [PER-03] [PER-04]", async (role) => {
    await addClosure(owner, { startDate: "2026-08-15", reason: "Festivo" });
    const [closure] = await listClosures(owner);
    await expect(listClosures(actorFor(role))).rejects.toBeInstanceOf(AuthError);
    await expect(addClosure(actorFor(role), { startDate: "2026-09-01" })).rejects.toBeInstanceOf(AuthError);
    await expect(deleteClosure(actorFor(role), { closureId: closure.id })).rejects.toBeInstanceOf(AuthError);
    expect(await listClosures(owner)).toHaveLength(1);
  });
});
