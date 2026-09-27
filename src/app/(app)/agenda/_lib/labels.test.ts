import { describe, expect, it } from "vitest";
import { agendaWords, noticeText, peopleLabel } from "./labels";

const HAIRDRESSER = agendaWords({ booking: "cita", bookings: "citas", resource: "profesional", resources: "profesionales", customer: "cliente" });
const RESTAURANT = agendaWords({ booking: "reserva", bookings: "reservas", resource: "mesa", resources: "mesas", customer: "comensal" });

describe("Agenda: the business's own words [AGD-01]", () => {
  it("uses Cita, Profesional and Cliente with the right forms", () => {
    expect(HAIRDRESSER).toMatchObject({
      booking: "cita",
      Booking: "Cita",
      Bookings: "Citas",
      Resource: "Profesional",
      Resources: "Profesionales",
      Customer: "Cliente",
      newBooking: "Nueva cita",
      allResources: "Todos los profesionales",
      anyResource: "Cualquier profesional",
    });
  });

  it("uses Reserva, Mesa and Comensal, with feminine agreement where the word needs it", () => {
    expect(RESTAURANT).toMatchObject({ newBooking: "Nueva reserva", allResources: "Todas las mesas", anyResource: "Cualquier mesa", Customer: "Comensal" });
    expect(agendaWords({ booking: "cita", bookings: "citas", resource: "box", resources: "boxes", customer: "paciente" }).allResources).toBe("Todos los boxes");
    expect(agendaWords({ booking: "cita", bookings: "citas", resource: "sala", resources: "salas", customer: "paciente" }).allResources).toBe("Todas las salas");
  });
});

describe("Agenda: what the person reads after telling the customer [AGD-23]", () => {
  it("says whether the customer was told, and why not", () => {
    expect(noticeText(null, HAIRDRESSER)).toBeNull();
    expect(noticeText({ sent: true, messageId: "m1" }, HAIRDRESSER)).toBe("Hemos avisado al cliente por su conversación.");
    expect(noticeText({ sent: false, reason: "window_closed" }, RESTAURANT)).toBe(
      "No hemos podido avisar al comensal: la ventana de 24 h de WhatsApp está cerrada.",
    );
    expect(noticeText({ sent: false, reason: "no_conversation" }, RESTAURANT)).toBe("No hemos podido avisar al comensal: esta reserva no tiene conversación.");
    expect(noticeText({ sent: false, reason: "opted_out" }, HAIRDRESSER)).toBe("No hemos podido avisar al cliente: se ha dado de baja de este canal.");
    expect(noticeText({ sent: false, reason: "test" }, HAIRDRESSER)).toBeNull();
  });

  it("writes the number of people", () => {
    expect(peopleLabel(1)).toBe("1 pers.");
    expect(peopleLabel(12)).toBe("12 pers.");
  });
});
