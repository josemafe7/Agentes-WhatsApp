import { describe, expect, it } from "vitest";
import { customerInput, editChanges, type EditValues } from "./booking-form";
import type { EditableBooking } from "./types";

const BOOKING: EditableBooking = {
  id: "b1",
  serviceId: "s1",
  serviceName: "Corte",
  resourceId: "laura",
  startLocal: "2026-09-28T10:00:00+02:00",
  durationMin: 30,
  people: 1,
  notes: null,
  contactId: "c1",
  contactName: "Rosa",
  canNotify: false,
};

const untouched: EditValues = {
  start: BOOKING.startLocal,
  resourceId: "laura",
  durationMin: 30,
  people: 1,
  notes: "",
  customer: { kind: "existing", id: "c1", name: "Rosa" },
};

describe("«Nueva cita»: who the booking is for [AGD-14]", () => {
  it("an existing contact, a new customer, or the conversation's contact", () => {
    expect(customerInput({ kind: "existing", id: "c1", name: "Rosa" })).toEqual({ contactId: "c1" });
    expect(customerInput({ kind: "new", name: " Lucía ", phone: " 600 ", email: "" })).toEqual({ newContact: { name: "Lucía", phone: "600" } });
    expect(customerInput({ kind: "conversation" }, "conv-1")).toEqual({ conversationId: "conv-1" });
  });

  it("nobody chosen, or a new customer without a name, is not enough", () => {
    expect(customerInput({ kind: "none" })).toBeNull();
    expect(customerInput({ kind: "new", name: "  ", phone: "600", email: "" })).toBeNull();
    expect(customerInput({ kind: "conversation" })).toBeNull();
  });
});

describe("«Cambiar»: only what changed is sent [AGD-17]", () => {
  it("an untouched booking sends nothing", () => {
    expect(editChanges(BOOKING, untouched, "cliente")).toEqual({ ok: true, schedule: {}, details: {} });
  });

  it("a new time, resource, length and people go as a move; notes and customer as details", () => {
    const result = editChanges(
      BOOKING,
      { ...untouched, start: "2026-09-28T11:00:00+02:00", resourceId: "any", durationMin: 45, people: 2, notes: " Trae foto ", customer: { kind: "existing", id: "c2", name: "Ana" } },
      "cliente",
    );
    expect(result).toEqual({
      ok: true,
      schedule: { start: "2026-09-28T11:00:00+02:00", resourceId: "any", durationMin: 45, people: 2 },
      details: { notes: "Trae foto", contactId: "c2" },
    });
  });

  it("a name-only customer unlinks the contact card; clearing the notes removes them", () => {
    const result = editChanges({ ...BOOKING, notes: "Antigua" }, { ...untouched, notes: "  ", customer: { kind: "new", name: "Rosa López", phone: "", email: "" } }, "cliente");
    expect(result).toEqual({ ok: true, schedule: {}, details: { notes: null, contactId: null, contactName: "Rosa López" } });
  });

  it("asks for what is missing: a time on the new day, a customer, a name", () => {
    expect(editChanges(BOOKING, { ...untouched, start: null }, "cliente")).toEqual({ ok: false, field: "start", message: "Elige una hora libre." });
    expect(editChanges(BOOKING, { ...untouched, customer: { kind: "none" } }, "paciente")).toEqual({ ok: false, field: "contactId", message: "Elige un paciente o escribe su nombre." });
    expect(editChanges(BOOKING, { ...untouched, customer: { kind: "new", name: " ", phone: "", email: "" } }, "cliente")).toMatchObject({ ok: false, field: "name" });
  });
});
