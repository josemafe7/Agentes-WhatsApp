// Server Action of Agenda › Configuración › General called directly ([SEG-04], [PER-01], [AGD-01], [AGD-06], [AGD-08]).
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as null | { session: { id: string }; user: { id: string } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));

import { loadBusinessSettings } from "@/data/settings";
import type { Role } from "@/lib/enums";
import { createHairdresser } from "@/server/booking/test-helpers";
import { createUser } from "@/test/factories";
import { saveAgendaSettingsAction } from "./actions";

const signInAs = async (role: Role) => {
  const person = await createUser(role);
  state.session = { session: { id: `s-${person.userId}` }, user: { id: person.userId } };
};

const RESTAURANT = {
  agendaMode: "capacity",
  slotIntervalMin: 15,
  terminology: { booking: "reserva", bookings: "reservas", resource: "mesa", resources: "mesas", customer: "comensal" },
};

beforeEach(async () => {
  state.session = null;
  await createHairdresser();
});

describe("saveAgendaSettingsAction", () => {
  it.each<Role>(["owner", "admin"])("[AGD-01] [AGD-06] [AGD-08] %s saves the mode, the slot step and the words", async (role) => {
    await signInAs(role);
    expect(await saveAgendaSettingsAction(undefined, RESTAURANT)).toEqual({ ok: true, message: "Configuración guardada." });
    const settings = await loadBusinessSettings();
    expect(settings.agendaMode).toBe("capacity");
    expect(settings.slotIntervalMin).toBe(15);
    expect(settings.terminology).toMatchObject({ booking: "reserva", resource: "mesa", customer: "comensal" });
  });

  it("[AJU-15] refuses a step that is not in the list, with the error by the field", async () => {
    await signInAs("owner");
    const result = await saveAgendaSettingsAction(undefined, { ...RESTAURANT, slotIntervalMin: 7 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.slotIntervalMin).toBeDefined();
    expect((await loadBusinessSettings()).slotIntervalMin).toBe(30);
  });

  it("[AGD-01] refuses words that are not among the options", async () => {
    await signInAs("owner");
    const result = await saveAgendaSettingsAction(undefined, { ...RESTAURANT, terminology: { ...RESTAURANT.terminology, customer: "usuario" } });
    expect(result.ok).toBe(false);
    expect((await loadBusinessSettings()).terminology).toMatchObject({ customer: "cliente" });
  });

  it.each<Role>(["supervisor", "agent", "viewer"])("[PER-01] %s cannot configure the agenda and nothing changes", async (role) => {
    await signInAs(role);
    expect(await saveAgendaSettingsAction(undefined, RESTAURANT)).toEqual({ ok: false, error: "No tienes permiso para hacer esto." });
    const settings = await loadBusinessSettings();
    expect(settings.agendaMode).toBe("individual");
    expect(settings.slotIntervalMin).toBe(30);
  });

  it("[SEG-04] without a session nothing changes", async () => {
    expect((await saveAgendaSettingsAction(undefined, RESTAURANT)).ok).toBe(false);
    expect((await loadBusinessSettings()).agendaMode).toBe("individual");
  });
});
