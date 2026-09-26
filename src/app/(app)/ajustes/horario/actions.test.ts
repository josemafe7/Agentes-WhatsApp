// Server Actions of Ajustes › Horario called directly ([SEG-04], [PER-01], [AJU-03]).
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as null | { session: { id: string }; user: { id: string } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));

import { db } from "@/db";
import { businessHours, closures } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { createBusiness, createUser } from "@/test/factories";
import { addClosureAction, deleteClosureAction, saveHoursAction } from "./actions";

const signInAs = async (role: Role) => {
  const person = await createUser(role);
  state.session = { session: { id: `s-${person.userId}` }, user: { id: person.userId } };
};

const closureForm = (values: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
};

beforeEach(async () => {
  state.session = null;
  await createBusiness();
  await db.delete(businessHours);
  await db.delete(closures);
});

describe("saveHoursAction", () => {
  it("saves the week for the owner", async () => {
    await signInAs("owner");
    const result = await saveHoursAction(undefined, { ranges: [{ weekday: 1, start: "09:00", end: "14:00" }] });
    expect(result).toEqual({ ok: true, message: "Horario guardado." });
    expect(await db.select().from(businessHours)).toHaveLength(1);
  });

  it("returns the error of each day", async () => {
    await signInAs("admin");
    const result = await saveHoursAction(undefined, { ranges: [{ weekday: 2, start: "14:00", end: "09:00" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.["day-2"]).toBeDefined();
  });

  it.each<Role>(["supervisor", "agent", "viewer"])("%s cannot change the hours [PER-03] [PER-04]", async (role) => {
    await signInAs(role);
    const result = await saveHoursAction(undefined, { ranges: [{ weekday: 1, start: "09:00", end: "14:00" }] });
    expect(result).toEqual({ ok: false, error: "No tienes permiso para hacer esto." });
    expect(await db.select().from(businessHours)).toHaveLength(0);
  });
});

describe("addClosureAction / deleteClosureAction", () => {
  it("adds and deletes a closure", async () => {
    await signInAs("owner");
    const added = await addClosureAction(undefined, closureForm({ startDate: "2026-12-25", endDate: "", reason: "Navidad" }));
    expect(added).toEqual({ ok: true, message: "Cierre añadido." });
    const [row] = await db.select().from(closures);
    expect(row).toMatchObject({ startDate: "2026-12-25", endDate: "2026-12-25", reason: "Navidad" });
    expect(await deleteClosureAction(row.id)).toEqual({ ok: true, message: "Cierre borrado." });
    expect(await db.select().from(closures)).toHaveLength(0);
  });

  it("rejects a malformed id", async () => {
    await signInAs("owner");
    expect((await deleteClosureAction({ id: "x" } as unknown as string)).ok).toBe(false);
  });

  it.each<Role>(["supervisor", "agent", "viewer"])("%s cannot add or delete closures", async (role) => {
    await db.insert(closures).values({ startDate: "2026-08-15", endDate: "2026-08-15" });
    const [row] = await db.select().from(closures);
    await signInAs(role);
    expect((await addClosureAction(undefined, closureForm({ startDate: "2026-12-25" }))).ok).toBe(false);
    expect((await deleteClosureAction(row.id)).ok).toBe(false);
    expect(await db.select().from(closures)).toHaveLength(1);
  });
});
