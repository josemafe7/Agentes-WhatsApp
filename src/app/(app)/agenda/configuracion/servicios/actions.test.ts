// Server Actions of Agenda › Configuración › Servicios called directly ([SEG-04], [PER-01], [AGD-04]).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as null | { session: { id: string }; user: { id: string } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));

import { db } from "@/db";
import { serviceResources, services } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { createHairdresser } from "@/server/booking/test-helpers";
import { createUser } from "@/test/factories";
import { saveServiceAction, setServiceActiveAction } from "./actions";

const signInAs = async (role: Role) => {
  const person = await createUser(role);
  state.session = { session: { id: `s-${person.userId}` }, user: { id: person.userId } };
};

let hair: Awaited<ReturnType<typeof createHairdresser>>;

beforeEach(async () => {
  state.session = null;
  hair = await createHairdresser();
});

const fullService = () => ({
  name: "Mechas",
  category: "Color",
  durationMin: 90,
  bufferBeforeMin: 10,
  bufferAfterMin: 15,
  price: 45.5,
  descriptionForAgent: "Mechas con matiz. Pregunta el largo del pelo.",
  resourceIds: [hair.laura.id],
  minPeople: 1,
  maxPeople: 1,
  minAdvanceMin: 120,
  maxAdvanceDays: 60,
  requiresManualConfirmation: true,
  active: true,
});

describe("saveServiceAction", () => {
  it("[AGD-04] creates a service with every field and the resources that do it", async () => {
    await signInAs("owner");
    const result = await saveServiceAction(fullService());
    expect(result).toMatchObject({ ok: true, message: "Servicio creado." });
    const [row] = await db.select().from(services).where(eq(services.name, "Mechas"));
    expect(row).toMatchObject({
      category: "Color",
      durationMin: 90,
      bufferBeforeMin: 10,
      bufferAfterMin: 15,
      price: 45.5,
      minAdvanceMin: 120,
      maxAdvanceDays: 60,
      requiresManualConfirmation: true,
      active: true,
    });
    const links = await db.select().from(serviceResources).where(eq(serviceResources.serviceId, row.id));
    expect(links.map((link) => link.resourceId)).toEqual([hair.laura.id]);
  });

  it("[AGD-04] edits a service: data and resources replaced, price removed", async () => {
    await signInAs("admin");
    const result = await saveServiceAction({ ...fullService(), serviceId: hair.cut.id, name: "Corte y peinado", price: null, resourceIds: [hair.marta.id], maxAdvanceDays: null });
    expect(result).toMatchObject({ ok: true, message: "Servicio guardado." });
    const [row] = await db.select().from(services).where(eq(services.id, hair.cut.id));
    expect(row).toMatchObject({ name: "Corte y peinado", price: null, maxAdvanceDays: null });
    const links = await db.select().from(serviceResources).where(eq(serviceResources.serviceId, hair.cut.id));
    expect(links.map((link) => link.resourceId)).toEqual([hair.marta.id]);
  });

  it("[AJU-15] refuses wrong values with the error by the field and saves nothing", async () => {
    await signInAs("owner");
    const result = await saveServiceAction({ ...fullService(), name: "", minPeople: 4, maxPeople: 2, price: "veinte" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors?.name).toBeDefined();
      expect(result.fieldErrors?.price).toBeDefined();
    }
    const groups = await saveServiceAction({ ...fullService(), minPeople: 4, maxPeople: 2 });
    expect(groups.ok).toBe(false);
    if (!groups.ok) expect(groups.fieldErrors?.maxPeople).toBeDefined();
    expect(await db.select().from(services).where(eq(services.name, "Mechas"))).toHaveLength(0);
  });

  it("rejects an unknown service id", async () => {
    await signInAs("owner");
    expect(await saveServiceAction({ ...fullService(), serviceId: crypto.randomUUID() })).toMatchObject({ ok: false, error: "No se ha encontrado el servicio." });
    expect((await saveServiceAction({ ...fullService(), serviceId: "x" })).ok).toBe(false);
  });

  it.each<Role>(["supervisor", "agent", "viewer"])("[PER-01] %s cannot create or edit services", async (role) => {
    await signInAs(role);
    expect(await saveServiceAction(fullService())).toEqual({ ok: false, error: "No tienes permiso para hacer esto." });
    expect(await saveServiceAction({ ...fullService(), serviceId: hair.cut.id })).toEqual({ ok: false, error: "No tienes permiso para hacer esto." });
    expect(await db.select().from(services).where(eq(services.name, "Mechas"))).toHaveLength(0);
    const [cut] = await db.select().from(services).where(eq(services.id, hair.cut.id));
    expect(cut.name).toBe("Corte");
  });
});

describe("setServiceActiveAction", () => {
  it("[AGD-04] deactivates and reactivates a service; it is never deleted", async () => {
    await signInAs("owner");
    expect(await setServiceActiveAction({ id: hair.dye.id, active: false })).toEqual({ ok: true, message: "Servicio desactivado." });
    expect((await db.select().from(services).where(eq(services.id, hair.dye.id)))[0].active).toBe(false);
    expect(await setServiceActiveAction({ id: hair.dye.id, active: true })).toEqual({ ok: true, message: "Servicio activado." });
    expect((await db.select().from(services).where(eq(services.id, hair.dye.id)))[0].active).toBe(true);
  });

  it.each<Role>(["supervisor", "agent", "viewer"])("[PER-01] %s cannot deactivate a service", async (role) => {
    await signInAs(role);
    expect((await setServiceActiveAction({ id: hair.dye.id, active: false })).ok).toBe(false);
    expect((await db.select().from(services).where(eq(services.id, hair.dye.id)))[0].active).toBe(true);
  });
});
