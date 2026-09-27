import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { bookingEvents, bookings, channels, consents, contactIdentities, contacts, conversations, jobs, messages, reminderSettings, whatsappTemplates } from "@/db/schema";
import { getJobRegistration } from "@/server/jobs/registry";
import { createChannel, createContactWithIdentity, createUser } from "@/test/factories";
import { templateComponents } from "@/test/fixtures/whatsapp/fake-meta";
import { BOOKING_REMINDERS_JOB, runBookingReminders, syncBookingReminderJob } from "./reminders";
import { cancelBooking, createBooking, rescheduleBooking, type BookingActor } from "./service";
import { at, createHairdresser, NOW } from "./test-helpers";
import "./jobs";

let person: BookingActor;
const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-reminders-"));
const mailer = { outboxDir, smtp: null };

beforeAll(async () => {
  const owner = await createUser("owner", { name: "Recepción" });
  person = { type: "user", userId: owner.userId, name: owner.name };
});

afterAll(() => fs.rmSync(outboxDir, { recursive: true, force: true }));

let whatsapp: typeof channels.$inferSelect;
let cutId: string;

beforeEach(async () => {
  for (const table of [messages, conversations, consents, contactIdentities, whatsappTemplates, jobs]) await db.delete(table);
  const { cut } = await createHairdresser();
  cutId = cut.id;
  await db.delete(contacts);
  await db.delete(channels);
  whatsapp = await createChannel({ type: "whatsapp", name: "WhatsApp demo", isDemo: true, status: "connected" });
  await db.insert(whatsappTemplates).values({
    channelId: whatsapp.id,
    name: "recordatorio_cita",
    language: "es",
    category: "UTILITY",
    status: "APPROVED",
    components: templateComponents,
    variables: ["nombre", "fecha", "hora"],
  });
});

async function enableWhatsApp(overrides: Partial<typeof reminderSettings.$inferInsert> = {}) {
  await db.insert(reminderSettings).values({
    enabled: true,
    leadMinutes: 24 * 60,
    channel: "whatsapp_template",
    whatsappChannelId: whatsapp.id,
    templateName: "recordatorio_cita",
    templateLanguage: "es",
    templateVariables: { nombre: "contact.name", fecha: "booking.date", hora: "booking.time" },
    ...overrides,
  });
}

async function bookFor(options: { email?: string; start?: string; now?: Date; isTest?: boolean } = {}) {
  const { contact } = await createContactWithIdentity("whatsapp", { name: "Lucía", email: options.email ?? null });
  const booking = await createBooking({
    serviceId: cutId,
    resourceId: "any",
    start: at(options.start ?? "2026-09-29T10:00"),
    contactId: contact.id,
    source: "human",
    isTest: options.isTest,
    actor: person,
    now: options.now ?? NOW,
  });
  return { contact, booking };
}

const templatesSent = () =>
  db.select().from(messages).where(and(eq(messages.direction, "outbound"), eq(messages.contentType, "template"))).orderBy(asc(messages.createdAt));
const historyOf = async (bookingId: string) => (await db.select().from(bookingEvents).where(eq(bookingEvents.bookingId, bookingId))).map((event) => event.action);

describe("booking reminders [AGD-24] [AGD-25]", () => {
  it("are off by default: nothing is sent without settings", async () => {
    await bookFor();
    expect(await runBookingReminders({ now: at("2026-09-28T10:05") })).toEqual({ sent: 0, failed: 0 });
    expect(await templatesSent()).toHaveLength(0);
  });

  it("send the approved utility template with its mapped variables when the moment comes, once", async () => {
    await enableWhatsApp();
    const { contact, booking } = await bookFor();
    expect(await runBookingReminders({ now: at("2026-09-28T09:55") })).toEqual({ sent: 0, failed: 0 });
    expect(await runBookingReminders({ now: at("2026-09-28T10:05") })).toEqual({ sent: 1, failed: 0 });
    const [message] = await templatesSent();
    expect(message).toMatchObject({ senderType: "system", text: "Hola Lucía, te recordamos tu cita el martes 29 de septiembre a las 10:00." });
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, message.conversationId));
    expect(conversation).toMatchObject({ contactId: contact.id, channelId: whatsapp.id });
    expect(await runBookingReminders({ now: at("2026-09-28T10:10") })).toEqual({ sent: 0, failed: 0 });
    expect(await templatesSent()).toHaveLength(1);
    const [row] = await db.select({ reminderSentAt: bookings.reminderSentAt }).from(bookings).where(eq(bookings.id, booking.id));
    expect(row.reminderSentAt?.getTime()).toBe(at("2026-09-28T10:05").getTime());
    expect(await historyOf(booking.id)).toEqual(["created", "reminder_sent"]);
  });

  it("two rounds at once send it only once", async () => {
    await enableWhatsApp();
    await bookFor();
    const rounds = await Promise.all([runBookingReminders({ now: at("2026-09-28T10:05") }), runBookingReminders({ now: at("2026-09-28T10:05") })]);
    expect(rounds.reduce((sum, round) => sum + round.sent, 0)).toBe(1);
    expect(await templatesSent()).toHaveLength(1);
  });

  it("never for cancelled or test bookings, nor for bookings made after their reminder moment", async () => {
    await enableWhatsApp();
    const { booking: cancelled } = await bookFor({ start: "2026-09-29T10:00" });
    await cancelBooking({ bookingId: cancelled.id, actor: person, now: NOW });
    await bookFor({ start: "2026-09-29T11:00", isTest: true });
    await bookFor({ start: "2026-09-29T12:00", now: at("2026-09-28T13:00") });
    expect(await runBookingReminders({ now: at("2026-09-28T13:05") })).toEqual({ sent: 0, failed: 0 });
    expect(await templatesSent()).toHaveLength(0);
  });

  it("never to a customer who opted out in that channel: the failure stays in the booking's history [CUM-03]", async () => {
    await enableWhatsApp();
    const { contact, booking } = await bookFor();
    await db.insert(consents).values({ contactId: contact.id, channelId: whatsapp.id, channelType: "whatsapp", type: "opt_out", source: "keyword" });
    expect(await runBookingReminders({ now: at("2026-09-28T10:05") })).toEqual({ sent: 0, failed: 1 });
    expect(await templatesSent()).toHaveLength(0);
    const [failed] = await db.select().from(bookingEvents).where(and(eq(bookingEvents.bookingId, booking.id), eq(bookingEvents.action, "reminder_failed")));
    expect(failed.changes).toMatchObject({ channel: "whatsapp_template", reason: expect.stringContaining("dado de baja") });
    // Not retried: once is once.
    expect(await runBookingReminders({ now: at("2026-09-28T10:10") })).toEqual({ sent: 0, failed: 0 });
  });

  it("a variable mapped to something that is not a booking field fails without sending", async () => {
    await enableWhatsApp({ templateVariables: { nombre: "contact.dni", fecha: "booking.date", hora: "booking.time" } });
    await bookFor();
    expect(await runBookingReminders({ now: at("2026-09-28T10:05") })).toEqual({ sent: 0, failed: 1 });
    expect(await templatesSent()).toHaveLength(0);
  });

  it("a moved booking is reminded again at its new time [AGD-25]", async () => {
    await enableWhatsApp();
    const { booking } = await bookFor();
    await runBookingReminders({ now: at("2026-09-28T10:05") });
    await rescheduleBooking({ bookingId: booking.id, start: at("2026-10-01T10:00"), actor: person, now: at("2026-09-28T11:00") });
    expect(await runBookingReminders({ now: at("2026-09-28T11:05") })).toEqual({ sent: 0, failed: 0 });
    expect(await runBookingReminders({ now: at("2026-09-30T10:05") })).toEqual({ sent: 1, failed: 0 });
    const texts = (await templatesSent()).map((message) => message.text);
    expect(texts[1]).toBe("Hola Lucía, te recordamos tu cita el jueves 1 de octubre a las 10:00.");
  });

  it("by email through the system mail, with the text of the settings or the default one", async () => {
    await db.insert(reminderSettings).values({ enabled: true, leadMinutes: 120, channel: "email" });
    const { booking } = await bookFor({ email: "lucia@example.com" });
    const before = new Set(fs.readdirSync(outboxDir));
    expect(await runBookingReminders({ now: at("2026-09-29T08:30"), mailer })).toEqual({ sent: 1, failed: 0 });
    const files = fs.readdirSync(outboxDir).filter((file) => !before.has(file));
    expect(files).toHaveLength(1);
    const email = await simpleParser(fs.readFileSync(path.join(outboxDir, files[0])));
    expect(email.to).toMatchObject({ text: "lucia@example.com" });
    expect(email.subject).toBe("Recordatorio de tu cita en Peluquería Prueba");
    expect(email.text).toContain("Te recordamos tu cita de Corte el martes 29 de septiembre a las 10:00.");
    expect(await historyOf(booking.id)).toEqual(["created", "reminder_sent"]);
  });

  it("no email without an address or to someone who opted out of email", async () => {
    await db.insert(reminderSettings).values({ enabled: true, leadMinutes: 120, channel: "email", emailSubject: "Tu cita", emailBody: "Hola {nombre}, te esperamos el {fecha} a las {hora}." });
    await bookFor({ start: "2026-09-29T10:00" });
    const { contact } = await bookFor({ start: "2026-09-29T10:30", email: "baja@example.com" });
    await db.insert(consents).values({ contactId: contact.id, channelType: "email_imap", type: "opt_out", source: "keyword" });
    expect(await runBookingReminders({ now: at("2026-09-29T09:00"), mailer })).toEqual({ sent: 0, failed: 2 });
  });

  it("the recurring job runs while reminders are on and stops when they go off", async () => {
    expect(getJobRegistration(BOOKING_REMINDERS_JOB)).toBeDefined();
    await syncBookingReminderJob(true);
    await syncBookingReminderJob(true);
    const pending = await db.select().from(jobs).where(eq(jobs.type, BOOKING_REMINDERS_JOB));
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ status: "pending", dedupeKey: "recurring:booking.reminders" });
    await syncBookingReminderJob(false);
    const [after] = await db.select().from(jobs).where(eq(jobs.type, BOOKING_REMINDERS_JOB));
    expect(after.status).toBe("cancelled");
  });
});
