// The buttons of a reminder and what follows a reminder that could not be delivered ([AGD-24], [AGD-32], [AGD-33],
// [TG-12], [TG-13]): «Confirmo» marks «Confirmada por el cliente» once, with one «¡Gracias!» and no AI reply; «Necesito
// cambiarla» reaches the AI as the customer's message about that booking; a tap on a booking cancelled or moved is a
// message like any other; moving the booking clears the mark; a failure Meta reports later goes on by the next channel;
// in Telegram the same buttons, the answer to every tap and the bot blocked.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { bookingEvents, bookingReminderSends, bookings, channels, consents, contactIdentities, contacts, conversations, jobs, messages, reminderSettings, whatsappTemplates } from "@/db/schema";
import type { ReminderRule } from "@/lib/reminder-rules";
import type { InboundMessageEvent } from "@/server/channels/types";
import { applyWhatsAppStatuses } from "@/server/channels/whatsapp/statuses";
import { ingestTelegramUpdate } from "@/server/channels/telegram/webhook";
import { REPLY_JOB } from "@/server/engine/schedule";
import { ingestEvents } from "@/server/inbound/ingest";
import { getJobRegistration } from "@/server/jobs/registry";
import { createChannel, createContactWithIdentity, createConversation, createMessage, createUser } from "@/test/factories";
import { templateComponents } from "@/test/fixtures/whatsapp/fake-meta";
import { REMINDER_FALLBACK_JOB, REMINDER_THANKS_JOB, runReminderFallback } from "./reminder-buttons";
import { runBookingReminders } from "./reminders";
import { cancelBooking, createBooking, rescheduleBooking, type BookingActor } from "./service";
import { at, createHairdresser, NOW } from "./test-helpers";
import "./jobs";

const BSUID = "ES.10000000000000000077";
const TELEGRAM_USER = "700100200";
let person: BookingActor;
let whatsapp: typeof channels.$inferSelect;
let telegram: typeof channels.$inferSelect;
let cutId: string;
const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-reminder-buttons-"));
const mailer = { outboxDir, smtp: null };

beforeAll(async () => {
  const owner = await createUser("owner", { name: "Recepción" });
  person = { type: "user", userId: owner.userId, name: owner.name };
});

afterAll(() => fs.rmSync(outboxDir, { recursive: true, force: true }));

beforeEach(async () => {
  for (const table of [bookingReminderSends, messages, conversations, consents, contactIdentities, whatsappTemplates, jobs, reminderSettings]) await db.delete(table);
  const { cut } = await createHairdresser();
  cutId = cut.id;
  await db.delete(contacts);
  await db.delete(channels);
  whatsapp = await createChannel({ type: "whatsapp", name: "WhatsApp demo", isDemo: true, status: "connected" });
  telegram = await createChannel({ type: "telegram", name: "Bot demo", isDemo: true, status: "connected" });
  await db.insert(whatsappTemplates).values({ channelId: whatsapp.id, name: "recordatorio_cita", language: "es", category: "UTILITY", status: "APPROVED", components: templateComponents, variables: ["nombre", "fecha", "hora"] });
});

const rule = (overrides: Partial<ReminderRule> = {}): ReminderRule => ({
  id: "dia-antes",
  lead: { kind: "hours", minutes: 24 * 60 },
  routes: ["whatsapp"],
  whatsapp: {
    channelId: whatsapp.id,
    templateName: "recordatorio_cita",
    templateLanguage: "es",
    variables: { nombre: "contact.name", fecha: "booking.date", hora: "booking.time" },
    confirmButton: "Confirmo",
    changeButton: "Necesito cambiarla",
  },
  telegram: null,
  email: null,
  ...overrides,
});

async function remindedBooking(ruleOverrides: Partial<ReminderRule> = {}, options: { email?: string } = {}) {
  await db.insert(reminderSettings).values({ enabled: true, rules: [rule(ruleOverrides)] });
  const { contact } = await createContactWithIdentity("whatsapp", { name: "Lucía", externalId: BSUID, email: options.email ?? null });
  await db.insert(consents).values({ contactId: contact.id, type: "reminders_granted", source: "person" });
  const booking = await createBooking({ serviceId: cutId, resourceId: "any", start: at("2026-09-29T10:00"), contactId: contact.id, source: "human", actor: person, now: NOW });
  return { contact, booking };
}

async function reminderMessage() {
  const [message] = await db.select().from(messages).where(and(eq(messages.direction, "outbound"), eq(messages.channelId, whatsapp.id)));
  return message;
}

async function tap(text: string, quoted: string, when = at("2026-09-28T11:00")) {
  const event: InboundMessageEvent = {
    kind: "inbound_message",
    externalId: `wamid.TAP_${crypto.randomUUID()}`,
    sender: { externalIds: [BSUID], displayName: "Lucía" },
    contentType: "interactive",
    text,
    sentAt: when,
    metadata: { button: { text, payload: text }, quotedExternalId: quoted },
  };
  await ingestEvents(whatsapp, [event], { now: when });
}

const jobTypes = async () => (await db.select({ type: jobs.type }).from(jobs)).map((job) => job.type).filter((type) => type !== "booking.reminders" && type !== "channel.demo_status");

async function runJob(type: string) {
  const registration = getJobRegistration(type);
  for (const job of await db.select().from(jobs).where(eq(jobs.type, type))) {
    await registration?.handler(job.payload, { job, workerId: "w", queue: undefined as never, remainingMs: () => 10_000, rescheduleAt: () => {} });
    await db.delete(jobs).where(eq(jobs.id, job.id));
  }
}

describe("«Confirmo» and «Necesito cambiarla» on a WhatsApp reminder [AGD-32] [AGD-33]", () => {
  it("«Confirmo» marks it «Confirmada por el cliente» with one «¡Gracias!» and no AI reply; a second one changes nothing", async () => {
    const { booking } = await remindedBooking();
    await runBookingReminders({ now: at("2026-09-28T10:05") });
    const reminder = await reminderMessage();
    await tap("Confirmo", reminder.externalId!);
    const [marked] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(marked.customerConfirmedAt).not.toBeNull();
    expect(marked.status).toBe("confirmed");
    expect(await jobTypes()).toEqual([REMINDER_THANKS_JOB]);
    await runJob(REMINDER_THANKS_JOB);
    const texts = (await db.select().from(messages).where(eq(messages.direction, "outbound"))).map((message) => message.text);
    expect(texts).toContain("¡Gracias! Te esperamos.");
    const [event] = await db.select().from(bookingEvents).where(and(eq(bookingEvents.bookingId, booking.id), eq(bookingEvents.action, "customer_confirmed")));
    expect(event.actorType).toBe("contact");

    await tap("Confirmo", reminder.externalId!, at("2026-09-28T11:30"));
    expect(await jobTypes()).toEqual([]);
  });

  it("«Necesito cambiarla» reaches the AI as the customer's message about that booking", async () => {
    const { booking } = await remindedBooking();
    await runBookingReminders({ now: at("2026-09-28T10:05") });
    await tap("Necesito cambiarla", (await reminderMessage()).externalId!);
    expect(await jobTypes()).toEqual([REPLY_JOB]);
    const [inbound] = await db.select().from(messages).where(eq(messages.direction, "inbound"));
    expect(inbound.metadata.reminderReply).toEqual({ action: "change", bookingId: booking.id });
    expect((await db.select().from(bookings).where(eq(bookings.id, booking.id)))[0].customerConfirmedAt).toBeNull();
  });

  it("on a booking cancelled since, the tap is a message like any other", async () => {
    const { booking } = await remindedBooking();
    await runBookingReminders({ now: at("2026-09-28T10:05") });
    await cancelBooking({ bookingId: booking.id, actor: person, now: at("2026-09-28T10:30") });
    await tap("Confirmo", (await reminderMessage()).externalId!);
    expect(await jobTypes()).toEqual([REPLY_JOB]);
    expect((await db.select().from(bookings).where(eq(bookings.id, booking.id)))[0].customerConfirmedAt).toBeNull();
  });

  it("moving the booking clears the mark, and its history says so [AGD-33]", async () => {
    const { booking } = await remindedBooking();
    await runBookingReminders({ now: at("2026-09-28T10:05") });
    await tap("Confirmo", (await reminderMessage()).externalId!);
    await rescheduleBooking({ bookingId: booking.id, start: at("2026-10-01T10:00"), actor: person, now: at("2026-09-28T12:00") });
    expect((await db.select().from(bookings).where(eq(bookings.id, booking.id)))[0].customerConfirmedAt).toBeNull();
    const [moved] = await db.select().from(bookingEvents).where(and(eq(bookingEvents.bookingId, booking.id), eq(bookingEvents.action, "moved")));
    expect(moved.changes).toMatchObject({ customerConfirmed: { from: true, to: false } });
  });
});

describe("a reminder WhatsApp could not deliver goes by the next channel [AGD-24]", () => {
  it("the «failed» status Meta sends later queues the next channel: the email", async () => {
    const { booking } = await remindedBooking({ routes: ["whatsapp", "email"] }, { email: "lucia@example.com" });
    await runBookingReminders({ now: at("2026-09-28T10:05"), mailer });
    const reminder = await reminderMessage();
    await applyWhatsAppStatuses(whatsapp, [{ kind: "status_update", externalId: reminder.externalId!, status: "failed", at: at("2026-09-28T10:06"), error: { code: 131026, message: "No se pudo entregar" } }], at("2026-09-28T10:06"));
    expect(await jobTypes()).toContain(REMINDER_FALLBACK_JOB);
    const [job] = await db.select().from(jobs).where(eq(jobs.type, REMINDER_FALLBACK_JOB));
    await runReminderFallback(job.payload as Parameters<typeof runReminderFallback>[0], { now: at("2026-09-28T10:10"), mailer });
    const [send] = await db.select().from(bookingReminderSends).where(eq(bookingReminderSends.bookingId, booking.id));
    expect(send).toMatchObject({ status: "sent", channel: "email" });
    expect(send.attempts.map((attempt) => [attempt.channel, attempt.outcome])).toEqual([
      ["whatsapp", "failed"],
      ["email", "sent"],
    ]);
  });
});

describe("the reminder by Telegram [TG-12] [TG-13]", () => {
  async function customerOfTheBot() {
    const { contact } = await createContactWithIdentity("telegram", { name: "Lucía", externalId: TELEGRAM_USER });
    await db.insert(consents).values({ contactId: contact.id, type: "reminders_granted", source: "person" });
    const conversation = await createConversation(telegram.id, contact.id);
    await createMessage(conversation, { text: "Hola", metadata: { telegramChatId: TELEGRAM_USER } });
    const booking = await createBooking({ serviceId: cutId, resourceId: "any", start: at("2026-09-29T10:00"), contactId: contact.id, source: "human", actor: person, now: NOW });
    return { contact, conversation, booking };
  }

  it("goes with its two buttons to whoever wrote to the bot; a tap confirms it and is always answered", async () => {
    await db.insert(reminderSettings).values({ enabled: true, rules: [rule({ routes: ["telegram"], whatsapp: null, telegram: { channelId: telegram.id, text: "" } })] });
    const { booking } = await customerOfTheBot();
    expect(await runBookingReminders({ now: at("2026-09-28T10:05") })).toMatchObject({ sent: 1 });
    const [reminder] = await db.select().from(messages).where(and(eq(messages.direction, "outbound"), eq(messages.channelId, telegram.id)));
    const [send] = await db.select().from(bookingReminderSends);
    expect(reminder.metadata.telegramButtons).toEqual([
      { text: "Confirmo", data: `rc:${send.id}` },
      { text: "Necesito cambiarla", data: `rx:${send.id}` },
    ]);

    await ingestTelegramUpdate(
      telegram,
      { update_id: 1, callback_query: { id: "cb-1", from: { id: Number(TELEGRAM_USER), is_bot: false, first_name: "Lucía" }, message: { message_id: 5, date: 1, chat: { id: Number(TELEGRAM_USER), type: "private" } }, data: `rc:${send.id}` } },
      { now: at("2026-09-28T11:00") },
    );
    expect((await db.select().from(bookings).where(eq(bookings.id, booking.id)))[0].customerConfirmedAt).not.toBeNull();
    expect((await jobTypes()).sort()).toEqual([REMINDER_THANKS_JOB, "tg.answer_callback"].sort());
  });

  it("a customer who blocked the bot gets nothing by it until they unblock it", async () => {
    await db.insert(reminderSettings).values({ enabled: true, rules: [rule({ routes: ["telegram"], whatsapp: null, telegram: { channelId: telegram.id, text: "" } })] });
    const { booking } = await customerOfTheBot();
    const member = (status: string) => ({
      update_id: 2,
      my_chat_member: { chat: { id: Number(TELEGRAM_USER), type: "private" }, from: { id: Number(TELEGRAM_USER), is_bot: false, first_name: "Lucía" }, new_chat_member: { status } },
    });
    await ingestTelegramUpdate(telegram, member("kicked"), { now: at("2026-09-28T09:00") });
    expect(await runBookingReminders({ now: at("2026-09-28T10:05") })).toMatchObject({ notSent: 1 });
    const [event] = await db.select().from(bookingEvents).where(and(eq(bookingEvents.bookingId, booking.id), eq(bookingEvents.action, "reminder_not_sent")));
    expect(event.changes).toMatchObject({ reason: "Ha bloqueado el bot" });
    await ingestTelegramUpdate(telegram, member("member"), { now: at("2026-09-28T12:00") });
    const [conversation] = await db.select().from(conversations).where(eq(conversations.channelId, telegram.id));
    expect(conversation.metadata.telegramBlockedAt).toBeUndefined();
  });
});
