import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  bookingEvents,
  bookingReminderSends,
  bookings,
  businessSettings,
  channels,
  consents,
  contactIdentities,
  contacts,
  conversations,
  jobs,
  messages,
  reminderSettings,
  resources,
  whatsappTemplates,
} from "@/db/schema";
import type { ReminderRule } from "@/lib/reminder-rules";
import { createEmailAdapter } from "@/server/channels/email/adapter";
import { encryptMailPasswords } from "@/server/channels/email/config";
import { imapProvider } from "@/server/channels/email/imap/provider";
import { fakeMailServers } from "@/server/channels/email/test-helpers";
import { registerChannelAdapter } from "@/server/channels/registry";
import { getJobRegistration } from "@/server/jobs/registry";
import type { MailSender } from "@/server/mailer";
import { createChannel, createContactWithIdentity, createConversation, createMessage, createUser } from "@/test/factories";
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
  for (const table of [bookingReminderSends, messages, conversations, consents, contactIdentities, whatsappTemplates, jobs]) await db.delete(table);
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

/** One reminder 24 hours before by WhatsApp with the demo number's approved utility template ([AGD-24]). */
const whatsappRule = (overrides: Partial<ReminderRule> = {}): ReminderRule => ({
  id: "dia-antes",
  lead: { kind: "hours", minutes: 24 * 60 },
  routes: ["whatsapp"],
  whatsapp: {
    channelId: whatsapp.id,
    templateName: "recordatorio_cita",
    templateLanguage: "es",
    variables: { nombre: "contact.name", fecha: "booking.date", hora: "booking.time" },
    confirmButton: null,
    changeButton: null,
  },
  telegram: null,
  email: null,
  ...overrides,
});
const emailRule = (overrides: Partial<ReminderRule> = {}): ReminderRule => ({
  id: "dos-horas",
  lead: { kind: "hours", minutes: 120 },
  routes: ["email"],
  whatsapp: null,
  telegram: null,
  email: null,
  ...overrides,
});

async function enableReminders(...rules: ReminderRule[]) {
  await db.insert(reminderSettings).values({ enabled: true, rules });
}

const enableWhatsApp = (overrides: Partial<ReminderRule> = {}) => enableReminders(whatsappRule(overrides));

/** A customer with «Avisos de sus citas», which WhatsApp and Telegram reminders need ([CTO-09]); `permission: false`, without. */
async function bookFor(options: { email?: string; start?: string; now?: Date; isTest?: boolean; permission?: boolean } = {}) {
  const { contact } = await createContactWithIdentity("whatsapp", { name: "Lucía", email: options.email ?? null });
  if (options.permission !== false) await db.insert(consents).values({ contactId: contact.id, type: "reminders_granted", source: "person" });
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

const sendsOf = (bookingId: string) => db.select().from(bookingReminderSends).where(eq(bookingReminderSends.bookingId, bookingId));
const NONE = { sent: 0, failed: 0, notSent: 0 };

describe("booking reminders [AGD-24] [AGD-25]", () => {
  it("are off by default: nothing is sent without settings", async () => {
    await bookFor();
    expect(await runBookingReminders({ now: at("2026-09-28T10:05") })).toEqual(NONE);
    expect(await templatesSent()).toHaveLength(0);
  });

  it("send the approved utility template with its mapped variables when the moment comes, once", async () => {
    await enableWhatsApp();
    const { contact, booking } = await bookFor();
    expect(await runBookingReminders({ now: at("2026-09-28T09:55") })).toEqual(NONE);
    expect(await runBookingReminders({ now: at("2026-09-28T10:05") })).toEqual({ ...NONE, sent: 1 });
    const [message] = await templatesSent();
    expect(message).toMatchObject({ senderType: "system", text: "Hola Lucía, te recordamos tu cita el martes 29 de septiembre a las 10:00." });
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, message.conversationId));
    expect(conversation).toMatchObject({ contactId: contact.id, channelId: whatsapp.id });
    expect(await runBookingReminders({ now: at("2026-09-28T10:10") })).toEqual(NONE);
    expect(await templatesSent()).toHaveLength(1);
    expect(await sendsOf(booking.id)).toEqual([expect.objectContaining({ ruleId: "dia-antes", status: "sent", channel: "whatsapp", messageId: message.id })]);
    expect(await historyOf(booking.id)).toEqual(["created", "reminder_sent"]);
  });

  it("two rounds at once send it only once", async () => {
    await enableWhatsApp();
    await bookFor();
    const rounds = await Promise.all([runBookingReminders({ now: at("2026-09-28T10:05") }), runBookingReminders({ now: at("2026-09-28T10:05") })]);
    expect(rounds.reduce((sum, round) => sum + round.sent, 0)).toBe(1);
    expect(await templatesSent()).toHaveLength(1);
  });

  it("never for cancelled or test bookings; one booked after its moment does not go, and its history says why", async () => {
    await enableWhatsApp();
    const { booking: cancelled } = await bookFor({ start: "2026-09-29T10:00" });
    await cancelBooking({ bookingId: cancelled.id, actor: person, now: NOW });
    await bookFor({ start: "2026-09-29T11:00", isTest: true });
    const { booking: late } = await bookFor({ start: "2026-09-29T12:00", now: at("2026-09-28T13:00") });
    expect(await runBookingReminders({ now: at("2026-09-28T13:05") })).toEqual({ ...NONE, notSent: 1 });
    expect(await templatesSent()).toHaveLength(0);
    const [event] = await db.select().from(bookingEvents).where(and(eq(bookingEvents.bookingId, late.id), eq(bookingEvents.action, "reminder_not_sent")));
    expect(event.changes).toMatchObject({ reason: "Se reservó después de su momento" });
  });

  it("never by a channel the customer opted out of, nor by WhatsApp without «Avisos de sus citas»: the history says why [CUM-03] [CTO-09]", async () => {
    await enableWhatsApp();
    const { contact, booking } = await bookFor();
    await db.insert(consents).values({ contactId: contact.id, channelId: whatsapp.id, channelType: "whatsapp", type: "opt_out", source: "keyword" });
    const { booking: withoutPermission } = await bookFor({ start: "2026-09-29T10:30", permission: false });
    expect(await runBookingReminders({ now: at("2026-09-28T10:35") })).toEqual({ ...NONE, notSent: 2 });
    expect(await templatesSent()).toHaveLength(0);
    const reason = async (bookingId: string) =>
      (await db.select().from(bookingEvents).where(and(eq(bookingEvents.bookingId, bookingId), eq(bookingEvents.action, "reminder_not_sent"))))[0]?.changes.reason;
    expect(await reason(booking.id)).toBe("Se ha dado de baja de WhatsApp");
    expect(await reason(withoutPermission.id)).toBe("Sin permiso de avisos");
    // Once is once.
    expect(await runBookingReminders({ now: at("2026-09-28T10:40") })).toEqual(NONE);
  });

  it("without «Avisos de sus citas» it goes by the next channel marked: the email, which needs no permission [AGD-24]", async () => {
    await enableWhatsApp({ routes: ["whatsapp", "email"] });
    const { booking } = await bookFor({ permission: false, email: "lucia@example.com" });
    expect(await runBookingReminders({ now: at("2026-09-28T10:05"), mailer })).toEqual({ ...NONE, sent: 1 });
    expect(await templatesSent()).toHaveLength(0);
    expect(await sendsOf(booking.id)).toEqual([expect.objectContaining({ status: "sent", channel: "email", attempts: [expect.objectContaining({ channel: "whatsapp", outcome: "skipped", reason: "Sin permiso de avisos" }), expect.objectContaining({ channel: "email", outcome: "sent" })] })]);
  });

  it("[ENV-14] a contact of the demo or of the simulator never gets one through a channel that is not a demo one: it goes by the next channel", async () => {
    const real = await createChannel({ type: "whatsapp", name: "WhatsApp real", status: "connected" });
    await db.insert(whatsappTemplates).values({ channelId: real.id, name: "recordatorio_cita", language: "es", category: "UTILITY", status: "APPROVED", components: templateComponents, variables: ["nombre", "fecha", "hora"] });
    await enableWhatsApp({ routes: ["whatsapp", "email"], whatsapp: { ...whatsappRule().whatsapp!, channelId: real.id } });
    const { contact, booking } = await bookFor({ email: "demo@example.com" });
    await db.update(contacts).set({ isDemo: true }).where(eq(contacts.id, contact.id));
    expect(await runBookingReminders({ now: at("2026-09-28T10:05"), mailer })).toEqual({ ...NONE, sent: 1 });
    expect(await templatesSent()).toHaveLength(0);
    expect((await sendsOf(booking.id))[0].attempts).toEqual([
      expect.objectContaining({ channel: "whatsapp", outcome: "skipped", reason: "Es un contacto de la demo o del simulador" }),
      expect.objectContaining({ channel: "email", outcome: "sent" }),
    ]);
  });

  it("[WA-60] a template Meta moved to marketing no longer serves: the reminder goes by the next channel and says why", async () => {
    await enableWhatsApp({ routes: ["whatsapp", "email"] });
    await db.update(whatsappTemplates).set({ category: "MARKETING" }).where(eq(whatsappTemplates.channelId, whatsapp.id));
    const { booking } = await bookFor({ email: "lucia@example.com" });
    expect(await runBookingReminders({ now: at("2026-09-28T10:05"), mailer })).toEqual({ ...NONE, sent: 1 });
    expect(await templatesSent()).toHaveLength(0);
    expect((await sendsOf(booking.id))[0].attempts).toEqual([
      expect.objectContaining({ channel: "whatsapp", outcome: "skipped", reason: "La plantilla ya no es de utilidad aprobada" }),
      expect.objectContaining({ channel: "email", outcome: "sent" }),
    ]);
  });

  it("[TG-12] by Telegram only to whoever wrote to that bot first: otherwise the next channel", async () => {
    const bot = await createChannel({ type: "telegram", name: "Bot", isDemo: true, status: "connected" });
    await enableReminders(whatsappRule({ routes: ["telegram", "email"], whatsapp: null, telegram: { channelId: bot.id, text: "" } }));
    const { booking } = await bookFor({ email: "lucia@example.com" });
    expect(await runBookingReminders({ now: at("2026-09-28T10:05"), mailer })).toEqual({ ...NONE, sent: 1 });
    expect((await sendsOf(booking.id))[0].attempts).toEqual([
      expect.objectContaining({ channel: "telegram", outcome: "skipped", reason: "No ha escrito al bot" }),
      expect.objectContaining({ channel: "email", outcome: "sent" }),
    ]);
  });

  it("a variable mapped to something that is not a booking field fails without sending", async () => {
    await enableWhatsApp({ whatsapp: { ...whatsappRule().whatsapp!, variables: { nombre: "contact.dni", fecha: "booking.date", hora: "booking.time" } } });
    const { booking } = await bookFor();
    expect(await runBookingReminders({ now: at("2026-09-28T10:05") })).toEqual({ ...NONE, failed: 1 });
    expect(await templatesSent()).toHaveLength(0);
    expect(await historyOf(booking.id)).toEqual(["created", "reminder_failed", "reminder_not_sent"]);
  });

  it("a moved booking is reminded again at its new time [AGD-25]", async () => {
    await enableWhatsApp();
    const { booking } = await bookFor();
    await runBookingReminders({ now: at("2026-09-28T10:05") });
    await rescheduleBooking({ bookingId: booking.id, start: at("2026-10-01T10:00"), actor: person, now: at("2026-09-28T11:00") });
    expect(await runBookingReminders({ now: at("2026-09-28T11:05") })).toEqual(NONE);
    expect(await runBookingReminders({ now: at("2026-09-30T10:05") })).toEqual({ ...NONE, sent: 1 });
    const texts = (await templatesSent()).map((message) => message.text);
    expect(texts[1]).toBe("Hola Lucía, te recordamos tu cita el jueves 1 de octubre a las 10:00.");
  });

  it("a booking moved to a time whose moment already passed does not get it again [AGD-25]", async () => {
    await enableWhatsApp();
    const { booking } = await bookFor({ start: "2026-09-30T10:00" });
    await rescheduleBooking({ bookingId: booking.id, start: at("2026-09-29T09:00"), actor: person, now: at("2026-09-28T10:00") });
    expect(await runBookingReminders({ now: at("2026-09-28T10:05") })).toEqual({ ...NONE, notSent: 1 });
    const [event] = await db.select().from(bookingEvents).where(and(eq(bookingEvents.bookingId, booking.id), eq(bookingEvents.action, "reminder_not_sent")));
    expect(event.changes).toMatchObject({ reason: "Cambió de hora después de su momento" });
  });

  it("two reminders, each at its moment: one in days at its time of sending, one in hours [AGD-24]", async () => {
    await enableReminders(whatsappRule({ id: "dia", lead: { kind: "days", days: 1, at: "18:00" } }), whatsappRule({ id: "horas", lead: { kind: "hours", minutes: 120 } }));
    const { booking } = await bookFor();
    expect(await runBookingReminders({ now: at("2026-09-28T17:55") })).toEqual(NONE);
    expect(await runBookingReminders({ now: at("2026-09-28T18:00") })).toEqual({ ...NONE, sent: 1 });
    expect(await runBookingReminders({ now: at("2026-09-29T08:00") })).toEqual({ ...NONE, sent: 1 });
    expect((await sendsOf(booking.id)).map((row) => row.ruleId).sort()).toEqual(["dia", "horas"]);
  });

  it("one missed while the app was stopped goes on its return only before the next one is due and more than 15 minutes ahead [AGD-25]", async () => {
    await enableReminders(whatsappRule({ id: "dia" }), whatsappRule({ id: "horas", lead: { kind: "hours", minutes: 120 } }));
    const { booking } = await bookFor();
    // The day-before one was due at 10:00 yesterday: at 14:00 the 2-hours one is not due yet, so it goes.
    expect(await runBookingReminders({ now: at("2026-09-28T14:00") })).toEqual({ ...NONE, sent: 1 });
    const { booking: second } = await bookFor({ start: "2026-09-29T10:30" });
    // Back at 09:00: the 2-hours one (08:30) is due already: the day-before one does not go, and its history says so.
    expect(await runBookingReminders({ now: at("2026-09-29T09:00") })).toMatchObject({ notSent: 1 });
    const [event] = await db.select().from(bookingEvents).where(and(eq(bookingEvents.bookingId, second.id), eq(bookingEvents.action, "reminder_not_sent")));
    expect(event.changes).toMatchObject({ reason: "La app no estaba en marcha a su hora" });
    void booking;
  });

  it("a booking that already had the single reminder of before phase 12 is not reminded again for that time", async () => {
    await enableWhatsApp();
    const { booking } = await bookFor();
    await db.update(bookings).set({ reminderSentAt: at("2026-09-28T10:01") }).where(eq(bookings.id, booking.id));
    expect(await runBookingReminders({ now: at("2026-09-28T10:05") })).toEqual(NONE);
  });

  it("by email through the system mail, with the text of the settings or the default one", async () => {
    await enableReminders(emailRule());
    const { booking } = await bookFor({ email: "lucia@example.com" });
    const before = new Set(fs.readdirSync(outboxDir));
    expect(await runBookingReminders({ now: at("2026-09-29T08:30"), mailer })).toEqual({ ...NONE, sent: 1 });
    const files = fs.readdirSync(outboxDir).filter((file) => !before.has(file));
    expect(files).toHaveLength(1);
    const email = await simpleParser(fs.readFileSync(path.join(outboxDir, files[0])));
    expect(email.to).toMatchObject({ text: "lucia@example.com" });
    expect(email.subject).toBe("Recordatorio de tu cita en Peluquería Prueba");
    expect(email.text).toContain("Te recordamos tu cita de Corte el martes 29 de septiembre a las 10:00");
    expect(await historyOf(booking.id)).toEqual(["created", "reminder_sent"]);
  });

  it("no email without an address or to someone who opted out of email", async () => {
    await enableReminders(emailRule({ email: { subject: "Tu cita", body: "Hola {nombre}, te esperamos el {fecha} a las {hora}." } }));
    await bookFor({ start: "2026-09-29T10:00" });
    const { contact } = await bookFor({ start: "2026-09-29T10:30", email: "baja@example.com" });
    await db.insert(consents).values({ contactId: contact.id, channelType: "email_imap", type: "opt_out", source: "keyword" });
    expect(await runBookingReminders({ now: at("2026-09-29T09:00"), mailer })).toEqual({ ...NONE, notSent: 2 });
  });

  it("a booking cancelled while the round is running gets no reminder [AGD-25]", async () => {
    await enableReminders(emailRule());
    const { booking: first } = await bookFor({ start: "2026-09-29T10:00", email: "primera@example.com" });
    const { booking: second } = await bookFor({ start: "2026-09-29T10:30", email: "segunda@example.com" });
    const sentTo: string[] = [];
    // The first reminder is on its way when a person cancels the second booking.
    const transport: MailSender = {
      async sendMail(options) {
        sentTo.push(String(options.to));
        if (sentTo.length === 1) await cancelBooking({ bookingId: second.id, actor: person, now: at("2026-09-29T08:45") });
        return {};
      },
    };
    const smtp = { host: "smtp.example.com", port: 465, security: "tls" as const, fromEmail: "avisos@example.com", password: null };
    expect(await runBookingReminders({ now: at("2026-09-29T08:45"), mailer: { smtp, createTransport: () => transport } })).toEqual({ ...NONE, sent: 1, notSent: 1 });
    expect(sentTo).toEqual(["primera@example.com"]);
    expect(await historyOf(first.id)).toEqual(["created", "reminder_sent"]);
    expect(await historyOf(second.id)).toEqual(["created", "cancelled"]);
  });

  it("with hundreds of bookings in the window, the latest ones are not left out: each gets its reminder at its moment [AGD-25]", async () => {
    const { contact } = await createContactWithIdentity("whatsapp", { name: "Cliente frecuente", email: "frecuente@ejemplo.com" });
    await enableReminders(emailRule({ id: "semana", lead: { kind: "hours", minutes: 7 * 24 * 60 } }));
    const [laura, marta] = await db.select({ id: resources.id }).from(resources).orderBy(asc(resources.sortOrder));
    // 401 bookings, 30 minutes each, on two resources, from 29 September: the last one starts on 2 October.
    const first = at("2026-09-29T00:00").getTime();
    const rows = Array.from({ length: 401 }, (_, index) => {
      const startsAt = new Date(first + Math.floor(index / 2) * 30 * 60_000);
      const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
      return { contactId: contact.id, serviceId: cutId, resourceId: index % 2 ? marta.id : laura.id, startsAt, endsAt, blockedStartAt: startsAt, blockedEndAt: endsAt, source: "human" as const, createdAt: at("2026-09-01T10:00") };
    });
    const inserted = await db.insert(bookings).values(rows).returning({ id: bookings.id, startsAt: bookings.startsAt });
    const last = inserted.at(-1);
    // The first 400 already had their reminder.
    await db.insert(bookingReminderSends).values(
      inserted.slice(0, -1).map((booking) => ({ bookingId: booking.id, ruleId: "semana", startsAt: booking.startsAt, dueAt: booking.startsAt, status: "sent" as const })),
    );
    const due = new Date((last?.startsAt.getTime() ?? 0) - 7 * 24 * 60 * 60_000);
    expect(await runBookingReminders({ now: new Date(due.getTime() + 60_000), mailer })).toEqual({ ...NONE, sent: 1 });
    expect(await sendsOf(last?.id ?? "")).toMatchObject([{ status: "sent", channel: "email" }]);
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

describe("email reminders the customer can answer to cancel [AGD-26] [CUM-03]", () => {
  const MAILBOX = "hola@peluqueria.test";
  const CUSTOMER = "lucia@example.com";
  const THREAD = "<pregunta-1@example.com>";

  async function connectMailbox() {
    const servers = fakeMailServers();
    const channel = await createChannel({
      type: "email_imap",
      name: "Buzón",
      status: "connected",
      config: {
        emailAddress: MAILBOX,
        imap: { imapHost: "imap.hosting.test", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.hosting.test", smtpPort: 465, smtpSecurity: "tls" },
      },
      secretsEnc: encryptMailPasswords({ password: "contraseña-buzón", smtpPassword: null }),
    });
    registerChannelAdapter(createEmailAdapter(imapProvider, { mailConnectors: servers.connectors }));
    return { servers, channel };
  }

  /** A customer who wrote by email: their thread in the mailbox, with the email they sent. */
  async function customerWhoWrote(channelId: string) {
    const { contact } = await createContactWithIdentity("email_imap", { name: "Lucía", email: CUSTOMER, externalId: CUSTOMER });
    const conversation = await createConversation(channelId, contact.id, { externalThreadId: THREAD });
    await createMessage(conversation, {
      text: "¿Tenéis hueco el martes?",
      createdAt: at("2026-09-20T10:00"),
      externalId: THREAD,
      metadata: {
        subject: "Cita para el martes",
        email: { providerId: THREAD, messageId: THREAD, from: { address: CUSTOMER, name: "Lucía" }, to: [{ address: MAILBOX, name: null }] },
      },
    });
    return { contact, conversation };
  }

  const bookContact = (contactId: string) =>
    createBooking({ serviceId: cutId, resourceId: "any", start: at("2026-09-29T10:00"), contactId, source: "human", actor: person, now: NOW });

  const newEmails = (before: Set<string>) => fs.readdirSync(outboxDir).filter((file) => !before.has(file));

  beforeEach(async () => {
    await enableReminders(emailRule());
  });

  it("with a connected mailbox where the customer wrote, it goes as a reply in that thread, so the answer comes back to the inbox", async () => {
    const { servers, channel } = await connectMailbox();
    const { contact, conversation } = await customerWhoWrote(channel.id);
    const booking = await bookContact(contact.id);
    const before = new Set(fs.readdirSync(outboxDir));

    expect(await runBookingReminders({ now: at("2026-09-29T08:30"), mailer })).toEqual({ ...NONE, sent: 1 });

    expect(newEmails(before)).toEqual([]);
    expect(servers.state.smtpSent).toHaveLength(1);
    const [sent] = servers.state.smtpSent;
    expect(sent.envelope).toEqual({ from: MAILBOX, to: [CUSTOMER] });
    const email = await simpleParser(sent.raw);
    expect(email.from?.text).toContain(MAILBOX);
    expect(email.inReplyTo).toBe(THREAD);
    expect(email.subject).toBe("Re: Cita para el martes");
    expect(email.text).toContain("Te recordamos tu cita de Corte el martes 29 de septiembre a las 10:00 con");
    // The reminder is in the conversation, where the customer's answer lands.
    const outbound = await db.select().from(messages).where(and(eq(messages.conversationId, conversation.id), eq(messages.direction, "outbound")));
    expect(outbound).toEqual([expect.objectContaining({ senderType: "system", status: "sent" })]);
    expect(await historyOf(booking.id)).toEqual(["created", "reminder_sent"]);
  });

  it("with a connected mailbox but no thread with the customer, the system mail answers to that mailbox (Reply-To)", async () => {
    await connectMailbox();
    const { contact } = await createContactWithIdentity("whatsapp", { name: "Lucía", email: CUSTOMER });
    await bookContact(contact.id);
    const before = new Set(fs.readdirSync(outboxDir));

    expect(await runBookingReminders({ now: at("2026-09-29T08:30"), mailer })).toEqual({ ...NONE, sent: 1 });

    const [file] = newEmails(before);
    const email = await simpleParser(fs.readFileSync(path.join(outboxDir, file)));
    expect(email.to).toMatchObject({ text: CUSTOMER });
    expect(email.replyTo).toMatchObject({ text: MAILBOX });
  });

  it("without a connected mailbox, the system mail answers to the business's email and says how to cancel without promising «BAJA» by email", async () => {
    await db.update(businessSettings).set({ contactEmail: "recepcion@peluqueria.test" });
    // The demo's mailbox never sends anything: it does not count.
    await createChannel({ type: "email_gmail", name: "Correo demo", isDemo: true, status: "connected", config: { emailAddress: "demo@peluqueria.test" } });
    const { contact } = await createContactWithIdentity("whatsapp", { name: "Lucía", email: CUSTOMER });
    await bookContact(contact.id);
    const before = new Set(fs.readdirSync(outboxDir));

    expect(await runBookingReminders({ now: at("2026-09-29T08:30"), mailer })).toEqual({ ...NONE, sent: 1 });

    const [file] = newEmails(before);
    const email = await simpleParser(fs.readFileSync(path.join(outboxDir, file)));
    expect(email.replyTo).toMatchObject({ text: "recepcion@peluqueria.test" });
    expect(email.text).toContain("Si no puedes venir, responde a este correo o llámanos para cancelarla");
    expect(email.text).not.toMatch(/baja/i);
  });

  it("a thread where someone else wrote last is not used: the reply would reach them, so the system mail goes to the customer", async () => {
    const { servers, channel } = await connectMailbox();
    const { contact, conversation } = await customerWhoWrote(channel.id);
    await createContactWithIdentity("email_imap", { name: "Otra persona", email: "otra@example.com", externalId: "otra@example.com" });
    const later = "<respuesta-de-otra@example.com>";
    await createMessage(conversation, {
      text: "Yo también quiero cita.",
      createdAt: at("2026-09-21T10:00"),
      externalId: later,
      metadata: { email: { providerId: later, messageId: later, inReplyTo: THREAD, references: [THREAD], from: { address: "otra@example.com", name: "Otra" } } },
    });
    await bookContact(contact.id);
    const before = new Set(fs.readdirSync(outboxDir));

    expect(await runBookingReminders({ now: at("2026-09-29T08:30"), mailer })).toEqual({ ...NONE, sent: 1 });

    expect(servers.state.smtpSent).toHaveLength(0);
    const [file] = newEmails(before);
    const email = await simpleParser(fs.readFileSync(path.join(outboxDir, file)));
    expect(email.to).toMatchObject({ text: CUSTOMER });
    expect(email.replyTo).toMatchObject({ text: MAILBOX });
  });

  it("never to a customer who opted out in a mailbox, not even in their thread", async () => {
    const { servers, channel } = await connectMailbox();
    const { contact } = await customerWhoWrote(channel.id);
    await db.insert(consents).values({ contactId: contact.id, channelId: channel.id, channelType: "email_imap", type: "opt_out", source: "keyword" });
    await bookContact(contact.id);
    expect(await runBookingReminders({ now: at("2026-09-29T08:30"), mailer })).toEqual({ ...NONE, notSent: 1 });
    expect(servers.state.smtpSent).toHaveLength(0);
  });
});
