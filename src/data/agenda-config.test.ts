import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { businessSettings, channels, jobs, reminderSettings, resourceSchedules, serviceResources, whatsappTemplates } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { createHairdresser } from "@/server/booking/test-helpers";
import { AuthError, NotFoundError, ValidationError } from "@/server/errors";
import { actorFor, createChannel, createUser, type TestUser } from "@/test/factories";
import {
  createResource,
  createService,
  getAgendaSettings,
  getReminderSettings,
  getResource,
  getService,
  listResources,
  listServices,
  setResourceActive,
  setServiceActive,
  updateAgendaSettings,
  updateReminderSettings,
  updateResource,
  updateService,
} from "./agenda-config";

const ROLES: Role[] = ["owner", "admin", "supervisor", "agent", "viewer"];
const CONFIGURE: Role[] = ["owner", "admin"];
const DENIED: Role[] = ["supervisor", "agent", "viewer"];
const users = {} as Record<Role, TestUser>;
let hair: Awaited<ReturnType<typeof createHairdresser>>;

beforeAll(async () => {
  for (const role of ROLES) users[role] = await createUser(role);
});

beforeEach(async () => {
  hair = await createHairdresser();
  await db.delete(jobs);
});

const serviceInput = { name: "Peinado", durationMin: 45, bufferAfterMin: 10, price: 25, descriptionForAgent: "Peinado de fiesta.", resourceIds: [] as string[] };

describe("everyone who sees the agenda reads its configuration [PER-01]", () => {
  it.each(ROLES)("%s reads words, mode, step, services and resources", async (role) => {
    const actor = users[role].actor;
    expect(await getAgendaSettings(actor)).toMatchObject({ timezone: "Europe/Madrid", mode: "individual", slotIntervalMin: 30, terminology: { booking: "cita", bookings: "citas" } });
    expect((await listServices(actor)).map((service) => service.name)).toEqual(["Corte", "Tinte"]);
    expect((await listResources(actor)).map((resource) => resource.name)).toEqual(["Laura", "Marta"]);
    expect((await getService(actor, hair.cut.id)).resourceIds).toEqual([hair.laura.id, hair.marta.id]);
    const laura = await getResource(actor, hair.laura.id);
    expect(laura.schedule).toContainEqual({ weekday: 1, start: "09:00", end: "14:00" });
    expect(laura.serviceIds.sort()).toEqual([hair.cut.id, hair.dye.id].sort());
  });
});

describe("only owner and admin configure the agenda [PER-01] «Agenda: configurar servicios, recursos, horarios, terminología y recordatorios»", () => {
  it.each(DENIED)("%s cannot change anything", async (role) => {
    const actor = actorFor(role);
    await expect(updateAgendaSettings(actor, { slotIntervalMin: 15 })).rejects.toBeInstanceOf(AuthError);
    await expect(createService(actor, serviceInput)).rejects.toBeInstanceOf(AuthError);
    await expect(updateService(actor, { serviceId: hair.cut.id, ...serviceInput })).rejects.toBeInstanceOf(AuthError);
    await expect(setServiceActive(actor, { id: hair.cut.id, active: false })).rejects.toBeInstanceOf(AuthError);
    await expect(createResource(actor, { type: "person", name: "Pepa" })).rejects.toBeInstanceOf(AuthError);
    await expect(updateResource(actor, { resourceId: hair.laura.id, type: "person", name: "Laura" })).rejects.toBeInstanceOf(AuthError);
    await expect(setResourceActive(actor, { id: hair.laura.id, active: false })).rejects.toBeInstanceOf(AuthError);
    await expect(getReminderSettings(actor)).rejects.toBeInstanceOf(AuthError);
    await expect(updateReminderSettings(actor, { enabled: false, leadMinutes: 1440, channel: "email" })).rejects.toBeInstanceOf(AuthError);
    expect((await listServices(users.owner.actor)).map((service) => [service.name, service.active])).toEqual([
      ["Corte", true],
      ["Tinte", true],
    ]);
  });

  it.each(CONFIGURE)("%s changes words, mode and slot step [AGD-01] [AGD-06] [AGD-08]", async (role) => {
    const updated = await updateAgendaSettings(users[role].actor, {
      agendaMode: "capacity",
      slotIntervalMin: 15,
      terminology: { booking: "reserva", bookings: "reservas", resource: "mesa", resources: "mesas", customer: "comensal" },
    });
    expect(updated).toMatchObject({ mode: "capacity", slotIntervalMin: 15, terminology: { booking: "reserva", resource: "mesa", customer: "comensal" } });
    await expect(updateAgendaSettings(users[role].actor, { slotIntervalMin: 7 })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateAgendaSettings(users[role].actor, { terminology: { booking: "reserva", bookings: "citas", resource: "mesa", resources: "mesas", customer: "comensal" } })).rejects.toBeInstanceOf(ValidationError);
    await db.update(businessSettings).set({ agendaMode: "individual", slotIntervalMin: 30 });
  });
});

describe("services [AGD-04]", () => {
  it("are created with their resources, edited (links replaced) and deactivated, never deleted", async () => {
    const owner = users.owner.actor;
    const created = await createService(owner, { ...serviceInput, resourceIds: [hair.laura.id], minPeople: 1, maxPeople: 2, minAdvanceMin: 60, maxAdvanceDays: 30, requiresManualConfirmation: true });
    expect(created).toMatchObject({ name: "Peinado", durationMin: 45, bufferAfterMin: 10, price: 25, maxPeople: 2, minAdvanceMin: 60, maxAdvanceDays: 30, requiresManualConfirmation: true, resourceIds: [hair.laura.id] });
    const edited = await updateService(owner, { serviceId: created.id, ...serviceInput, price: null, resourceIds: [hair.marta.id] });
    expect(edited).toMatchObject({ price: null, resourceIds: [hair.marta.id], requiresManualConfirmation: false });
    await setServiceActive(owner, { id: created.id, active: false });
    expect((await listServices(owner, { activeOnly: true })).map((service) => service.name)).toEqual(["Corte", "Tinte"]);
    expect((await getService(owner, created.id)).active).toBe(false);
  });

  it("refuse wrong values, with the error by the field [AJU-15]", async () => {
    const owner = users.owner.actor;
    await expect(createService(owner, { ...serviceInput, minPeople: 3, maxPeople: 2 })).rejects.toMatchObject({ fieldErrors: { maxPeople: expect.any(Array) } });
    await expect(createService(owner, { ...serviceInput, durationMin: 2 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createService(owner, { ...serviceInput, price: -5 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createService(owner, { ...serviceInput, resourceIds: [crypto.randomUUID()] })).rejects.toMatchObject({ fieldErrors: { resourceIds: expect.any(Array) } });
    await expect(updateService(owner, { serviceId: crypto.randomUUID(), ...serviceInput })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("resources with weekly schedules [AGD-02] [AGD-03]", () => {
  it("are created with several ranges a day and their services; editing without a schedule keeps it", async () => {
    const owner = users.owner.actor;
    const room = await createResource(owner, {
      type: "room",
      name: "Cabina",
      color: "teal",
      capacity: 2,
      schedule: [
        { weekday: 1, start: "09:00", end: "13:00" },
        { weekday: 1, start: "15:00", end: "00:00" },
      ],
      serviceIds: [hair.cut.id],
    });
    expect(room).toMatchObject({ type: "room", color: "teal", capacity: 2, serviceIds: [hair.cut.id], schedule: [{ weekday: 1, start: "09:00", end: "13:00" }, { weekday: 1, start: "15:00", end: "00:00" }] });
    const [evening] = await db.select().from(resourceSchedules).where(eq(resourceSchedules.startMin, 900));
    expect(evening.endMin).toBe(1_440);
    const renamed = await updateResource(owner, { resourceId: room.id, type: "room", name: "Cabina 1" });
    expect(renamed).toMatchObject({ name: "Cabina 1", schedule: room.schedule, serviceIds: [hair.cut.id] });
    await setResourceActive(owner, { id: room.id, active: false });
    expect((await getResource(owner, room.id)).active).toBe(false);
  });

  it("refuse overlapping ranges, wrong times and unknown services", async () => {
    const owner = users.owner.actor;
    await expect(
      createResource(owner, { type: "person", name: "Pepa", schedule: [{ weekday: 2, start: "09:00", end: "12:00" }, { weekday: 2, start: "11:00", end: "13:00" }] }),
    ).rejects.toMatchObject({ fieldErrors: { "day-2": expect.any(Array) } });
    await expect(createResource(owner, { type: "person", name: "Pepa", schedule: [{ weekday: 3, start: "9", end: "12:00" }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createResource(owner, { type: "person", name: "Pepa", serviceIds: [crypto.randomUUID()] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createResource(owner, { type: "robot", name: "Pepa" })).rejects.toBeInstanceOf(ValidationError);
    expect((await db.select().from(serviceResources)).length).toBe(3);
  });
});

describe("reminders: off by default, WhatsApp template or email [AGD-24] [AGD-20]", () => {
  let number: typeof channels.$inferSelect;

  beforeEach(async () => {
    await db.delete(reminderSettings);
    await db.delete(whatsappTemplates);
    await db.delete(channels);
    number = await createChannel({ type: "whatsapp", name: "WhatsApp Recepción", isDemo: true });
    await db.insert(whatsappTemplates).values([
      { channelId: number.id, name: "recordatorio_cita", language: "es", category: "UTILITY", status: "APPROVED", variables: ["1", "2", "3"] },
      { channelId: number.id, name: "promo_otono", language: "es", category: "MARKETING", status: "APPROVED", variables: [] },
      { channelId: number.id, name: "recordatorio_nuevo", language: "es", category: "UTILITY", status: "PENDING", variables: ["1"] },
    ]);
  });

  it("start disabled and offer the approved utility templates and the booking fields", async () => {
    const { settings, options } = await getReminderSettings(users.admin.actor);
    expect(settings).toMatchObject({ enabled: false, leadMinutes: 1440, channel: "whatsapp_template" });
    expect(options.whatsapp).toEqual([{ channelId: number.id, name: "WhatsApp Recepción", isDemo: true, templates: [{ name: "recordatorio_cita", language: "es", variables: ["1", "2", "3"] }] }]);
    expect(options.fields.map((field) => field.key)).toContain("booking.date");
  });

  it("by WhatsApp need a number, an approved utility template and a booking field for each variable", async () => {
    const owner = users.owner.actor;
    const base = { enabled: true, leadMinutes: 1440, channel: "whatsapp_template" as const, whatsappChannelId: number.id, templateName: "recordatorio_cita", templateLanguage: "es" };
    await expect(updateReminderSettings(owner, { ...base, templateVariables: { 1: "contact.name", 2: "booking.date" } })).rejects.toMatchObject({ fieldErrors: { templateVariables: expect.any(Array) } });
    await expect(updateReminderSettings(owner, { ...base, templateName: "promo_otono", templateVariables: {} })).rejects.toMatchObject({ fieldErrors: { templateName: expect.any(Array) } });
    await expect(updateReminderSettings(owner, { ...base, whatsappChannelId: crypto.randomUUID() })).rejects.toMatchObject({ fieldErrors: { whatsappChannelId: expect.any(Array) } });
    await expect(updateReminderSettings(owner, { ...base, templateVariables: { 1: "contact.dni", 2: "booking.date", 3: "booking.time" } })).rejects.toBeInstanceOf(ValidationError);
    const saved = await updateReminderSettings(owner, { ...base, leadMinutes: 120, templateVariables: { 1: "contact.name", 2: "booking.date", 3: "booking.time" } });
    expect(saved).toMatchObject({ enabled: true, leadMinutes: 120, templateName: "recordatorio_cita" });
    expect(await db.select().from(jobs).where(eq(jobs.type, "booking.reminders"))).toHaveLength(1);
  });

  it("by email need only the choice (default text); turning them off stops the job", async () => {
    const admin = users.admin.actor;
    expect(await updateReminderSettings(admin, { enabled: true, leadMinutes: 1440, channel: "email", emailSubject: "Tu cita", emailBody: "Hola {nombre}" })).toMatchObject({ enabled: true, channel: "email", emailSubject: "Tu cita" });
    await expect(updateReminderSettings(admin, { enabled: true, leadMinutes: 5, channel: "email" })).rejects.toBeInstanceOf(ValidationError);
    expect(await updateReminderSettings(admin, { enabled: false, leadMinutes: 1440, channel: "email" })).toMatchObject({ enabled: false });
    const [job] = await db.select().from(jobs).where(eq(jobs.type, "booking.reminders"));
    expect(job.status).toBe("cancelled");
    expect(await db.select().from(reminderSettings)).toHaveLength(1);
  });
});
