// «Citas» on the contact's card ([CTO-02]): who sees them and who gets «Nueva cita» ([PER-01] «Agenda: ver citas»,
// «Agenda: crear…», «Contactos: ver fichas»), an Agent only for contacts of their channels ([PER-02]) and test bookings
// of «Probar agente» never mixed in ([PRU-04]).
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/lib/enums";
import { cancelBooking, createBooking, type BookingActor } from "@/server/booking";
import { at, createHairdresser, NOW, TZ } from "@/server/booking/test-helpers";
import { createChannel, createContactWithIdentity, createConversation, createUser, type TestUser } from "@/test/factories";
import { loadContactBookings } from "./load";

let users: Record<Role, TestUser>;
let agentA: TestUser;
let system: BookingActor;
let hair: Awaited<ReturnType<typeof createHairdresser>>;
let ana: string;
let bruno: string;
let channelA: string;

beforeAll(async () => {
  channelA = (await createChannel({ name: "Chat de la web" })).id;
  users = {
    owner: await createUser("owner"),
    admin: await createUser("admin"),
    supervisor: await createUser("supervisor"),
    agent: await createUser("agent"),
    viewer: await createUser("viewer"),
  };
  agentA = await createUser("agent", { channelIds: [channelA] });
  system = { type: "user", userId: users.owner.userId, name: users.owner.name };
});

beforeEach(async () => {
  hair = await createHairdresser();
  const channelB = (await createChannel({ name: "WhatsApp Recepción", type: "whatsapp", isDemo: true })).id;
  ana = (await createContactWithIdentity("webchat", { name: "Ana" })).contact.id;
  bruno = (await createContactWithIdentity("whatsapp", { name: "Bruno" })).contact.id;
  await createConversation(channelA, ana);
  await createConversation(channelB, bruno);
});

const book = (start: string, overrides: { contactId: string | null; isTest?: boolean }) =>
  createBooking({ serviceId: hair.cut.id, resourceId: hair.laura.id, start: at(start), contactName: "Cliente", source: "human", actor: system, now: NOW, ...overrides });

describe("«Citas» on the contact's card [CTO-02]", () => {
  it.each(["owner", "admin", "supervisor", "agent", "viewer"] as const)("%s sees the upcoming and past bookings; «Nueva cita» only for who may book", async (role) => {
    const upcoming = await book("2026-09-29T10:00", { contactId: ana });
    const past = await book("2026-09-28T10:00", { contactId: ana });
    const cancelled = await book("2026-09-30T10:00", { contactId: ana });
    await cancelBooking({ bookingId: cancelled.id, actor: system, now: NOW });
    await book("2026-09-29T11:00", { contactId: null, isTest: true });
    await book("2026-09-29T12:00", { contactId: bruno });
    const card = await loadContactBookings(users[role].actor, ana, at("2026-09-28T12:00"));
    expect(card).toMatchObject({ timezone: TZ, canBook: role !== "viewer", words: { title: "Citas", newBooking: "Nueva cita" } });
    expect(card?.upcoming.map((item) => item.id)).toEqual([upcoming.id]);
    expect(card?.past.map((item) => item.id)).toEqual([cancelled.id, past.id]);
  });

  it("an Agent does not see the bookings of a contact of another channel [PER-02]", async () => {
    await book("2026-09-29T12:00", { contactId: bruno });
    expect(await loadContactBookings(agentA.actor, bruno, NOW)).toBeNull();
    expect(await loadContactBookings(agentA.actor, ana, NOW)).toMatchObject({ canBook: true, upcoming: [], past: [] });
  });

  it("an unknown contact reads as nothing for an Agent limited to some channels", async () => {
    expect(await loadContactBookings(agentA.actor, crypto.randomUUID(), NOW)).toBeNull();
    expect(await loadContactBookings(agentA.actor, "no-es-un-id", NOW)).toBeNull();
  });
});
