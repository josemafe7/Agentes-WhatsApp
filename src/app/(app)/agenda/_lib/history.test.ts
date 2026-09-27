import { describe, expect, it } from "vitest";
import { historyLines } from "./history";
import { agendaWords } from "./labels";

const TZ = "Europe/Madrid";
const LAURA = "0b6f2c3e-1111-4c1c-9a55-6a4f0f0b3a2d";
const MARTA = "0b6f2c3e-2222-4c1c-9a55-6a4f0f0b3a2d";
const words = agendaWords({ booking: "cita", bookings: "citas", resource: "profesional", resources: "profesionales", customer: "cliente" });
const context = { timezone: TZ, resourceNames: new Map([[LAURA, "Laura"], [MARTA, "Marta"]]), words };
const at = new Date("2026-09-27T08:05:00Z");

const item = (action: string, changes: Record<string, unknown>, actor: { actorType: "user" | "ai" | "contact" | "system"; actorName: string | null } = { actorType: "user", actorName: "Ana" }) => ({
  id: crypto.randomUUID(),
  action,
  ...actor,
  changes,
  createdAt: at,
});

describe("Agenda: a booking's history in plain Spanish — who, what and when [AGD-15]", () => {
  it("says who did it: a person, the AI with its agent, the customer or the app", () => {
    const [person, ai, customer, app] = historyLines(
      [
        item("created", { status: "confirmed", source: "human" }),
        item("created", { status: "pending", source: "ai" }, { actorType: "ai", actorName: "Recepción" }),
        item("cancelled", { status: { from: "confirmed", to: "cancelled" } }, { actorType: "contact", actorName: null }),
        item("reminder_sent", { channel: "email" }, { actorType: "system", actorName: null }),
      ],
      context,
    );
    expect(person).toMatchObject({ who: "Ana", what: "Creada · confirmada", when: "27 sep 2026, 10:05" });
    expect(ai).toMatchObject({ who: "IA · Recepción", what: "Creada · pendiente" });
    expect(customer).toMatchObject({ who: "El cliente", what: "Cancelada" });
    expect(app).toMatchObject({ who: "La app", what: "Recordatorio enviado" });
  });

  it("describes moves, changes of resource, length, people, fields and status", () => {
    const [moved, changed, status, notice, failed] = historyLines(
      [
        item("moved", {
          startsAt: { from: "2026-09-28T08:00:00.000Z", to: "2026-09-28T09:00:00.000Z" },
          resourceId: { from: LAURA, to: MARTA },
        }),
        item("updated", { endsAt: { from: "2026-09-28T09:30:00.000Z", to: "2026-09-28T10:00:00.000Z" }, people: { from: 2, to: 4 }, fields: ["notes", "contactName"] }),
        item("status_changed", { status: { from: "pending", to: "confirmed" } }),
        item("notice_sent", { kind: "moved" }, { actorType: "system", actorName: null }),
        item("reminder_failed", { reason: "opted_out" }, { actorType: "system", actorName: null }),
      ],
      context,
    );
    expect(moved.what).toBe("Movida: lun 28 sep, 10:00 → lun 28 sep, 11:00 · Profesional: Laura → Marta");
    expect(changed.what).toBe("Ahora termina el lun 28 sep, 12:00 · Personas: 2 → 4 · Cambiadas las notas y el cliente");
    expect(status.what).toBe("Estado: pendiente → confirmada");
    expect(notice.what).toBe("Aviso al cliente: cambio de hora enviado");
    expect(failed.what).toBe("No se ha podido enviar el recordatorio");
  });

  it("never breaks on something it does not know", () => {
    const [unknown] = historyLines([item("archived", { weird: true }, { actorType: "user", actorName: null })], context);
    expect(unknown).toMatchObject({ who: "Una persona del equipo", what: "Cambio registrado" });
    const [removed] = historyLines([item("moved", { resourceId: { from: "gone", to: MARTA } })], context);
    expect(removed.what).toBe("Profesional: otro → Marta");
  });
});
