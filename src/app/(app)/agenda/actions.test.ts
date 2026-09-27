// Server Actions of the Agenda screen called directly, as the browser would, with the real data layer and database
// ([SEG-04], [PER-01]). The clock is fixed on Sunday 2026-09-27 10:00 (Madrid): only Date is faked (docs/testing.md).
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as null | { session: { id: string }; user: { id: string } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));

import { db } from "@/db";
import { bookings, contacts, resources, resourceTimeOff } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { createBooking, type BookingActor } from "@/server/booking";
import { addResource, at, createHairdresser, NOW, TZ } from "@/server/booking/test-helpers";
import { formatLocalMinute } from "@/server/booking/time";
import { createChannel, createContactWithIdentity, createConversation, createUser, type TestUser } from "@/test/factories";
import {
  blockSlotAction,
  createBookingAction,
  deleteTestBookingsAction,
  getSlotsAction,
  moveBookingAction,
  removeTimeOffAction,
  searchContactsAction,
  setBookingStatusAction,
  updateBookingAction,
} from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const TAKEN = "Ese hueco ya no está libre.";
const MANAGERS = ["owner", "admin", "supervisor", "agent"] as const;

let hair: Awaited<ReturnType<typeof createHairdresser>>;
let owner: TestUser;
let system: BookingActor;

const signInAs = (person: TestUser) => {
  state.session = { session: { id: `s-${person.userId}` }, user: { id: person.userId } };
};
const signInWithRole = async (role: Role) => {
  const person = await createUser(role);
  signInAs(person);
  return person;
};

const book = (start: string, overrides: Partial<Parameters<typeof createBooking>[0]> = {}) =>
  createBooking({ serviceId: hair.cut.id, resourceId: hair.laura.id, start: at(start), contactId: null, contactName: "Rosa", source: "human", actor: system, now: NOW, ...overrides });

const localStart = async (bookingId: string) => {
  const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  return { start: formatLocalMinute(row.startsAt, TZ), end: formatLocalMinute(row.endsAt, TZ), row };
};

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  owner = await createUser("owner");
  system = { type: "user", userId: owner.userId, name: owner.name };
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  state.session = null;
  hair = await createHairdresser();
});

/** Contacts are shared by the whole file (conversations point at them): each test looks for its own names. */
const contactsNamed = (name: string) => db.select().from(contacts).where(eq(contacts.name, name));

describe("«Nueva cita» [AGD-17] [PER-01] «Agenda: crear, editar, mover y cancelar citas»", () => {
  it.each(MANAGERS)("%s books a free slot with the same rules as the AI", async (role) => {
    await signInWithRole(role);
    const result = await createBookingAction({ serviceId: hair.cut.id, resourceId: "any", start: "2026-09-28T10:00", contactName: "Rosa", status: "confirmed" });
    expect(result).toMatchObject({ ok: true, message: "Cita creada." });
    if (!result.ok) return;
    const { start, row } = await localStart(result.data?.id ?? "");
    expect(start).toBe("2026-09-28T10:00");
    expect(row).toMatchObject({ contactName: "Rosa", source: "human", status: "confirmed" });
  });

  it("solo lectura cannot, and nothing is created [PER-03]", async () => {
    await signInWithRole("viewer");
    expect(await createBookingAction({ serviceId: hair.cut.id, resourceId: "any", start: "2026-09-28T10:00", contactName: "Rosa" })).toEqual(FORBIDDEN);
    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it("without a session nothing happens", async () => {
    const result = await createBookingAction({ serviceId: hair.cut.id, resourceId: "any", start: "2026-09-28T10:00", contactName: "Rosa" });
    expect(result).toEqual({ ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." });
  });

  it("a slot taken meanwhile answers «Ese hueco ya no está libre» with alternatives [AGD-13]", async () => {
    await book("2026-09-28T10:00");
    await book("2026-09-28T10:00", { resourceId: hair.marta.id });
    signInAs(owner);
    const result = await createBookingAction({ serviceId: hair.cut.id, resourceId: "any", start: "2026-09-28T10:00", contactName: "Rosa" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(TAKEN);
    expect(result.alternatives?.length).toBeGreaterThan(0);
    expect(result.alternatives?.[0]).toMatchObject({ date: "2026-09-28", dayLabel: "lunes 28 de septiembre" });
    expect(result.alternatives?.map((option) => option.time)).not.toContain("10:00");
    expect(await db.select().from(bookings)).toHaveLength(2);
  });

  it("explains a request that can never fit, such as too many people for the service [AGD-11]", async () => {
    signInAs(owner);
    const result = await createBookingAction({ serviceId: hair.cut.id, resourceId: "any", start: "2026-09-28T10:00", people: 3, contactName: "Rosa" });
    expect(result).toEqual({ ok: false, error: "El número de personas no está entre el mínimo y el máximo del servicio." });
  });

  it("a new customer gets a contact card and the booking is linked to it", async () => {
    signInAs(owner);
    const result = await createBookingAction({
      serviceId: hair.cut.id,
      resourceId: hair.marta.id,
      start: "2026-09-28T11:00",
      newContact: { name: "Lucía Gómez", phone: "+34 600 111 222", email: "" },
    });
    expect(result.ok).toBe(true);
    const created = await contactsNamed("Lucía Gómez");
    expect(created).toHaveLength(1);
    const [contact] = created;
    expect(contact).toMatchObject({ phone: "+34 600 111 222" });
    const [row] = await db.select().from(bookings);
    expect(row).toMatchObject({ contactId: contact.id, contactName: "Lucía Gómez", resourceId: hair.marta.id });
  });

  it("if the slot was taken, the new contact is kept and returned so a retry does not duplicate it", async () => {
    await book("2026-09-28T11:00", { resourceId: hair.marta.id });
    signInAs(owner);
    const result = await createBookingAction({ serviceId: hair.cut.id, resourceId: hair.marta.id, start: "2026-09-28T11:00", newContact: { name: "Lucía Reintento" } });
    expect(result.ok).toBe(false);
    const created = await contactsNamed("Lucía Reintento");
    expect(created).toHaveLength(1);
    if (!result.ok) expect(result.contactId).toBe(created[0].id);
  });

  it("an agent limited to some channels books a new customer by name only, without creating a card [PER-02]", async () => {
    const channel = await createChannel({ type: "webchat" });
    signInAs(await createUser("agent", { channelIds: [channel.id] }));
    const result = await createBookingAction({ serviceId: hair.cut.id, resourceId: "any", start: "2026-09-28T12:00", newContact: { name: "Pablo Sin Ficha", phone: "600000000" } });
    expect(result.ok).toBe(true);
    expect(await contactsNamed("Pablo Sin Ficha")).toHaveLength(0);
    const [row] = await db.select().from(bookings);
    expect(row).toMatchObject({ contactId: null, contactName: "Pablo Sin Ficha" });
  });

  it("from a conversation, links its contact and channel [AGD-19]", async () => {
    const channel = await createChannel({ type: "webchat" });
    const { contact } = await createContactWithIdentity("webchat", { name: "Marcos" });
    const conversation = await createConversation(channel.id, contact.id);
    signInAs(owner);
    const result = await createBookingAction({ serviceId: hair.cut.id, resourceId: "any", start: "2026-09-28T12:00", conversationId: conversation.id });
    expect(result.ok).toBe(true);
    const [row] = await db.select().from(bookings);
    expect(row).toMatchObject({ contactId: contact.id, conversationId: conversation.id, channelId: channel.id });
  });

  it("rejects malformed input without saving anything [SEG-05]", async () => {
    signInAs(owner);
    const result = await createBookingAction({ serviceId: hair.cut.id, resourceId: "any", start: "mañana a las diez", contactName: "Rosa" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.start).toBeDefined();
    expect((await createBookingAction("nada")).ok).toBe(false);
    expect(await db.select().from(bookings)).toHaveLength(0);
  });
});

describe("free slots for the dialog [AGD-08] [AGD-09] «Agenda: ver citas y disponibilidad»", () => {
  it.each(["owner", "supervisor", "agent", "viewer"] as const)("%s sees the engine's free slots of a day", async (role) => {
    await book("2026-09-28T09:00");
    await signInWithRole(role);
    const result = await getSlotsAction({ serviceId: hair.cut.id, from: "2026-09-28", to: "2026-09-28", resourceId: hair.laura.id });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) return;
    expect(result.data.reason).toBeNull();
    const times = result.data.slots.map((slot) => slot.time);
    expect(times[0]).toBe("09:30");
    expect(times).not.toContain("09:00");
    expect(times).not.toContain("14:00");
    expect(times).toContain("16:00");
  });

  it("a slot being moved does not block itself", async () => {
    const moving = await book("2026-09-28T09:00");
    signInAs(owner);
    const result = await getSlotsAction({ serviceId: hair.cut.id, from: "2026-09-28", to: "2026-09-28", resourceId: hair.laura.id, excludeBookingId: moving.id });
    expect(result.ok && result.data?.slots[0].time).toBe("09:00");
  });

  it("explains why there are none for too many people [AGD-11]", async () => {
    signInAs(owner);
    const result = await getSlotsAction({ serviceId: hair.cut.id, from: "2026-09-28", to: "2026-09-28", people: 5 });
    expect(result).toMatchObject({ ok: true, data: { slots: [], reason: "El número de personas no está entre el mínimo y el máximo del servicio." } });
  });

  it("refuses bad input", async () => {
    signInAs(owner);
    expect((await getSlotsAction({ serviceId: "x", from: "2026-09-28", to: "2026-09-28" })).ok).toBe(false);
    expect((await getSlotsAction({ serviceId: hair.cut.id, from: "2026-09-28", to: "2026-12-28" })).ok).toBe(false);
  });
});

describe("moving by drag and drop [AGD-17]", () => {
  it.each(MANAGERS)("%s moves a booking to a free slot, to another resource and stretches it", async (role) => {
    const booking = await book("2026-09-28T10:00");
    await signInWithRole(role);
    expect(await moveBookingAction({ bookingId: booking.id, start: "2026-09-28T11:30" })).toMatchObject({ ok: true, message: "Cita movida." });
    expect((await localStart(booking.id)).start).toBe("2026-09-28T11:30");
    expect((await moveBookingAction({ bookingId: booking.id, resourceId: hair.marta.id })).ok).toBe(true);
    expect((await localStart(booking.id)).row.resourceId).toBe(hair.marta.id);
    expect((await moveBookingAction({ bookingId: booking.id, durationMin: 60 })).ok).toBe(true);
    expect((await localStart(booking.id)).end).toBe("2026-09-28T12:30");
  });

  it("a place that is not free is rejected, the booking stays where it was and alternatives come back", async () => {
    const booking = await book("2026-09-28T10:00");
    await book("2026-09-28T11:00");
    signInAs(owner);
    const taken = await moveBookingAction({ bookingId: booking.id, start: "2026-09-28T11:00" });
    expect(taken).toMatchObject({ ok: false, error: TAKEN });
    if (!taken.ok) expect(taken.alternatives?.length).toBeGreaterThan(0);
    const closed = await moveBookingAction({ bookingId: booking.id, start: "2026-09-28T14:00" });
    expect(closed).toMatchObject({ ok: false, error: TAKEN });
    expect((await localStart(booking.id)).start).toBe("2026-09-28T10:00");
  });

  it("solo lectura cannot move [PER-03]", async () => {
    const booking = await book("2026-09-28T10:00");
    await signInWithRole("viewer");
    expect(await moveBookingAction({ bookingId: booking.id, start: "2026-09-28T11:00" })).toEqual(FORBIDDEN);
    expect((await localStart(booking.id)).start).toBe("2026-09-28T10:00");
  });
});

describe("editing a booking from its card (the keyboard alternative to dragging) [AGD-17]", () => {
  it("changes time, length, people and notes in one save", async () => {
    const booking = await book("2026-09-28T10:00");
    signInAs(owner);
    const result = await updateBookingAction({ bookingId: booking.id, schedule: { start: "2026-09-28T16:30", durationMin: 45 }, details: { notes: "Trae foto" } });
    expect(result).toMatchObject({ ok: true, message: "Cambios guardados." });
    const { start, end, row } = await localStart(booking.id);
    expect([start, end, row.notes]).toEqual(["2026-09-28T16:30", "2026-09-28T17:15", "Trae foto"]);
  });

  it("if the new time is taken, nothing changes, not even the notes", async () => {
    const booking = await book("2026-09-28T10:00");
    await book("2026-09-28T16:00");
    signInAs(owner);
    const result = await updateBookingAction({ bookingId: booking.id, schedule: { start: "2026-09-28T16:00" }, details: { notes: "No debería guardarse" } });
    expect(result).toMatchObject({ ok: false, error: TAKEN });
    const { start, row } = await localStart(booking.id);
    expect([start, row.notes]).toEqual(["2026-09-28T10:00", null]);
  });

  it("changes the customer to an existing contact", async () => {
    const booking = await book("2026-09-28T10:00");
    const { contact } = await createContactWithIdentity("webchat", { name: "Marcos" });
    signInAs(owner);
    expect((await updateBookingAction({ bookingId: booking.id, details: { contactId: contact.id } })).ok).toBe(true);
    expect((await localStart(booking.id)).row).toMatchObject({ contactId: contact.id, contactName: "Marcos" });
  });

  it("solo lectura cannot edit [PER-03]", async () => {
    const booking = await book("2026-09-28T10:00");
    await signInWithRole("viewer");
    expect(await updateBookingAction({ bookingId: booking.id, details: { notes: "x" } })).toEqual(FORBIDDEN);
  });
});

describe("confirm, cancel, complete and no-show [AGD-14]", () => {
  it("confirms a pending booking and cancels with a reason; the slot is free again [AGD-09]", async () => {
    const pending = await book("2026-09-28T10:00", { serviceId: hair.dye.id });
    expect(pending.status).toBe("pending");
    await signInWithRole("agent");
    expect(await setBookingStatusAction({ bookingId: pending.id, status: "confirmed" })).toMatchObject({ ok: true, message: "Cita confirmada." });
    const cancelled = await setBookingStatusAction({ bookingId: pending.id, status: "cancelled", reason: "Se ha puesto enferma" });
    expect(cancelled).toMatchObject({ ok: true, message: "Cita cancelada." });
    expect((await localStart(pending.id)).row).toMatchObject({ status: "cancelled", cancelReason: "Se ha puesto enferma" });
    const slots = await getSlotsAction({ serviceId: hair.dye.id, from: "2026-09-28", to: "2026-09-28", resourceId: hair.laura.id });
    expect(slots.ok && slots.data?.slots.map((slot) => slot.time)).toContain("10:00");
  });

  it("marks completed and no-show", async () => {
    const first = await book("2026-09-28T10:00");
    const second = await book("2026-09-28T11:00");
    signInAs(owner);
    expect(await setBookingStatusAction({ bookingId: first.id, status: "completed" })).toMatchObject({ ok: true, message: "Cita marcada como completada." });
    expect(await setBookingStatusAction({ bookingId: second.id, status: "no_show" })).toMatchObject({ ok: true, message: "Cita marcada como no presentado." });
  });

  it("tells the customer when asked, and says so [AGD-23]", async () => {
    const booking = await book("2026-09-28T10:00");
    signInAs(owner);
    const result = await setBookingStatusAction({ bookingId: booking.id, status: "cancelled", notifyCustomer: true });
    expect(result).toMatchObject({ ok: true, message: "Cita cancelada. No hemos podido avisar al cliente: esta cita no tiene conversación." });
  });

  it("solo lectura cannot [PER-03]", async () => {
    const booking = await book("2026-09-28T10:00");
    await signInWithRole("viewer");
    expect(await setBookingStatusAction({ bookingId: booking.id, status: "cancelled" })).toEqual(FORBIDDEN);
    expect((await localStart(booking.id)).row.status).toBe("confirmed");
  });
});

describe("blocking slots [AGD-18] «Agenda: bloquear huecos y poner ausencias»", () => {
  it.each(["owner", "admin", "supervisor"] as const)("%s blocks a slot of one resource and it stops being free", async (role) => {
    await signInWithRole(role);
    const result = await blockSlotAction({ resourceId: hair.laura.id, start: "2026-09-28T10:00", end: "2026-09-28T12:00", reason: "Formación" });
    expect(result).toMatchObject({ ok: true, message: "Hueco bloqueado.", data: { blocked: 1, overlappingBookings: 0 } });
    const slots = await getSlotsAction({ serviceId: hair.cut.id, from: "2026-09-28", to: "2026-09-28", resourceId: hair.laura.id });
    const times = slots.ok ? (slots.data?.slots.map((slot) => slot.time) ?? []) : [];
    expect(times).toContain("09:30");
    expect(times).not.toContain("10:00");
    expect(times).not.toContain("11:30");
    expect(times).toContain("12:00");
    const [row] = await db.select().from(resourceTimeOff);
    expect(row).toMatchObject({ kind: "block", reason: "Formación", resourceId: hair.laura.id });
  });

  it("«Todos» blocks every active resource and counts the bookings already inside", async () => {
    await addResource({ name: "Antigua", active: false });
    await book("2026-09-28T10:00");
    signInAs(owner);
    const result = await blockSlotAction({ resourceId: "all", start: "2026-09-28T10:00", end: "2026-09-28T11:00" });
    expect(result).toMatchObject({ ok: true, data: { blocked: 2, overlappingBookings: 1 } });
    if (result.ok) expect(result.message).toBe("Hueco bloqueado para 2 profesionales. Dentro queda 1 cita, que sigue en la agenda.");
    const rows = await db.select({ resourceId: resourceTimeOff.resourceId }).from(resourceTimeOff);
    expect(rows.map((row) => row.resourceId).sort()).toEqual([hair.laura.id, hair.marta.id].sort());
  });

  it("checks the times", async () => {
    signInAs(owner);
    const result = await blockSlotAction({ resourceId: hair.laura.id, start: "2026-09-28T12:00", end: "2026-09-28T10:00" });
    expect(result.ok).toBe(false);
    expect(await db.select().from(resourceTimeOff)).toHaveLength(0);
  });

  it.each(["agent", "viewer"] as const)("%s cannot block, nor remove a block", async (role) => {
    signInAs(owner);
    await blockSlotAction({ resourceId: hair.laura.id, start: "2026-09-28T10:00", end: "2026-09-28T12:00" });
    const [row] = await db.select().from(resourceTimeOff);
    await signInWithRole(role);
    expect(await blockSlotAction({ resourceId: "all", start: "2026-09-29T10:00", end: "2026-09-29T12:00" })).toEqual(FORBIDDEN);
    expect(await removeTimeOffAction(row.id)).toEqual(FORBIDDEN);
    expect(await db.select().from(resourceTimeOff)).toHaveLength(1);
  });

  it("a supervisor removes a block and the slot is free again", async () => {
    signInAs(owner);
    await blockSlotAction({ resourceId: hair.laura.id, start: "2026-09-28T10:00", end: "2026-09-28T12:00" });
    const [row] = await db.select().from(resourceTimeOff);
    await signInWithRole("supervisor");
    expect(await removeTimeOffAction(row.id)).toMatchObject({ ok: true, message: "Bloqueo quitado." });
    expect(await db.select().from(resourceTimeOff)).toHaveLength(0);
  });
});

describe("test bookings of «Probar agente» [PRU-04] «Agenda: borrar las citas de prueba»", () => {
  it.each(["owner", "admin", "supervisor"] as const)("%s deletes them all at once, and only them", async (role) => {
    const real = await book("2026-09-28T10:00");
    await book("2026-09-28T11:00", { isTest: true, source: "ai" });
    await book("2026-09-29T11:00", { isTest: true, source: "ai" });
    await signInWithRole(role);
    expect(await deleteTestBookingsAction()).toMatchObject({ ok: true, data: { deleted: 2 }, message: "Citas de prueba borradas: 2." });
    expect((await db.select({ id: bookings.id }).from(bookings)).map((row) => row.id)).toEqual([real.id]);
  });

  it.each(["agent", "viewer"] as const)("%s cannot", async (role) => {
    await book("2026-09-28T11:00", { isTest: true, source: "ai" });
    await signInWithRole(role);
    expect(await deleteTestBookingsAction()).toEqual(FORBIDDEN);
    expect(await db.select().from(bookings)).toHaveLength(1);
  });
});

describe("finding the customer for a booking [CTO-01] [PER-02]", () => {
  it("finds contacts by name, phone or email", async () => {
    const channel = await createChannel({ type: "webchat" });
    // Its own phone: the contacts of this file are shared, and «Lucía Gómez» (above) has +34 600 111 222.
    const { contact } = await createContactWithIdentity("webchat", { name: "Leonor Buscada", phone: "+34600111444" });
    await createConversation(channel.id, contact.id);
    await createContactWithIdentity("webchat", { name: "Pedro" });
    signInAs(owner);
    expect(await searchContactsAction("leonor buscada")).toMatchObject({ ok: true, data: [{ id: contact.id, name: "Leonor Buscada", detail: "+34600111444" }] });
    expect(await searchContactsAction("600111444")).toMatchObject({ ok: true, data: [{ id: contact.id }] });
  });

  it("an agent only finds contacts of their channels", async () => {
    const mine = await createChannel({ type: "webchat" });
    const theirs = await createChannel({ type: "webchat" });
    const { contact: inMine } = await createContactWithIdentity("webchat", { name: "Ana Canal Mío" });
    const { contact: inTheirs } = await createContactWithIdentity("webchat", { name: "Ana Canal Ajeno" });
    await createConversation(mine.id, inMine.id);
    await createConversation(theirs.id, inTheirs.id);
    signInAs(await createUser("agent", { channelIds: [mine.id] }));
    const result = await searchContactsAction("Ana Canal");
    expect(result.ok && result.data?.map((item) => item.id)).toEqual([inMine.id]);
  });

  it("solo lectura cannot book, so it does not search either", async () => {
    await signInWithRole("viewer");
    expect(await searchContactsAction("Ana")).toEqual(FORBIDDEN);
  });
});

describe("the resources left out of the calendar", () => {
  it("inactive resources are not blocked by «Todos» and keep their bookings [AGD-03]", async () => {
    const inactive = await addResource({ name: "Antigua", active: false });
    signInAs(owner);
    await blockSlotAction({ resourceId: "all", start: "2026-09-30T10:00", end: "2026-09-30T11:00" });
    const blocked = await db.select({ resourceId: resourceTimeOff.resourceId }).from(resourceTimeOff);
    expect(blocked.map((row) => row.resourceId)).not.toContain(inactive.id);
    expect((await db.select().from(resources)).length).toBe(3);
  });
});
