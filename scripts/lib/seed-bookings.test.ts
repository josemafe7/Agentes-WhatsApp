// Demo agenda of `pnpm seed` (seed/steps/bookings.ts): bookings relative to the day the demo is loaded, in every
// status, from the AI (linked to the demo conversations), from people and from «Probar agente», plus an absence and
// a block ([ARR-06]–[ARR-08], [ARR-10], [AGD-06], [AGD-09], [AGD-11], [AGD-13], [AGD-14], [AGD-22], [PRU-04]).
// Every booking must be one the availability engine would accept: no overlaps, capacity never exceeded, inside the
// opening hours and the resource's schedule, away from closures and time off, and booked within the advance limits
// on the day it was made. (Kept here because Vitest only collects tests under src/ and scripts/.)
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBooking, listBookings, listContactBookings, nextBookingsOf, countTestBookings } from "@/data/bookings";
import { listMyNotifications } from "@/data/notifications";
import { db } from "@/db";
import {
  agents,
  aiRuns,
  bookingEvents,
  bookings,
  businessSettings,
  channels,
  contacts,
  conversations,
  jobs,
  messages,
  reminderSettings,
  resources,
  resourceTimeOff,
  serviceResources,
  services,
  user,
  userRoles,
  whatsappTemplates,
} from "@/db/schema";
import { SECTORS, type BookingStatus, type Role, type Sector } from "@/lib/enums";
import type { ClosureRange } from "@/lib/opening-hours";
import type { Actor } from "@/lib/permissions";
import { getSectorPreset, type SectorPreset } from "@/lib/sectors";
import {
  addDays,
  type AvailabilityBooking,
  type AvailabilityResource,
  type AvailabilityService,
  freeResourcesForStart,
  instantToLocal,
  isReminderFieldKey,
  loadEngineData,
  localToInstant,
  OCCUPYING_STATUSES,
} from "@/server/booking";
import { DEMO_BUSINESSES } from "../../seed/businesses";
import { buildDemoAgenda, type DemoAgendaInput, type DemoAgendaPlan, type DemoBookingPlan } from "../../seed/steps/bookings";
import { SECTOR_BOOKINGS } from "../../seed/steps/conversation-scripts";
import { demoBookingSlot } from "../../seed/steps/conversations";
import { DEMO_USERS } from "../../seed/users";
import { runSeedCommand } from "./seed-command";
import { captureOutput, emptyDatabase, tableCounts } from "./testing";

const DEMO_ENV = { DEMO_MODE: "true", NODE_ENV: "development" };
const NOW = new Date("2026-09-26T10:00:00Z");
const TZ = "Europe/Madrid";
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const BOOKING_TOOLS = ["listar_servicios", "consultar_disponibilidad", "crear_cita", "ver_citas_del_cliente", "cancelar_cita", "reprogramar_cita", "guardar_datos_contacto"];

// ─── The engine's view of a plan (built here from the preset, not from the step's own helpers) ────────────

function engineService(preset: SectorPreset, key: string): AvailabilityService {
  const service = preset.services.find((candidate) => candidate.key === key);
  if (!service) throw new Error(`Servicio desconocido: ${key}`);
  return { ...service, id: service.key, active: true, resourceIds: service.resourceKeys };
}

function engineResources(preset: SectorPreset, plan: DemoAgendaPlan): AvailabilityResource[] {
  return preset.resources.map((resource) => ({
    id: resource.key,
    capacity: resource.capacity,
    active: true,
    schedule: resource.schedule,
    timeOff: plan.timeOff.filter((off) => off.resourceKey === resource.key).map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
  }));
}

function asEngineBookings(list: readonly DemoBookingPlan[], statuses: readonly BookingStatus[]): AvailabilityBooking[] {
  return list
    .filter((booking) => statuses.includes(booking.status))
    .map((booking) => ({
      id: booking.key,
      resourceId: booking.resourceKey,
      blockedStartAt: booking.blockedStartAt,
      blockedEndAt: booking.blockedEndAt,
      people: booking.people,
      // Occupancy only: every listed booking takes its place.
      status: "confirmed",
    }));
}

type FitOptions = { statuses: readonly BookingStatus[]; now: Date; ignoreAdvance: boolean };

/** Would the engine accept this booking, given the others? */
function engineAccepts(input: DemoAgendaInput, plan: DemoAgendaPlan, booking: DemoBookingPlan, options: FitOptions): boolean {
  const { preset } = input;
  const result = freeResourcesForStart({
    service: engineService(preset, booking.serviceKey),
    resources: engineResources(preset, plan),
    bookings: asEngineBookings(plan.bookings, options.statuses),
    businessHours: preset.businessHours,
    closures: input.closures,
    timezone: input.timeZone,
    mode: preset.agendaMode,
    from: booking.startsAt,
    resourceId: booking.resourceKey,
    people: booking.people,
    stepMinutes: preset.slotIntervalMin,
    now: options.now,
    durationMin: Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / MINUTE_MS),
    excludeBookingId: booking.key,
    ignoreAdvance: options.ignoreAdvance,
  });
  return result.resources.some((free) => free.resourceId === booking.resourceKey);
}

/** Closures as the hours step writes them: a holiday in 9 days and two days of training in 40 ([ARR-07]). */
function demoClosures(now: Date): ClosureRange[] {
  const today = instantToLocal(now, TZ).date;
  return [
    { startDate: addDays(today, 9), endDate: addDays(today, 9) },
    { startDate: addDays(today, 40), endDate: addDays(today, 41) },
  ];
}

function inputFor(sector: Sector, now: Date = NOW): DemoAgendaInput {
  return {
    sector,
    preset: getSectorPreset(sector),
    business: DEMO_BUSINESSES[sector],
    now,
    timeZone: TZ,
    closures: demoClosures(now),
    // The «reserva» conversation starts 22 h before the load and the AI confirms four minutes later.
    reservaConfirmedAt: new Date(now.getTime() - 22 * HOUR_MS + 257 * 1_000),
  };
}

const localDay = (instant: Date) => instantToLocal(instant, TZ).date;
const nonCancelled: BookingStatus[] = ["pending", "confirmed", "completed", "no_show"];

// ─── Every sector, several load days (a Saturday, a Tuesday morning, both changes of time) ────────────────

const LOAD_DAYS = [
  new Date("2026-09-26T10:00:00Z"),
  new Date("2026-10-20T07:30:00Z"),
  new Date("2026-10-25T18:00:00Z"),
  new Date("2027-03-24T19:00:00Z"),
];

describe.each(SECTORS)("demo agenda of %s [ARR-10]", (sector) => {
  const cases = LOAD_DAYS.map((now) => {
    const input = inputFor(sector, now);
    return { now, input, plan: buildDemoAgenda(input) };
  });

  it("[AGD-09] [AGD-13] every booking is one the availability engine accepts next to the others: no overlaps, inside hours and schedules, away from closures and time off", () => {
    for (const { now, input, plan } of cases) {
      for (const booking of plan.bookings) {
        const label = `${now.toISOString()} ${booking.key} ${booking.startsAt.toISOString()}`;
        // As the app sees it: pending and confirmed bookings take the slot.
        if (OCCUPYING_STATUSES.includes(booking.status)) {
          expect(engineAccepts(input, plan, booking, { statuses: OCCUPYING_STATUSES, now, ignoreAdvance: true }), label).toBe(true);
        }
        // As it happened: completed and no-show bookings also had their place when they were made.
        if (booking.status !== "cancelled") {
          expect(engineAccepts(input, plan, booking, { statuses: nonCancelled, now, ignoreAdvance: true }), label).toBe(true);
        }
      }
    }
  });

  it("[AGD-09] every booking was made within the service's advance limits, on the day it was made", () => {
    for (const { input, plan } of cases) {
      for (const booking of plan.bookings) {
        const statuses = booking.status === "cancelled" ? [] : nonCancelled;
        expect(engineAccepts(input, plan, booking, { statuses, now: booking.createdAt, ignoreAdvance: false }), booking.key).toBe(true);
      }
    }
  });

  it("[AGD-06] [AGD-11] individual resources take one booking at a time; capacity resources never go over their capacity", () => {
    for (const { input, plan } of cases) {
      for (const resource of input.preset.resources) {
        const taken = plan.bookings.filter((booking) => booking.resourceKey === resource.key && booking.status !== "cancelled");
        // The load only rises when a booking starts: check every start.
        for (const moment of taken.map((booking) => booking.blockedStartAt.getTime())) {
          const load = taken.filter((booking) => booking.blockedStartAt.getTime() <= moment && moment < booking.blockedEndAt.getTime()).reduce((sum, booking) => sum + (input.preset.agendaMode === "individual" ? 1 : booking.people), 0);
          expect(load, `${resource.key} ${new Date(moment).toISOString()}`).toBeLessThanOrEqual(input.preset.agendaMode === "individual" ? 1 : resource.capacity);
        }
      }
    }
  });

  it("[ARR-07] bookings in the past two weeks, today when the business opens and the coming days; none on a closure", () => {
    for (const { now, input, plan } of cases) {
      const today = localDay(now);
      const real = plan.bookings.filter((booking) => !booking.isTest);
      expect(real.filter((booking) => booking.endsAt < now).length).toBeGreaterThanOrEqual(10);
      expect(real.filter((booking) => booking.startsAt > now).length).toBeGreaterThanOrEqual(10);
      expect(real.every((booking) => booking.startsAt.getTime() > now.getTime() - 30 * DAY_MS && booking.startsAt.getTime() < now.getTime() + 30 * DAY_MS)).toBe(true);
      const opensToday = input.preset.businessHours.some((range) => range.weekday === instantToLocal(now, TZ).weekday);
      if (opensToday && !input.closures.some((closure) => closure.startDate <= today && today <= closure.endDate)) {
        expect(real.some((booking) => localDay(booking.startsAt) === today), `${now.toISOString()} hoy`).toBe(true);
      }
      for (const booking of plan.bookings) {
        const day = localDay(booking.startsAt);
        expect(input.closures.some((closure) => closure.startDate <= day && day <= closure.endDate), booking.key).toBe(false);
      }
    }
  });

  it("[AGD-14] a mix of statuses, each one coherent with the time: done in the past, waiting or confirmed ahead", () => {
    for (const { now, plan } of cases) {
      const statuses = new Set(plan.bookings.map((booking) => booking.status));
      expect([...statuses].sort()).toEqual(["cancelled", "completed", "confirmed", "no_show", "pending"]);
      for (const booking of plan.bookings) {
        expect(booking.createdAt.getTime(), booking.key).toBeLessThan(now.getTime());
        expect(booking.startsAt.getTime(), booking.key).toBeLessThan(booking.endsAt.getTime());
        if (booking.status === "completed" || booking.status === "no_show") expect(booking.endsAt.getTime(), booking.key).toBeLessThanOrEqual(now.getTime());
        if (booking.status === "pending") expect(booking.startsAt.getTime(), booking.key).toBeGreaterThan(now.getTime());
        if (booking.status === "cancelled") {
          expect(booking.cancelledAt, booking.key).not.toBeNull();
          expect(booking.cancelledAt?.getTime() ?? 0, booking.key).toBeLessThanOrEqual(Math.min(now.getTime(), booking.startsAt.getTime()));
          expect(booking.cancelledAt?.getTime() ?? 0, booking.key).toBeGreaterThan(booking.createdAt.getTime());
        } else {
          expect(booking.cancelledAt, booking.key).toBeNull();
        }
      }
      // Both kinds of cancellation: of a past date and of one still ahead.
      expect(plan.bookings.some((booking) => booking.status === "cancelled" && booking.startsAt < now)).toBe(true);
      expect(plan.bookings.some((booking) => booking.status === "cancelled" && booking.startsAt > now)).toBe(true);
    }
  });

  it("[AGD-15] each booking's history starts with its creation and leads, in order, to its current status", () => {
    for (const { now, plan } of cases) {
      for (const booking of plan.bookings) {
        const [created, ...rest] = booking.events;
        expect(created, booking.key).toMatchObject({ action: "created", at: booking.createdAt, actor: booking.createdBy });
        const times = booking.events.map((event) => event.at.getTime());
        expect(times, booking.key).toEqual([...times].sort((a, b) => a - b));
        expect(new Set(times).size, booking.key).toBe(times.length);
        expect(Math.max(...times), booking.key).toBeLessThanOrEqual(now.getTime());
        let status: BookingStatus = created.action === "created" ? created.status : "confirmed";
        for (const event of rest) {
          if (event.action === "status_changed" || event.action === "cancelled") {
            expect(event.from, booking.key).toBe(status);
            status = event.to;
          }
        }
        expect(status, booking.key).toBe(booking.status);
        if (booking.status === "cancelled") expect(booking.events.at(-1)?.action).toBe("cancelled");
      }
      // Someone moved a booking to another time ([AGD-17]).
      expect(plan.bookings.some((booking) => booking.events.some((event) => event.action === "moved"))).toBe(true);
    }
  });

  it("[AGD-22] pending bookings are of services the team confirms, or were left pending by a person", () => {
    for (const { input, plan } of cases) {
      const manual = new Set(input.preset.services.filter((service) => service.requiresManualConfirmation).map((service) => service.key));
      const pending = plan.bookings.filter((booking) => booking.status === "pending");
      expect(pending.length).toBeGreaterThanOrEqual(1);
      for (const booking of pending) {
        expect(manual.has(booking.serviceKey) || (booking.source === "human" && booking.createdBy.kind === "person"), booking.key).toBe(true);
      }
      if (manual.size > 0) expect(pending.some((booking) => manual.has(booking.serviceKey))).toBe(true);
      // A booking of a manual service starts pending, whoever makes it, until the team confirms it.
      for (const booking of plan.bookings.filter((candidate) => manual.has(candidate.serviceKey))) {
        expect(booking.events[0], booking.key).toMatchObject({ action: "created", status: "pending" });
      }
    }
  });

  it("[ARR-08] [AGD-14] [AGD-19] the AI's bookings keep their channel, conversation and contact; people's bookings, who made them", () => {
    for (const { plan } of cases) {
      const real = plan.bookings.filter((booking) => !booking.isTest);
      const byAi = real.filter((booking) => booking.source === "ai");
      expect(byAi.length).toBeGreaterThanOrEqual(2);
      for (const booking of byAi) {
        expect(booking.createdBy, booking.key).toEqual({ kind: "ai" });
        expect(booking.channelKey, booking.key).toBe("whatsapp");
        expect(booking.conversationKey, booking.key).not.toBeNull();
        expect(booking.contactKey, booking.key).not.toBeNull();
      }
      const byPeople = real.filter((booking) => booking.source === "human");
      expect(byPeople.length).toBeGreaterThanOrEqual(10);
      for (const booking of byPeople) {
        expect(booking.createdBy.kind, booking.key).toBe("person");
        expect(booking.channelKey, booking.key).toBeNull();
        expect(booking.contactName.trim(), booking.key).not.toBe("");
      }
      expect(real.every((booking) => !/undefined|NaN|null/.test(`${booking.contactName} ${booking.notes ?? ""} ${booking.cancelReason ?? ""}`))).toBe(true);
    }
  });

  it("[ARR-08] the booking the AI confirmed in the «reserva» conversation is in the agenda, at the time it said", () => {
    for (const { input, plan } of cases) {
      const slot = demoBookingSlot(input);
      const choice = SECTOR_BOOKINGS[sector];
      const booking = plan.bookings.find((candidate) => candidate.conversationKey === "reserva" && candidate.startsAt > input.now);
      expect(booking).toMatchObject({
        source: "ai",
        contactKey: "laura",
        channelKey: "whatsapp",
        serviceKey: choice.service,
        resourceKey: choice.resource,
        startsAt: localToInstant(slot.date, slot.minutes, TZ),
        status: "confirmed",
        isTest: false,
      });
      // Made by crear_cita just before the AI's confirmation.
      expect(input.reservaConfirmedAt.getTime() - (booking?.createdAt.getTime() ?? 0)).toBeGreaterThan(0);
      expect(input.reservaConfirmedAt.getTime() - (booking?.createdAt.getTime() ?? 0)).toBeLessThan(MINUTE_MS);
    }
  });

  it("[PRU-04] bookings made from «Probar agente» are test bookings of the agent, with no contact or channel", () => {
    for (const { now, plan } of cases) {
      const tests = plan.bookings.filter((booking) => booking.isTest);
      expect(tests.length).toBeGreaterThanOrEqual(1);
      for (const booking of tests) {
        expect(booking).toMatchObject({ source: "ai", contactKey: null, channelKey: null, conversationKey: null, createdBy: { kind: "ai" } });
        expect(booking.startsAt.getTime()).toBeGreaterThan(now.getTime());
      }
    }
  });

  it("[AGD-02] [AGD-18] a resource has an absence or a block, and a short block on another day", () => {
    for (const { now, plan } of cases) {
      expect(plan.timeOff.length).toBeGreaterThanOrEqual(2);
      expect(plan.timeOff.some((off) => off.endsAt.getTime() - off.startsAt.getTime() >= DAY_MS)).toBe(true);
      expect(plan.timeOff.some((off) => off.kind === "block" && off.endsAt.getTime() - off.startsAt.getTime() < DAY_MS)).toBe(true);
      for (const off of plan.timeOff) {
        expect(off.startsAt.getTime()).toBeGreaterThan(now.getTime());
        expect(off.createdAt.getTime()).toBeLessThan(now.getTime());
        expect(off.reason.trim()).not.toBe("");
      }
    }
  });

  it("the same load day gives the same agenda", () => {
    const input = inputFor(sector);
    expect(buildDemoAgenda(input)).toEqual(buildDemoAgenda(input));
  });
});

describe("demo agenda by sector", () => {
  it("[AGD-06] [AGD-11] the restaurant books tables by capacity, with groups and busy services, never over capacity", () => {
    for (const now of LOAD_DAYS) {
      const input = inputFor("restaurante", now);
      const plan = buildDemoAgenda(input);
      expect(input.preset.agendaMode).toBe("capacity");
      const groups = plan.bookings.filter((booking) => booking.serviceKey === "grupo");
      expect(groups.some((booking) => booking.status === "pending" && booking.people >= 9)).toBe(true);
      expect(groups.some((booking) => booking.status === "completed")).toBe(true);
      expect(groups.every((booking) => booking.resourceKey === "comedor")).toBe(true);
      const tables = plan.bookings.filter((booking) => booking.serviceKey === "reserva-mesa");
      expect(new Set(tables.map((booking) => booking.people)).size).toBeGreaterThanOrEqual(3);
      expect(tables.every((booking) => Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / MINUTE_MS) === 90)).toBe(true);
      // At some moment a room is at least half full: the demo shows the capacity at work.
      const busiest = Math.max(
        ...input.preset.resources.flatMap((room) => {
          const taken = plan.bookings.filter((booking) => booking.resourceKey === room.key && booking.status !== "cancelled");
          return taken.map((booking) => taken.filter((other) => other.blockedStartAt <= booking.blockedStartAt && booking.blockedStartAt < other.blockedEndAt).reduce((sum, other) => sum + other.people, 0) / room.capacity);
        }),
      );
      expect(busiest).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("[AGD-06] the hair salon books each professional on their own working days, with the services they do", () => {
    const input = inputFor("peluqueria");
    const plan = buildDemoAgenda(input);
    for (const resource of input.preset.resources) {
      const own = plan.bookings.filter((booking) => booking.resourceKey === resource.key);
      expect(own.length, resource.key).toBeGreaterThanOrEqual(10);
      for (const booking of own) {
        expect(resource.schedule.some((range) => range.weekday === instantToLocal(booking.startsAt, TZ).weekday), booking.key).toBe(true);
        expect(input.preset.services.find((service) => service.key === booking.serviceKey)?.resourceKeys, booking.key).toContain(resource.key);
      }
    }
  });

  it("[ARR-08] demo contacts have the bookings their conversations talk about", () => {
    const plan = buildDemoAgenda(inputFor("peluqueria"));
    const of = (contact: string) => plan.bookings.filter((booking) => booking.contactKey === contact);
    // Laura is a regular: an earlier visit, one she cancelled through WhatsApp and the one she just booked.
    expect(of("laura").map((booking) => booking.status).sort()).toEqual(["cancelled", "completed", "confirmed"]);
    expect(of("laura").find((booking) => booking.status === "cancelled")?.events.at(-1)?.actor).toEqual({ kind: "ai" });
    // Beatriz's dye last Saturday, and Cristina's last booking, the one she asks the invoice for.
    const [dye] = of("beatriz");
    expect(dye).toMatchObject({ serviceKey: "tinte-raiz", status: "completed" });
    expect(instantToLocal(dye.startsAt, TZ).weekday).toBe(6);
    expect(of("cristina")).toHaveLength(1);
    expect(of("cristina")[0].status).toBe("completed");
  });
});

// ─── Loaded into the database with `pnpm seed` ───────────────────────────────────────────────────────────

async function seed(argv: string[] = []) {
  const code = await runSeedCommand(argv, { out: captureOutput(), env: DEMO_ENV, now: NOW });
  expect(code).toBe(0);
}

async function demoActor(role: Role): Promise<Actor> {
  const demoUser = DEMO_USERS.find((candidate) => candidate.role === role);
  const [row] = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .innerJoin(userRoles, eq(userRoles.userId, user.id))
    .where(eq(user.email, demoUser?.email ?? ""));
  return { userId: row.id, role, name: row.name, channelIds: null };
}

async function conversationOf(contactName: string) {
  const [row] = await db
    .select({ conversation: conversations })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(contacts.name, contactName));
  return row.conversation;
}

/** Every pending or confirmed booking in the database, checked by the engine against what the app loads. */
async function expectEngineAcceptsDatabase(): Promise<number> {
  const [settings] = await db.select().from(businessSettings);
  const serviceRows = await db.select().from(services);
  const resourceIds = (await db.select({ id: resources.id }).from(resources)).map((row) => row.id);
  const from = new Date(NOW.getTime() - 20 * DAY_MS);
  const to = new Date(NOW.getTime() + 20 * DAY_MS);
  const data = await loadEngineData(db, { resourceIds, from, to, timezone: settings.timezone });
  const rows = await db.select().from(bookings).where(inArray(bookings.status, [...OCCUPYING_STATUSES]));
  const links = await db.select().from(serviceResources);
  for (const booking of rows) {
    const service = serviceRows.find((row) => row.id === booking.serviceId);
    if (!service) throw new Error("Servicio de la cita no encontrado.");
    const result = freeResourcesForStart({
      service: { ...service, resourceIds: links.filter((link) => link.serviceId === service.id).map((link) => link.resourceId) },
      ...data,
      timezone: settings.timezone,
      mode: settings.agendaMode,
      from: booking.startsAt,
      resourceId: booking.resourceId,
      people: booking.people,
      stepMinutes: settings.slotIntervalMin,
      now: NOW,
      durationMin: Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / MINUTE_MS),
      excludeBookingId: booking.id,
      ignoreAdvance: true,
    });
    expect(result.resources.map((free) => free.resourceId), `${booking.contactName} ${booking.startsAt.toISOString()}`).toContain(booking.resourceId);
  }
  return rows.length;
}

describe("demo agenda (pnpm seed)", () => {
  beforeAll(async () => {
    await emptyDatabase();
    await seed();
  });

  it("[AGD-13] the loaded agenda is one the availability engine accepts, as the app reads it", async () => {
    expect(await expectEngineAcceptsDatabase()).toBeGreaterThan(20);
  });

  it("[ARR-08] [AGD-19] the «reserva» conversation links to the booking the AI made, with its contact, channel and history", async () => {
    const conversation = await conversationOf("Laura Gil");
    const [whatsapp] = await db.select().from(channels).where(eq(channels.type, "whatsapp"));
    const linked = await db.select().from(bookings).where(and(eq(bookings.conversationId, conversation.id), eq(bookings.status, "confirmed")));
    expect(linked).toHaveLength(1);
    const [booking] = linked;
    expect(booking).toMatchObject({ source: "ai", contactId: conversation.contactId, channelId: whatsapp.id, isTest: false, contactName: "Laura Gil" });
    expect(booking.startsAt.getTime()).toBeGreaterThan(NOW.getTime());

    const owner = await demoActor("owner");
    const detail = await getBooking(owner, booking.id);
    const [reception] = await db.select().from(agents).where(eq(agents.id, whatsapp.activeAgentId ?? ""));
    expect(detail).toMatchObject({ createdByName: reception.name, channel: { id: whatsapp.id }, conversationId: conversation.id });
    expect(detail.history[0]).toMatchObject({ action: "created", actorType: "ai", actorName: reception.name });
    expect(detail.history[0].changes).toMatchObject({ status: "confirmed", source: "ai", agentId: reception.id, resourceId: booking.resourceId });

    // The AI looked the slot up and booked it with its tools ([HER-01]).
    const aiMessages = await db.select().from(messages).where(and(eq(messages.conversationId, conversation.id), eq(messages.senderType, "ai"))).orderBy(asc(messages.createdAt));
    const runs = await db.select().from(aiRuns).where(inArray(aiRuns.messageId, aiMessages.map((message) => message.id)));
    const toolsOf = (messageId: string) => runs.find((run) => run.messageId === messageId)?.toolsUsed.map((tool) => tool.name);
    expect(toolsOf(aiMessages[0].id)).toEqual(["consultar_disponibilidad"]);
    expect(toolsOf(aiMessages[1].id)).toEqual(["crear_cita"]);
    expect(booking.createdAt.getTime()).toBeLessThan(aiMessages[1].createdAt.getTime());
  });

  it("[CTO-01] [CTO-02] the contact card lists a contact's bookings and the contacts list shows the next one", async () => {
    const owner = await demoActor("owner");
    const lauraId = (await conversationOf("Laura Gil")).contactId ?? "";
    const cards = await listContactBookings(owner, lauraId);
    expect(cards.map((booking) => booking.status).sort()).toEqual(["cancelled", "completed", "confirmed"]);
    const next = await nextBookingsOf(owner, [lauraId], { now: NOW });
    expect(next.get(lauraId)?.id).toBe(cards.find((booking) => booking.status === "confirmed")?.id);
    const beatriz = await conversationOf("Beatriz Molina");
    expect((await listContactBookings(owner, beatriz.contactId)).map((booking) => booking.status)).toEqual(["completed"]);
  });

  it("[AGD-16] [PRU-04] the calendar reads the demo through the data layer, with test bookings labelled and cancellations hidden by default", async () => {
    const viewer = await demoActor("viewer");
    const today = instantToLocal(NOW, TZ).date;
    const { bookings: shown } = await listBookings(viewer, { from: addDays(today, -14), to: addDays(today, 14) });
    expect(shown.length).toBeGreaterThan(40);
    expect(shown.some((booking) => booking.status === "cancelled" || booking.status === "no_show")).toBe(false);
    expect(shown.some((booking) => booking.isTest)).toBe(true);
    const { bookings: all } = await listBookings(viewer, { from: addDays(today, -14), to: addDays(today, 14), includeCancelled: true });
    expect(new Set(all.map((booking) => booking.status)).size).toBe(5);
    expect(await countTestBookings(viewer)).toBeGreaterThanOrEqual(1);
  });

  it("[AGD-15] every booking has its history, and each person-made booking names who made it", async () => {
    const rows = await db.select().from(bookings);
    const events = await db.select().from(bookingEvents);
    const people = DEMO_USERS.map((demoUser) => demoUser.name);
    for (const booking of rows) {
      const own = events.filter((event) => event.bookingId === booking.id);
      expect(own.some((event) => event.action === "created"), booking.id).toBe(true);
      if (booking.source === "human") {
        expect(booking.createdByUserId, booking.id).not.toBeNull();
        expect(people).toContain(booking.createdByName);
      }
    }
  });

  it("[AGD-22] a booking waiting for confirmation has notified the team in the app", async () => {
    const [pending] = await db.select().from(bookings).where(eq(bookings.status, "pending")).orderBy(asc(bookings.createdAt)).limit(1);
    expect(pending).toBeDefined();
    const supervisor = await demoActor("supervisor");
    const notices = (await listMyNotifications(supervisor)).filter((item) => item.link?.startsWith("/agenda?cita="));
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(notices[0].title).toMatch(/pendiente de confirmar/);
  });

  it("[AGD-24] the reminder is prepared with the demo's approved template but off, so nothing is scheduled", async () => {
    const [settings] = await db.select().from(reminderSettings);
    const [whatsapp] = await db.select().from(channels).where(eq(channels.type, "whatsapp"));
    expect(settings).toMatchObject({ enabled: false, leadMinutes: 1440, channel: "whatsapp_template", whatsappChannelId: whatsapp.id, templateLanguage: "es" });
    const [template] = await db
      .select()
      .from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.channelId, whatsapp.id), eq(whatsappTemplates.name, settings.templateName ?? "")));
    expect(template).toMatchObject({ status: "APPROVED", category: "UTILITY" });
    expect(Object.keys(settings.templateVariables).sort()).toEqual([...template.variables].sort());
    expect(Object.values(settings.templateVariables).every(isReminderFieldKey)).toBe(true);
    expect(await db.select().from(jobs)).toEqual([]);
    expect(await db.select().from(bookings).where(isNotNull(bookings.reminderSentAt))).toEqual([]);
  });

  it("[HER-01] [HER-10] the reception agent has the booking tools; the email and off-hours agents do not book", async () => {
    const rows = await db.select({ id: agents.id, systemTools: agents.systemTools }).from(agents);
    const [whatsapp] = await db.select().from(channels).where(eq(channels.type, "whatsapp"));
    const reception = rows.find((row) => row.id === whatsapp.activeAgentId);
    expect(reception?.systemTools).toEqual(expect.arrayContaining(BOOKING_TOOLS));
    for (const other of rows.filter((row) => row.id !== reception?.id)) expect(other.systemTools).not.toContain("crear_cita");
  });

  it("[AGD-02] [AGD-18] the absences and blocks are in the database, with who set them", async () => {
    const rows = await db.select().from(resourceTimeOff);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((row) => row.createdByUserId !== null && DEMO_USERS.some((demoUser) => demoUser.name === row.createdByName))).toBe(true);
  });

  it("replaces its bookings when loaded again instead of duplicating them", async () => {
    const first = await tableCounts();
    await seed();
    expect(await tableCounts()).toEqual(first);
    expect(first.bookings).toBeGreaterThan(40);
    expect(first.booking_events).toBeGreaterThan(first.bookings);
  });
});

describe("demo agenda of the restaurant (pnpm seed --sector=restaurante)", () => {
  beforeAll(async () => {
    await emptyDatabase();
    await seed(["--sector=restaurante"]);
  });

  afterAll(async () => {
    await emptyDatabase();
  });

  it("[AGD-06] [AGD-11] [AGD-13] a coherent capacity agenda: tables for four on the terrace, groups in the dining room, never over capacity", async () => {
    const [settings] = await db.select().from(businessSettings);
    expect(settings).toMatchObject({ sector: "restaurante", agendaMode: "capacity" });
    expect(await expectEngineAcceptsDatabase()).toBeGreaterThan(20);
    const laura = await conversationOf("Laura Gil");
    const [booking] = await db.select().from(bookings).where(and(eq(bookings.conversationId, laura.id), eq(bookings.status, "confirmed")));
    const [terrace] = await db.select().from(resources).where(eq(resources.id, booking.resourceId));
    expect(terrace.name).toBe("Terraza");
    expect(booking.people).toBe(4);
    const [group] = await db.select().from(services).where(eq(services.name, "Reserva de grupo"));
    const groups = await db.select().from(bookings).where(eq(bookings.serviceId, group.id));
    expect(groups.some((row) => row.status === "pending" && row.people >= 9)).toBe(true);
  });

  it("[ARR-10] loading another sector leaves only that sector's bookings", async () => {
    const serviceIds = new Set((await db.select({ id: services.id }).from(services)).map((row) => row.id));
    const rows = await db.select({ serviceId: bookings.serviceId }).from(bookings);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => serviceIds.has(row.serviceId))).toBe(true);
  });
});
