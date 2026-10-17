// The first WhatsApp to a contact who never wrote to that number ([WA-63]): the reminder goes to its phone (Spain's
// prefix when it has none), never when another contact has a WhatsApp with that phone; Meta's confirmation gives the
// contact its identity «sin confirmar», and a failure creates nothing, says why in its own words and goes on by the next
// channel. The phone a person typed is used only for that first message.
import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { bookingReminderSends, channels, consents, contactIdentities, contacts, conversations, jobs, messages, reminderSettings, whatsappTemplates } from "@/db/schema";
import type { ReminderRule } from "@/lib/reminder-rules";
import { createBooking, type BookingActor } from "@/server/booking/service";
import { at, createHairdresser, NOW } from "@/server/booking/test-helpers";
import { runBookingReminders } from "@/server/booking/reminders";
import { REMINDER_FALLBACK_JOB } from "@/server/booking/reminder-buttons";
import { importContacts } from "@/data/contacts-import";
import { createChannel, createContactWithIdentity, createUser } from "@/test/factories";
import { WA_TEST } from "@/test/fixtures/whatsapp";
import { connectedNumberRoutes, FAKE_META_BASE_URL, fakeMetaFetch, templateComponents } from "@/test/fixtures/whatsapp/fake-meta";
import type { ChannelRecord } from "../types";
import { ingestEvents } from "@/server/inbound/ingest";
import { createWhatsAppAdapter } from "./adapter";
import { encryptWhatsAppSecrets } from "./config";
import { FIRST_CONTACT_UNDELIVERED, PHONE_OF_ANOTHER_CONTACT, whatsappPhoneOf } from "./first-contact";
import { applyWhatsAppStatuses } from "./statuses";

let person: BookingActor;
let demo: ChannelRecord;
let cutId: string;
const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-first-contact-"));
const mailer = { outboxDir, smtp: null };

beforeAll(async () => {
  const owner = await createUser("owner", { name: "Recepción" });
  person = { type: "user", userId: owner.userId, name: owner.name };
});
afterAll(() => fs.rmSync(outboxDir, { recursive: true, force: true }));

const rule = (channelId: string): ReminderRule => ({
  id: "dia-antes",
  lead: { kind: "hours", minutes: 24 * 60 },
  routes: ["whatsapp", "email"],
  whatsapp: { channelId, templateName: "recordatorio_cita", templateLanguage: "es", variables: { nombre: "contact.name", fecha: "booking.date", hora: "booking.time" }, confirmButton: null, changeButton: null },
  telegram: null,
  email: null,
});

beforeEach(async () => {
  for (const table of [bookingReminderSends, messages, conversations, consents, contactIdentities, whatsappTemplates, jobs, reminderSettings]) await db.delete(table);
  cutId = (await createHairdresser()).cut.id;
  await db.delete(contacts);
  await db.delete(channels);
  demo = await createChannel({ type: "whatsapp", name: "WhatsApp demo", isDemo: true, status: "connected" });
  await db.insert(whatsappTemplates).values({ channelId: demo.id, name: "recordatorio_cita", language: "es", category: "UTILITY", status: "APPROVED", components: templateComponents, variables: ["nombre", "fecha", "hora"] });
  await db.insert(reminderSettings).values({ enabled: true, rules: [rule(demo.id)] });
});

/** An imported contact: a phone as a person wrote it, «Avisos de sus citas», no identities ([CTO-12]). */
async function importedWithBooking(phone: string, email: string | null = "rosa@example.com") {
  const [contact] = await db.insert(contacts).values({ name: "Rosa", phone, email }).returning();
  await db.insert(consents).values({ contactId: contact.id, type: "reminders_granted", source: "import", method: "imported" });
  const booking = await createBooking({ serviceId: cutId, resourceId: "any", start: at("2026-09-29T10:00"), contactId: contact.id, source: "human", actor: person, now: NOW });
  return { contact, booking };
}

const firstTemplate = async () => (await db.select().from(messages).where(and(eq(messages.direction, "outbound"), eq(messages.contentType, "template"))))[0];

describe("first WhatsApp to the phone of a contact [WA-63]", () => {
  it("the phone as WhatsApp writes numbers: Spain's prefix when it has none, its own with + or 00", () => {
    expect(whatsappPhoneOf("600 11 22 33")).toBe("34600112233");
    expect(whatsappPhoneOf("+351 912 345 678")).toBe("351912345678");
    expect(whatsappPhoneOf("teléfono")).toBeNull();
    expect(whatsappPhoneOf(null)).toBeNull();
  });

  it("a contact brought by «Importar contactos» gets it at its phone, with its country code once", async () => {
    const owner = await createUser("owner");
    const file = { name: "clientes.csv", bytes: new TextEncoder().encode("Nombre;Teléfono;Email;Avisos de sus citas\nRosa;600 99 88 77;rosa@example.com;sí\nJoão;+351 912 345 678;;sí") };
    await importContacts(owner.actor, file, { prefix: "+34", confirmPermissions: true });
    const imported = await db.select().from(contacts);
    for (const contact of imported) await createBooking({ serviceId: cutId, resourceId: "any", start: at(contact.name === "Rosa" ? "2026-09-29T10:00" : "2026-09-29T11:00"), contactId: contact.id, source: "human", actor: person, now: NOW });
    expect(await runBookingReminders({ now: at("2026-09-28T11:05"), mailer })).toEqual({ sent: 2, failed: 0, notSent: 0 });
    const phones = (await db.select().from(messages).where(eq(messages.contentType, "template"))).map((message) => (message.metadata.whatsappFirstContact as { phone: string }).phone).sort();
    expect(phones).toEqual(["34600998877", "351912345678"]);
  });

  it("a reminder goes to its phone; Meta's confirmation gives the contact its identity, «sin confirmar»", async () => {
    const { contact, booking } = await importedWithBooking("600 11 22 33");
    expect(await runBookingReminders({ now: at("2026-09-28T10:05"), mailer })).toEqual({ sent: 1, failed: 0, notSent: 0 });
    const message = await firstTemplate();
    expect(message.metadata.whatsappFirstContact).toEqual({ phone: "34600112233" });
    expect((await db.select().from(bookingReminderSends).where(eq(bookingReminderSends.bookingId, booking.id)))[0]).toMatchObject({ status: "sent", channel: "whatsapp" });
    expect(await db.select().from(contactIdentities)).toEqual([]);

    await applyWhatsAppStatuses(demo, [{ kind: "status_update", externalId: message.externalId ?? "", status: "delivered", at: NOW, recipient: { waId: "34600112233", userId: null } }], NOW);
    const [identity] = await db.select().from(contactIdentities);
    expect(identity).toMatchObject({ contactId: contact.id, channelType: "whatsapp", externalId: "34600112233", phone: "34600112233", unconfirmedSince: NOW });
    // A second status changes nothing.
    await applyWhatsAppStatuses(demo, [{ kind: "status_update", externalId: message.externalId ?? "", status: "read", at: NOW, recipient: { waId: "34600112233", userId: null } }], NOW);
    expect(await db.select().from(contactIdentities)).toHaveLength(1);
  });

  it("if WhatsApp could not deliver it, nothing is created, the message says why in its own words and the next channel goes", async () => {
    await importedWithBooking("600 11 22 33");
    await runBookingReminders({ now: at("2026-09-28T10:05"), mailer });
    const message = await firstTemplate();
    await applyWhatsAppStatuses(demo, [{ kind: "status_update", externalId: message.externalId ?? "", status: "failed", at: NOW, error: { code: 131026, message: "Mensaje no entregable" }, recipient: { waId: "34600112233", userId: null } }], NOW);
    expect(await db.select().from(contactIdentities)).toEqual([]);
    expect((await db.select().from(messages).where(eq(messages.id, message.id)))[0].error).toMatchObject({ message: FIRST_CONTACT_UNDELIVERED });
    const [fallback] = await db.select().from(jobs).where(eq(jobs.type, REMINDER_FALLBACK_JOB));
    expect(fallback.payload).toMatchObject({ sendId: expect.any(String), messageId: message.id, reason: FIRST_CONTACT_UNDELIVERED });
  });

  it("a «failed» counts whenever it comes: before the «sent», nothing is created; after it, what was created goes", async () => {
    const { contact } = await importedWithBooking("600 11 22 33");
    await runBookingReminders({ now: at("2026-09-28T10:05"), mailer });
    const message = await firstTemplate();
    const status = (value: "sent" | "failed") => ({ kind: "status_update" as const, externalId: message.externalId ?? "", status: value, at: NOW, recipient: { waId: "34600112233", userId: null }, ...(value === "failed" ? { error: { code: 131026, message: "Mensaje no entregable" } } : {}) });
    await applyWhatsAppStatuses(demo, [status("sent")], NOW);
    expect(await db.select().from(contactIdentities).where(eq(contactIdentities.contactId, contact.id))).toHaveLength(1);
    await applyWhatsAppStatuses(demo, [status("failed")], NOW);
    expect(await db.select().from(contactIdentities)).toEqual([]);
    // A «sent» that arrives late after the «failed» creates nothing.
    await applyWhatsAppStatuses(demo, [status("sent")], NOW);
    expect(await db.select().from(contactIdentities)).toEqual([]);
  });

  it("another failure keeps WhatsApp's own reason: «no tiene WhatsApp» only when that is it", async () => {
    await importedWithBooking("600 11 22 33");
    await runBookingReminders({ now: at("2026-09-28T10:05"), mailer });
    const message = await firstTemplate();
    await applyWhatsAppStatuses(demo, [{ kind: "status_update", externalId: message.externalId ?? "", status: "failed", at: NOW, error: { code: 131049, message: "Meta limita la publicidad a este cliente." }, recipient: null }], NOW);
    expect((await db.select().from(messages).where(eq(messages.id, message.id)))[0].error).toMatchObject({ message: "Meta limita la publicidad a este cliente." });
  });

  it("once it has its identity, what the customer writes arrives at that same conversation", async () => {
    const { contact } = await importedWithBooking("600 11 22 33");
    await runBookingReminders({ now: at("2026-09-28T10:05"), mailer });
    const message = await firstTemplate();
    await applyWhatsAppStatuses(demo, [{ kind: "status_update", externalId: message.externalId ?? "", status: "delivered", at: NOW, recipient: { waId: "34600112233", userId: null } }], NOW);
    const result = await ingestEvents(demo, [
      { kind: "inbound_message", externalId: "wamid.respuesta", sender: { externalIds: ["34600112233"], phone: "34600112233" }, contentType: "text", text: "Vale, allí estaré", sentAt: NOW },
    ]);
    expect(result.messages[0].conversationId).toBe(message.conversationId);
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, message.conversationId));
    expect(conversation.contactId).toBe(contact.id);
  });

  it("never when another contact already has a WhatsApp with that phone: it goes by the next channel and says why", async () => {
    await createContactWithIdentity("whatsapp", { name: "Su madre", externalId: "ES.bsuid-madre", phone: "34600112233" });
    const { booking } = await importedWithBooking("+34 600 11 22 33");
    expect(await runBookingReminders({ now: at("2026-09-28T10:05"), mailer })).toEqual({ sent: 1, failed: 0, notSent: 0 });
    expect(await firstTemplate()).toBeUndefined();
    expect((await db.select().from(bookingReminderSends).where(eq(bookingReminderSends.bookingId, booking.id)))[0].attempts).toEqual([
      expect.objectContaining({ channel: "whatsapp", outcome: "skipped", reason: PHONE_OF_ANOTHER_CONTACT }),
      expect.objectContaining({ channel: "email", outcome: "sent" }),
    ]);
  });

  it("through Meta it is written to «+» and its phone; with an identity, never the phone", async () => {
    const real = await createChannel({
      type: "whatsapp",
      name: "WhatsApp",
      status: "connected",
      phoneNumberId: WA_TEST.phoneNumberId,
      wabaId: WA_TEST.wabaId,
      metaAppId: WA_TEST.appId,
      graphApiVersion: "v26.0",
      secretsEnc: encryptWhatsAppSecrets({ accessToken: WA_TEST.accessToken, appSecret: WA_TEST.appSecret, twoStepPin: null }),
    });
    const [contact] = await db.insert(contacts).values({ name: "Rosa", phone: "600112233" }).returning();
    const [conversation] = await db.insert(conversations).values({ channelId: real.id, contactId: contact.id }).returning();
    const fake = fakeMetaFetch(connectedNumberRoutes());
    const adapter = createWhatsAppAdapter({ fetchImpl: fake.fetch, baseUrl: FAKE_META_BASE_URL, sleep: async () => {} });
    const message = {
      messageId: crypto.randomUUID(),
      conversationId: conversation.id,
      recipient: { externalIds: [], phone: "600112233", email: null, name: null },
      threadId: null,
      contentType: "text" as const,
      text: "Hola",
    };
    // Without the mark of a first message, the typed phone is never used.
    await expect(adapter.send(real, message)).rejects.toMatchObject({ retryable: false });
    await adapter.send(real, { ...message, metadata: { whatsappFirstContact: { phone: "34600112233" } } });
    expect(fake.calls.at(-1)?.body).toMatchObject({ to: "+34600112233" });
  });
});
