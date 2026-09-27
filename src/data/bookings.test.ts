import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, bookings, messages } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { createBooking, SlotUnavailableError, type BookingActor } from "@/server/booking";
import { at, createHairdresser, NOW, TZ } from "@/server/booking/test-helpers";
import { formatLocalMinute } from "@/server/booking/time";
import { AuthError, NotFoundError, ValidationError } from "@/server/errors";
import { actorFor, createChannel, createContactWithIdentity, createConversation, createUser, type TestUser } from "@/test/factories";
import {
  countTestBookings,
  createBookingByPerson,
  deleteTestBookings,
  getAgendaFrame,
  getAvailability,
  getBooking,
  listBookings,
  listContactBookings,
  moveBooking,
  nextBookingsOf,
  setBookingStatus,
  updateBooking,
} from "./bookings";

const ROLES: Role[] = ["owner", "admin", "supervisor", "agent", "viewer"];
const users = {} as Record<Role, TestUser>;
let hair: Awaited<ReturnType<typeof createHairdresser>>;
let system: BookingActor;

beforeAll(async () => {
  for (const role of ROLES) users[role] = await createUser(role);
  system = { type: "user", userId: users.owner.userId, name: users.owner.name };
});

beforeEach(async () => {
  hair = await createHairdresser();
  await db.delete(auditLog);
});

const book = (start: string, overrides: Partial<Parameters<typeof createBooking>[0]> = {}) =>
  createBooking({ serviceId: hair.cut.id, resourceId: hair.laura.id, start: at(start), contactId: null, contactName: "Cliente", source: "human", actor: system, now: NOW, ...overrides });

describe("who can see the agenda [PER-01] «Agenda: ver citas y disponibilidad»", () => {
  it.each(ROLES)("%s sees bookings, a booking's card, free slots and the opening frame", async (role) => {
    const booking = await book("2026-09-28T10:00");
    const actor = users[role].actor;
    const { bookings: listed, timezone } = await listBookings(actor, { from: "2026-09-28", to: "2026-09-28" });
    expect(timezone).toBe(TZ);
    expect(listed.map((item) => item.id)).toEqual([booking.id]);
    expect((await getBooking(actor, booking.id)).history.map((event) => event.action)).toEqual(["created"]);
    expect((await getAvailability(actor, { serviceId: hair.cut.id, from: "2026-09-28", to: "2026-09-28" }, { now: NOW })).slots.length).toBeGreaterThan(0);
    expect((await getAgendaFrame(actor, { from: "2026-09-28", to: "2026-10-04" })).hours.length).toBeGreaterThan(0);
  });
});

describe("the calendar [AGD-16] [AGD-28]", () => {
  it("filters by days, resource, service and status; cancelled and no-shows only on request; test bookings labelled", async () => {
    const monday = await book("2026-09-28T10:00");
    const marta = await book("2026-09-28T10:00", { resourceId: hair.marta.id });
    const dye = await book("2026-09-28T16:00", { serviceId: hair.dye.id, status: "confirmed" });
    const cancelled = await book("2026-09-28T12:00");
    await setBookingStatus(users.owner.actor, { bookingId: cancelled.id, status: "cancelled" }, { now: NOW });
    const test = await book("2026-09-28T13:00", { isTest: true, source: "ai" });
    await book("2026-09-29T10:00");
    const ids = async (filters: Record<string, unknown>) => (await listBookings(users.viewer.actor, { from: "2026-09-28", to: "2026-09-28", ...filters })).bookings.map((item) => item.id);
    expect(await ids({})).toEqual([monday.id, marta.id, test.id, dye.id]);
    expect(await ids({ resourceIds: [hair.marta.id] })).toEqual([marta.id]);
    expect(await ids({ serviceIds: [hair.dye.id] })).toEqual([dye.id]);
    expect(await ids({ includeCancelled: true })).toContain(cancelled.id);
    expect(await ids({ statuses: ["cancelled"] })).toEqual([cancelled.id]);
    expect(await ids({ includeTest: false })).not.toContain(test.id);
    const [first] = (await listBookings(users.viewer.actor, { from: "2026-09-28", to: "2026-09-28" })).bookings;
    expect(first).toMatchObject({ startLocal: "2026-09-28T10:00:00+02:00", service: { name: "Corte" }, resource: { name: "Laura" } });
  });

  it("refuses wrong or too long ranges", async () => {
    await expect(listBookings(users.owner.actor, { from: "2026-09-31", to: "2026-10-01" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listBookings(users.owner.actor, { from: "2026-10-05", to: "2026-10-01" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listBookings(users.owner.actor, { from: "2026-01-01", to: "2026-12-31" })).rejects.toBeInstanceOf(ValidationError);
    await expect(getBooking(users.owner.actor, crypto.randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("who can create, move and cancel bookings [PER-01] «Agenda: crear, editar, mover y cancelar citas»", () => {
  it.each(["owner", "admin", "supervisor", "agent"] as const)("%s can, with the same rules as the AI [AGD-17]", async (role) => {
    const actor = users[role].actor;
    const created = await createBookingByPerson(actor, { serviceId: hair.cut.id, resourceId: "any", start: "2026-09-28T10:00", contactName: "Rosa" }, { now: NOW });
    expect(created).toMatchObject({ source: "human", createdByUserId: users[role].userId, startLocal: "2026-09-28T10:00:00+02:00" });
    const moved = await moveBooking(actor, { bookingId: created.id, start: "2026-09-28T11:00" }, { now: NOW });
    expect(moved.booking.startLocal).toBe("2026-09-28T11:00:00+02:00");
    expect((await updateBooking(actor, { bookingId: created.id, notes: "Trae foto" })).notes).toBe("Trae foto");
    expect((await setBookingStatus(actor, { bookingId: created.id, status: "cancelled", reason: "Enferma" }, { now: NOW })).booking.status).toBe("cancelled");
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "booking.created"));
    expect(entry).toMatchObject({ actorUserId: users[role].userId, targetId: created.id });
    await expect(createBookingByPerson(actor, { serviceId: hair.cut.id, resourceId: hair.laura.id, start: "2026-09-28T14:00", contactName: "Fuera" }, { now: NOW })).rejects.toBeInstanceOf(SlotUnavailableError);
  });

  it("solo lectura cannot, and nothing changes [PER-03]", async () => {
    const booking = await book("2026-09-28T10:00");
    const viewer = users.viewer.actor;
    await expect(createBookingByPerson(viewer, { serviceId: hair.cut.id, resourceId: "any", start: "2026-09-28T11:00", contactName: "X" }, { now: NOW })).rejects.toBeInstanceOf(AuthError);
    await expect(moveBooking(viewer, { bookingId: booking.id, start: "2026-09-28T11:00" }, { now: NOW })).rejects.toBeInstanceOf(AuthError);
    await expect(updateBooking(viewer, { bookingId: booking.id, notes: "x" })).rejects.toBeInstanceOf(AuthError);
    await expect(setBookingStatus(viewer, { bookingId: booking.id, status: "cancelled" }, { now: NOW })).rejects.toBeInstanceOf(AuthError);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row).toMatchObject({ status: "confirmed", notes: null });
    expect(formatLocalMinute(row.startsAt, TZ)).toBe("2026-09-28T10:00");
  });

  it("checks the input: a contact or a name, valid times", async () => {
    const owner = users.owner.actor;
    await expect(createBookingByPerson(owner, { serviceId: hair.cut.id, resourceId: "any", start: "2026-09-28T11:00" }, { now: NOW })).rejects.toBeInstanceOf(ValidationError);
    await expect(createBookingByPerson(owner, { serviceId: hair.cut.id, resourceId: "any", start: "28/09/2026 11:00", contactName: "X" }, { now: NOW })).rejects.toBeInstanceOf(ValidationError);
    await expect(createBookingByPerson(owner, { serviceId: hair.cut.id, resourceId: "laura", start: "2026-09-28T11:00", contactName: "X" }, { now: NOW })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("«Nueva cita» from a conversation, and agents limited to their channels [PER-02] [AGD-19]", () => {
  it("links the conversation, its channel and its contact", async () => {
    const channel = await createChannel({ type: "webchat" });
    const { contact } = await createContactWithIdentity("webchat", { name: "Marcos" });
    const conversation = await createConversation(channel.id, contact.id);
    const booking = await createBookingByPerson(users.supervisor.actor, { serviceId: hair.cut.id, resourceId: "any", start: "2026-09-28T10:00", conversationId: conversation.id }, { now: NOW });
    expect(booking).toMatchObject({ contactId: contact.id, contactName: "Marcos", conversationId: conversation.id, channel: { id: channel.id } });
    const { contact: other } = await createContactWithIdentity("webchat", { name: "Otra" });
    await expect(
      createBookingByPerson(users.supervisor.actor, { serviceId: hair.cut.id, resourceId: "any", start: "2026-09-28T11:00", conversationId: conversation.id, contactId: other.id }, { now: NOW }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("an agent only books for contacts and conversations of their channels", async () => {
    const mine = await createChannel({ type: "webchat" });
    const theirs = await createChannel({ type: "webchat" });
    const agent = await createUser("agent", { channelIds: [mine.id] });
    const { contact: inMine } = await createContactWithIdentity("webchat", { name: "Mía" });
    const { contact: inTheirs } = await createContactWithIdentity("webchat", { name: "Ajena" });
    await createConversation(mine.id, inMine.id);
    const foreign = await createConversation(theirs.id, inTheirs.id);
    const base = { serviceId: hair.cut.id, resourceId: "any", start: "2026-09-28T10:00" };
    await expect(createBookingByPerson(agent.actor, { ...base, contactId: inTheirs.id }, { now: NOW })).rejects.toBeInstanceOf(AuthError);
    await expect(createBookingByPerson(agent.actor, { ...base, conversationId: foreign.id }, { now: NOW })).rejects.toBeInstanceOf(AuthError);
    await expect(listContactBookings(agent.actor, inTheirs.id)).rejects.toBeInstanceOf(AuthError);
    await expect(createBookingByPerson(agent.actor, { ...base, contactId: inMine.id }, { now: NOW })).resolves.toMatchObject({ contactId: inMine.id });
    expect(await listContactBookings(agent.actor, inMine.id)).toHaveLength(1);
  });
});

describe("a contact's bookings and the next one [CTO-02] [CTO-01]", () => {
  it("lists the contact's real bookings, newest first, and the next pending or confirmed one of each contact", async () => {
    const { contact } = await createContactWithIdentity("webchat", { name: "Rosa" });
    const first = await book("2026-09-28T10:00", { contactId: contact.id });
    const second = await book("2026-09-30T10:00", { contactId: contact.id });
    await book("2026-09-29T10:00", { contactId: null, isTest: true });
    expect((await listContactBookings(users.viewer.actor, contact.id)).map((item) => item.id)).toEqual([second.id, first.id]);
    const next = await nextBookingsOf(users.viewer.actor, [contact.id, crypto.randomUUID()], { now: NOW });
    expect(next.get(contact.id)?.id).toBe(first.id);
    expect(next.size).toBe(1);
  });
});

describe("telling the customer what a person did [AGD-23]", () => {
  it("moving or confirming with «Avisar al cliente» sends one message by the booking's conversation", async () => {
    const channel = await createChannel({ type: "webchat" });
    const { contact } = await createContactWithIdentity("webchat", { name: "Marcos" });
    const conversation = await createConversation(channel.id, contact.id);
    const booking = await createBookingByPerson(users.owner.actor, { serviceId: hair.dye.id, resourceId: "any", start: "2026-09-28T10:00", conversationId: conversation.id }, { now: NOW });
    expect(booking.status).toBe("pending");
    const confirmed = await setBookingStatus(users.owner.actor, { bookingId: booking.id, status: "confirmed", notifyCustomer: true }, { now: NOW });
    expect(confirmed.notice).toMatchObject({ sent: true });
    const quiet = await moveBooking(users.owner.actor, { bookingId: booking.id, start: "2026-09-28T11:00" }, { now: NOW });
    expect(quiet.notice).toBeNull();
    const sent = await db.select().from(messages).where(and(eq(messages.conversationId, conversation.id), eq(messages.direction, "outbound")));
    expect(sent.map((message) => message.text)).toEqual(["Tu cita de Tinte el lunes 28 de septiembre a las 10:00 está confirmada. ¡Te esperamos!"]);
  });
});

describe("test bookings of «Probar agente» [PRU-04] «Agenda: borrar las citas de prueba»", () => {
  it.each(["owner", "admin", "supervisor"] as const)("%s deletes them all at once, and only them", async (role) => {
    const real = await book("2026-09-28T10:00");
    await book("2026-09-28T11:00", { isTest: true, source: "ai" });
    expect(await countTestBookings(users[role].actor)).toBe(1);
    expect(await deleteTestBookings(users[role].actor)).toEqual({ deleted: 1 });
    expect((await db.select({ id: bookings.id }).from(bookings)).map((row) => row.id)).toEqual([real.id]);
  });

  it.each(["agent", "viewer"] as const)("%s cannot", async (role) => {
    await book("2026-09-28T11:00", { isTest: true, source: "ai" });
    await expect(deleteTestBookings(actorFor(role))).rejects.toBeInstanceOf(AuthError);
    expect(await db.select().from(bookings)).toHaveLength(1);
  });
});
