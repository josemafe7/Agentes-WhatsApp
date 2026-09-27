// «Nueva cita» from the contact's card and from a conversation, called directly as an attacker could ([SEG-04],
// [PER-01]): who may book, an Agent only for contacts and conversations of their channels ([PER-02]), Solo lectura
// never ([PER-03]), the same availability rules as the AI ([AGD-17]) and no double booking ([AGD-13]).
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { bookings, resources, services } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { createBooking } from "@/server/booking";
import { at, createHairdresser, NOW, TZ } from "@/server/booking/test-helpers";
import { formatLocalMinute } from "@/server/booking/time";
import { createChannel, createContactWithIdentity, createConversation, createUser, type TestUser } from "@/test/factories";

const state = vi.hoisted(() => ({ actor: null as Actor | null, refreshes: 0 }));

vi.mock("@/server/session", async () => {
  const { AuthError } = await import("@/server/errors");
  const { can } = await import("@/lib/permissions");
  return {
    requirePermission: async (action: Parameters<typeof can>[1]) => {
      if (!state.actor) throw new AuthError("unauthenticated");
      if (!can(state.actor, action)) throw new AuthError("forbidden");
      return state.actor;
    },
  };
});
vi.mock("next/cache", () => ({
  refresh: () => {
    state.refreshes++;
  },
}));

import { createContactBookingAction, findFreeSlotsAction, loadNewBookingFormAction } from "./actions";

const FORBIDDEN = { ok: false, error: "No tienes permiso para hacer esto." };
const EXPIRED = { ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." };

let users: Record<"owner" | "admin" | "supervisor" | "agentA" | "viewer", TestUser>;
let channelA: string;
let channelB: string;
let hair: Awaited<ReturnType<typeof createHairdresser>>;
let ana: string;
let bruno: string;
let anaConversation: string;
let brunoConversation: string;

const bookingRows = () => db.select().from(bookings);

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  channelA = (await createChannel({ name: "Chat de la web" })).id;
  channelB = (await createChannel({ name: "WhatsApp Recepción", type: "whatsapp", isDemo: true })).id;
  users = {
    owner: await createUser("owner"),
    admin: await createUser("admin"),
    supervisor: await createUser("supervisor"),
    agentA: await createUser("agent", { channelIds: [channelA] }),
    viewer: await createUser("viewer"),
  };
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  state.actor = null;
  state.refreshes = 0;
  hair = await createHairdresser();
  ana = (await createContactWithIdentity("webchat", { name: "Ana" })).contact.id;
  bruno = (await createContactWithIdentity("whatsapp", { name: "Bruno" })).contact.id;
  anaConversation = (await createConversation(channelA, ana)).id;
  brunoConversation = (await createConversation(channelB, bruno)).id;
});

const input = (overrides: Record<string, unknown> = {}) => ({ serviceId: hair.cut.id, resourceId: "any", start: "2026-09-28T10:00", ...overrides });

describe("«Nueva cita» from the contact's card [CTO-02] [PER-01] «Agenda: crear, editar, mover y cancelar citas»", () => {
  it.each(["owner", "admin", "supervisor", "agentA"] as const)("%s books for the contact, as a person, and the card refreshes", async (who) => {
    state.actor = users[who].actor;
    const result = await createContactBookingAction(input({ contactId: ana, notes: "  Primera vez  " }));
    expect(result).toMatchObject({ ok: true, message: "Cita creada.", data: { id: expect.any(String), status: "confirmed" } });
    const [row] = await bookingRows();
    expect(row).toMatchObject({ contactId: ana, contactName: "Ana", source: "human", createdByUserId: users[who].userId, conversationId: null, notes: "Primera vez", status: "confirmed" });
    expect(formatLocalMinute(row.startsAt, TZ)).toBe("2026-09-28T10:00");
    expect(state.refreshes).toBe(1);
  });

  it("Solo lectura cannot book, and nothing is created [PER-03]", async () => {
    state.actor = users.viewer.actor;
    expect(await createContactBookingAction(input({ contactId: ana }))).toEqual(FORBIDDEN);
    expect(await bookingRows()).toHaveLength(0);
    expect(state.refreshes).toBe(0);
  });

  it("an Agent cannot book for a contact of another channel [PER-02]", async () => {
    state.actor = users.agentA.actor;
    expect(await createContactBookingAction(input({ contactId: bruno }))).toEqual(FORBIDDEN);
    expect(await bookingRows()).toHaveLength(0);
  });

  it("without a session nothing happens", async () => {
    expect(await createContactBookingAction(input({ contactId: ana }))).toEqual(EXPIRED);
    expect(await bookingRows()).toHaveLength(0);
  });

  it("a service with manual confirmation is created pending and says so [AGD-22]", async () => {
    state.actor = users.supervisor.actor;
    const result = await createContactBookingAction(input({ serviceId: hair.dye.id, contactId: ana, start: "2026-09-28T16:00" }));
    expect(result).toMatchObject({ ok: true, message: "Cita creada. Queda pendiente de confirmar.", data: { status: "pending" } });
  });

  it("checks the input: exactly one contact or conversation, a valid time and nothing else", async () => {
    state.actor = users.owner.actor;
    expect(await createContactBookingAction(input())).toMatchObject({ ok: false, fieldErrors: { contactId: expect.any(Array) } });
    expect(await createContactBookingAction(input({ contactId: ana, conversationId: anaConversation }))).toMatchObject({ ok: false });
    expect(await createContactBookingAction(input({ contactId: ana, start: "28/09/2026 10:00" }))).toMatchObject({ ok: false, fieldErrors: { start: expect.any(Array) } });
    expect(await createContactBookingAction(input({ contactId: ana, status: "confirmed" }))).toMatchObject({ ok: false });
    expect(await createContactBookingAction(input({ contactId: ana, contactName: "Otra persona" }))).toMatchObject({ ok: false });
    expect(await bookingRows()).toHaveLength(0);
  });
});

describe("«Nueva cita» from a conversation [AGD-14] [AGD-19] [BAN-15]", () => {
  it("links the conversation, its channel and its contact; source is a person", async () => {
    state.actor = users.agentA.actor;
    const result = await createContactBookingAction(input({ conversationId: anaConversation }));
    expect(result).toMatchObject({ ok: true });
    const [row] = await bookingRows();
    expect(row).toMatchObject({ contactId: ana, conversationId: anaConversation, channelId: channelA, source: "human", createdByUserId: users.agentA.userId });
  });

  it("an Agent cannot book from a conversation of another channel; Solo lectura never [PER-02] [PER-03]", async () => {
    state.actor = users.agentA.actor;
    expect(await createContactBookingAction(input({ conversationId: brunoConversation }))).toEqual(FORBIDDEN);
    state.actor = users.viewer.actor;
    expect(await createContactBookingAction(input({ conversationId: anaConversation }))).toEqual(FORBIDDEN);
    expect(await bookingRows()).toHaveLength(0);
  });
});

describe("a slot taken meanwhile [AGD-13]", () => {
  it("is refused with «Ese hueco ya no está libre» and the closest free alternatives; nothing is double booked", async () => {
    const system = { type: "user" as const, userId: users.owner.userId, name: users.owner.name };
    for (const resourceId of [hair.laura.id, hair.marta.id]) {
      await createBooking({ serviceId: hair.cut.id, resourceId, start: at("2026-09-28T10:00"), contactId: null, contactName: "Otro", source: "human", actor: system });
    }
    state.actor = users.supervisor.actor;
    const result = await createContactBookingAction(input({ contactId: ana }));
    expect(result).toMatchObject({ ok: false, error: "Ese hueco ya no está libre." });
    const alternatives = !result.ok && "alternatives" in result ? (result.alternatives ?? []) : [];
    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives.length).toBeLessThanOrEqual(3);
    expect(alternatives.map((choice) => choice.value)).toContain("2026-09-28T10:30");
    expect(alternatives[0]).toMatchObject({ date: "2026-09-28", dayLabel: "lunes 28 de septiembre", time: expect.stringMatching(/^\d{2}:\d{2}$/) });
    expect(await bookingRows()).toHaveLength(2);
    expect(state.refreshes).toBe(0);
  });
});

describe("free slots in the dialog [AGD-08] [AGD-09] [AGD-17] «Agenda: ver citas y disponibilidad»", () => {
  it.each(["owner", "admin", "supervisor", "agentA", "viewer"] as const)("%s sees the free slots of a day, as the AI would", async (who) => {
    state.actor = users[who].actor;
    const result = await findFreeSlotsAction({ serviceId: hair.cut.id, resourceId: "any", date: "2026-09-28" });
    expect(result).toMatchObject({ ok: true, data: { reason: null, next: { date: "2026-09-29", dayLabel: "martes 29 de septiembre" } } });
    const times = result.ok ? (result.data?.slots ?? []).map((choice) => choice.time) : [];
    expect(times.slice(0, 3)).toEqual(["09:00", "09:30", "10:00"]);
    expect(times).not.toContain("14:00");
    expect(times).toContain("16:00");
  });

  it("a taken slot disappears; a closed day points to the next day with slots", async () => {
    const system = { type: "user" as const, userId: users.owner.userId, name: users.owner.name };
    await createBooking({ serviceId: hair.cut.id, resourceId: hair.laura.id, start: at("2026-09-28T09:00"), contactId: null, contactName: "Otro", source: "human", actor: system });
    state.actor = users.owner.actor;
    const laura = await findFreeSlotsAction({ serviceId: hair.cut.id, resourceId: hair.laura.id, date: "2026-09-28" });
    expect(laura.ok && laura.data?.slots[0]?.time).toBe("09:30");
    const sunday = await findFreeSlotsAction({ serviceId: hair.cut.id, resourceId: "any", date: "2026-09-27" });
    expect(sunday).toMatchObject({ ok: true, data: { slots: [], next: { date: "2026-09-28" }, reason: null } });
  });

  it("explains why a request can never fit, and checks the input", async () => {
    state.actor = users.owner.actor;
    expect(await findFreeSlotsAction({ serviceId: hair.cut.id, resourceId: "any", date: "2026-09-28", people: 3 })).toMatchObject({
      ok: true,
      data: { slots: [], reason: "El número de personas no está entre el mínimo y el máximo del servicio." },
    });
    expect(await findFreeSlotsAction({ serviceId: hair.cut.id, resourceId: "any", date: "2026-02-30" })).toMatchObject({ ok: false, fieldErrors: { date: expect.any(Array) } });
    expect(await findFreeSlotsAction({ serviceId: "corte", resourceId: "any", date: "2026-09-28" })).toMatchObject({ ok: false });
  });

  it("without a session nothing is read", async () => {
    expect(await findFreeSlotsAction({ serviceId: hair.cut.id, resourceId: "any", date: "2026-09-28" })).toEqual(EXPIRED);
    expect(await loadNewBookingFormAction()).toEqual(EXPIRED);
  });
});

describe("the dialog's options [AGD-01] [AGD-03] [AGD-28]", () => {
  it("offers the active services and resources in the business's words, from today in its time zone", async () => {
    await db.update(services).set({ active: false }).where(eq(services.id, hair.dye.id));
    state.actor = users.agentA.actor;
    const result = await loadNewBookingFormAction();
    expect(result).toMatchObject({ ok: true, data: { today: "2026-09-27", canConfigure: false, words: { newBooking: "Nueva cita", resource: "Profesional" } } });
    const data = result.ok ? result.data : undefined;
    expect(data?.services.map((service) => service.name)).toEqual(["Corte"]);
    expect(data?.services[0]).toMatchObject({ durationMin: 30, minPeople: 1, maxPeople: 1, requiresManualConfirmation: false });
    expect(data?.services[0].resourceIds.sort()).toEqual([hair.laura.id, hair.marta.id].sort());
    expect(data?.resources.map((resource) => resource.name)).toEqual(["Laura", "Marta"]);
    state.actor = users.owner.actor;
    expect(await loadNewBookingFormAction()).toMatchObject({ ok: true, data: { canConfigure: true } });
  });

  it("an inactive resource is not offered for new bookings [AGD-03]", async () => {
    await db.update(resources).set({ active: false }).where(eq(resources.id, hair.marta.id));
    state.actor = users.supervisor.actor;
    const result = await loadNewBookingFormAction();
    const data = result.ok ? result.data : undefined;
    expect(data?.resources.map((resource) => resource.name)).toEqual(["Laura"]);
    expect(data?.services.find((service) => service.id === hair.cut.id)?.resourceIds).toEqual([hair.laura.id]);
  });
});
