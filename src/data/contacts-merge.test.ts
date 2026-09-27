// Duplicates and merging ([CTO-04], [CTO-05]): suggested but never merged on their own; merged by Propietario,
// Administrador or Supervisor ([PER-01] «Contactos: fusionar duplicados y quitar una baja»), with everything of both
// contacts under the kept one and the merge in the activity log. Refused calls change nothing ([SEG-04]).
import { asc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, bookings, consents, contactIdentities, contacts, conversations, internalNotes, jobs, messages, notifications } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { getJobQueue } from "@/server/adapters/job-queue";
import { createBooking } from "@/server/booking";
import { at, createHairdresser, NOW } from "@/server/booking/test-helpers";
import { clearContactData, createRichContact } from "@/server/compliance/contact-data-test-helpers";
import { replyDedupeKey } from "@/server/engine/schedule";
import { AuthError, ConflictError, ValidationError } from "@/server/errors";
import { createChannel, createContactWithIdentity, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import { listDuplicateSuggestions, mergeContacts, previewContactMerge } from "./contacts-merge";

const ROLES: Role[] = ["owner", "admin", "supervisor", "agent", "viewer"];
const users = {} as Record<Role, TestUser>;
let web: { id: string; name: string };
let whatsapp: { id: string; name: string };
let mail: { id: string; name: string };
let hair: Awaited<ReturnType<typeof createHairdresser>>;
let jose: Awaited<ReturnType<typeof createRichContact>>;
let duplicate: { id: string; webConversationId: string; mailConversationId: string; bookingId: string; webMessageIds: string[] };

const MINUTE_MS = 60_000;
const minute = (n: number) => new Date(NOW.getTime() - 60 * MINUTE_MS + n * MINUTE_MS);

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

beforeAll(async () => {
  web = await createChannel({ name: "Chat de la web" });
  whatsapp = await createChannel({ name: "WhatsApp Recepción", type: "whatsapp", isDemo: true });
  mail = await createChannel({ name: "Correo", type: "email_imap", isDemo: true });
  for (const role of ROLES) users[role] = await createUser(role);
});

/** The same person written twice: another web visit and an email, with the same email and phone. */
async function createDuplicate() {
  const [contact] = await db
    .insert(contacts)
    .values({ name: "Jose Perez", email: "jose@example.com", phone: "600111222", labels: ["habitual"], customFields: { alergias: "polen", cumpleaños: "3 de mayo" }, notes: "Viene con su hija.", createdAt: minute(40) })
    .returning();
  await db.insert(contactIdentities).values([
    { contactId: contact.id, channelType: "webchat", externalId: `visitor-dup-${contact.id.slice(0, 8)}` },
    { contactId: contact.id, channelType: "email_imap", externalId: "jose@example.com" },
  ]);
  await db.insert(consents).values({ contactId: contact.id, channelId: web.id, channelType: "webchat", type: "legal_acceptance", source: "widget", createdAt: minute(40) });
  // A second web conversation: it joins the older one of the kept contact, between its messages.
  const webConversation = await createConversation(web.id, contact.id, { createdAt: minute(40), lastMessageAt: minute(41), status: "pending_human", aiMode: "human", pauseReason: "Traspaso a una persona", unreadCount: 2 });
  const late = await createMessage(webConversation, { text: "¿Me confirmáis la hora?", createdAt: minute(41) });
  const early = await createMessage(webConversation, { text: "Soy yo otra vez, desde el móvil.", createdAt: minute(1.5) });
  await db.insert(internalNotes).values({ conversationId: webConversation.id, authorName: "Carmen López", text: "Es el mismo cliente." });
  await db.insert(notifications).values({ userId: users.owner.userId, event: "handoff", title: "Traspaso: Jose Perez", link: `/bandeja/${webConversation.id}` });
  await getJobQueue().enqueue({ type: "reply", payload: { conversationId: webConversation.id }, dedupeKey: replyDedupeKey(webConversation.id), runAt: NOW });
  const mailConversation = await createConversation(mail.id, contact.id, { externalThreadId: "<hilo@example.com>", createdAt: minute(45) });
  await createMessage(mailConversation, { text: "Adjunto el justificante.", createdAt: minute(45) });
  const booking = await createBooking({
    serviceId: hair.cut.id,
    resourceId: hair.marta.id,
    start: at("2026-09-29T10:00"),
    contactId: contact.id,
    source: "human",
    actor: { type: "user", userId: users.admin.userId, name: users.admin.name },
    now: NOW,
  });
  return { id: contact.id, webConversationId: webConversation.id, mailConversationId: mailConversation.id, bookingId: booking.id, webMessageIds: [early.id, late.id] };
}

beforeEach(async () => {
  await clearContactData();
  hair = await createHairdresser();
  jose = await createRichContact({
    name: "José Pérez",
    email: "jose@example.com",
    phone: "+34 600 111 222",
    channels: { web, whatsapp },
    storage: memoryFileStorage().storage,
    hair,
    bookingStart: "2026-09-28T10:00",
    person: { userId: users.supervisor.userId, name: "Carmen López" },
  });
  duplicate = await createDuplicate();
});

describe("posibles duplicados [CTO-04]", () => {
  it("points out contacts with the same email, phone or full name, and never merges them on its own", async () => {
    const suggestions = await listDuplicateSuggestions(users.supervisor.actor);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].contacts.map((item) => item.id)).toEqual([jose.contact.id, duplicate.id]);
    expect(suggestions[0].reasons).toEqual(["email", "phone", "name"]);
    expect(await db.select({ id: contacts.id }).from(contacts)).toHaveLength(2);
  });

  it("lists only a contact's own suggestions when asked from its card", async () => {
    const { contact: other } = await createContactWithIdentity("webchat", { name: "Lucía Gómez", email: "lucia@example.com" });
    await createContactWithIdentity("webchat", { name: "Lucia Gomez" });
    expect((await listDuplicateSuggestions(users.owner.actor, { contactId: other.id })).map((item) => item.reasons)).toEqual([["name"]]);
    expect(await listDuplicateSuggestions(users.owner.actor, { contactId: jose.contact.id })).toHaveLength(1);
  });

  it("a shared first name alone is not a duplicate", async () => {
    await clearContactData();
    await createContactWithIdentity("webchat", { name: "Ana" });
    await createContactWithIdentity("webchat", { name: "ana" });
    expect(await listDuplicateSuggestions(users.owner.actor)).toEqual([]);
  });
});

describe("vista previa de la fusión [CTO-05]", () => {
  it("shows what moves and what stays, without changing anything", async () => {
    const preview = await previewContactMerge(users.supervisor.actor, { keepId: jose.contact.id, mergeId: duplicate.id });
    expect(preview.keep).toMatchObject({ displayName: "José Pérez", bookings: 1, consents: 2 });
    expect(preview.merge).toMatchObject({ displayName: "Jose Perez", bookings: 1, consents: 1 });
    expect(preview.merge.conversations.map((item) => [item.channel.name, item.messages])).toEqual([
      ["Chat de la web", 2],
      ["Correo", 1],
    ]);
    // The two web chats become one: the older one, the kept contact's, stays.
    expect(preview.joined).toEqual([{ targetId: jose.conversations.web.id, sourceIds: [duplicate.webConversationId], channel: { id: web.id, name: "Chat de la web", type: "webchat" } }]);
    expect(preview.choices).toEqual({ name: "keep", phone: "keep", email: "keep", notes: "both" });
    expect(preview.result).toMatchObject({ labelsAdded: ["habitual"], fieldsAdded: ["cumpleaños"], discardedFields: [{ field: "alergias", value: "polen" }] });
    expect(await db.select({ id: contacts.id }).from(contacts)).toHaveLength(2);
  });
});

describe("fusionar dos contactos [CTO-05]", () => {
  it("leaves one contact with the identities, conversations, bookings, consents, labels and fields of both", async () => {
    const outcome = await mergeContacts(users.supervisor.actor, { keepId: jose.contact.id, mergeId: duplicate.id, choices: { phone: "merge" } }, { now: NOW });
    expect(outcome).toEqual({ keepId: jose.contact.id, conversations: 2, joinedConversations: 1, identities: 2, bookings: 1, consents: 1 });
    expect(await db.select().from(contacts).where(eq(contacts.id, duplicate.id))).toEqual([]);
    const [kept] = await db.select().from(contacts).where(eq(contacts.id, jose.contact.id));
    expect(kept).toMatchObject({
      name: "José Pérez",
      phone: "600111222",
      labels: ["vip", "habitual"],
      customFields: { alergias: "ninguna", cumpleaños: "3 de mayo" },
      notes: "José Pérez prefiere las mañanas.\n\nViene con su hija.",
    });
    expect(await db.select({ id: contactIdentities.id }).from(contactIdentities).where(eq(contactIdentities.contactId, jose.contact.id))).toHaveLength(4);
    expect(await db.select({ id: consents.id }).from(consents).where(eq(consents.contactId, jose.contact.id))).toHaveLength(3);
    expect((await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.contactId, jose.contact.id))).map((row) => row.id).sort()).toEqual([jose.bookingId, duplicate.bookingId].sort());
    const kept_conversations = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.contactId, jose.contact.id));
    expect(kept_conversations.map((row) => row.id).sort()).toEqual([jose.conversations.web.id, jose.conversations.whatsapp.id, duplicate.mailConversationId].sort());
  });

  it("the conversations in the same channel become the older one, with every message in date order", async () => {
    await mergeContacts(users.admin.actor, { keepId: jose.contact.id, mergeId: duplicate.id });
    expect(await db.select().from(conversations).where(eq(conversations.id, duplicate.webConversationId))).toEqual([]);
    const timeline = await db.select({ id: messages.id, text: messages.text }).from(messages).where(eq(messages.conversationId, jose.conversations.web.id)).orderBy(asc(messages.createdAt));
    expect(timeline.map((row) => row.text)).toEqual([
      "Hola, soy José Pérez. ¿Tenéis cita el lunes?",
      "Soy yo otra vez, desde el móvil.",
      "¡Hola! Sí, el lunes hay huecos por la mañana.",
      "¿Me confirmáis la hora?",
    ]);
    const [joined] = await db.select().from(conversations).where(eq(conversations.id, jose.conversations.web.id));
    // A person still has to answer: the joined conversation waits for one, with all its unread messages.
    expect(joined).toMatchObject({ status: "pending_human", aiMode: "human", unreadCount: 2, summary: null });
    expect(await db.select({ text: internalNotes.text }).from(internalNotes).where(eq(internalNotes.conversationId, jose.conversations.web.id))).toEqual([{ text: "Es el mismo cliente." }]);
    // Notices now open the conversation that stays; the pending reply of the one that went is cancelled.
    expect(await db.select({ link: notifications.link }).from(notifications).where(eq(notifications.title, "Traspaso: Jose Perez"))).toEqual([{ link: `/bandeja/${jose.conversations.web.id}` }]);
    expect((await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.dedupeKey, replyDedupeKey(duplicate.webConversationId))))[0]?.status).toBe("cancelled");
  });

  it("is in the activity log with ids and numbers only [SEG-10]", async () => {
    await mergeContacts(users.owner.actor, { keepId: jose.contact.id, mergeId: duplicate.id });
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "contact.merged"));
    expect(entry).toMatchObject({ targetType: "contact", targetId: jose.contact.id, metadata: { mergedContactId: duplicate.id, conversations: 2, joinedConversations: 1 } });
    expect(JSON.stringify(entry.metadata)).not.toMatch(/Jos|jose@|600/);
  });

  it("the person chooses which contact stays", async () => {
    await mergeContacts(users.owner.actor, { keepId: duplicate.id, mergeId: jose.contact.id });
    const [kept] = await db.select().from(contacts).where(eq(contacts.id, duplicate.id));
    expect(kept).toMatchObject({ name: "Jose Perez", customFields: { alergias: "polen", cumpleaños: "3 de mayo" } });
    // The older conversation stays, now of the kept contact.
    expect((await db.select({ contactId: conversations.contactId }).from(conversations).where(eq(conversations.id, jose.conversations.web.id)))[0]?.contactId).toBe(duplicate.id);
  });

  it("validates what it receives [SEG-05]", async () => {
    expect(await errorOf(mergeContacts(users.owner.actor, { keepId: jose.contact.id, mergeId: jose.contact.id }))).toBeInstanceOf(ValidationError);
    expect(await errorOf(mergeContacts(users.owner.actor, { keepId: jose.contact.id, mergeId: duplicate.id, choices: { name: "both" } }))).toBeInstanceOf(ValidationError);
    expect(await errorOf(mergeContacts(users.owner.actor, { keepId: jose.contact.id, mergeId: crypto.randomUUID() }))).toBeInstanceOf(AuthError);
  });
});

describe("quién puede fusionar [PER-01] [SEG-04]", () => {
  it.each(["owner", "admin", "supervisor"] as const)("%s sees the suggestions and merges", async (role) => {
    expect(await listDuplicateSuggestions(users[role].actor)).toHaveLength(1);
    await mergeContacts(users[role].actor, { keepId: jose.contact.id, mergeId: duplicate.id });
    expect(await db.select({ id: contacts.id }).from(contacts)).toHaveLength(1);
  });

  it.each(["agent", "viewer"] as const)("%s may not: no suggestions, no preview, no merge, nothing changes", async (role) => {
    const input = { keepId: jose.contact.id, mergeId: duplicate.id };
    expect(await errorOf(listDuplicateSuggestions(users[role].actor))).toBeInstanceOf(AuthError);
    expect(await errorOf(previewContactMerge(users[role].actor, input))).toBeInstanceOf(AuthError);
    expect(await errorOf(mergeContacts(users[role].actor, input))).toBeInstanceOf(AuthError);
    expect(await db.select({ id: contacts.id }).from(contacts)).toHaveLength(2);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "contact.merged"))).toEqual([]);
  });
});

describe("the simulator's customers stay apart [AJU-13]", () => {
  /** A customer the simulator made: its identity lives in the «sim:» space and its conversation is simulated. */
  async function simulatedCopyOfJose() {
    const [contact] = await db.insert(contacts).values({ name: "José Pérez", email: "jose@example.com", phone: "600111222", createdAt: minute(50) }).returning();
    await db.insert(contactIdentities).values({ contactId: contact.id, channelType: "webchat", externalId: `sim:${crypto.randomUUID()}` });
    const conversation = await createConversation(web.id, contact.id, { metadata: { simulated: true }, createdAt: minute(50) });
    await createMessage(conversation, { text: "Soy una prueba del simulador.", simulated: true, createdAt: minute(50) });
    return { contact, conversation };
  }

  it("never suggests a simulated customer as a duplicate of a real one, even with the same email, phone and name", async () => {
    const simulated = await simulatedCopyOfJose();
    const suggestions = await listDuplicateSuggestions(users.owner.actor);
    for (const suggestion of suggestions) {
      const ids = suggestion.contacts.map((item) => item.id);
      expect(ids.includes(simulated.contact.id), JSON.stringify(ids)).toBe(false);
    }
    expect(await listDuplicateSuggestions(users.owner.actor, { contactId: simulated.contact.id })).toEqual([]);
    // Two customers of the simulator may still be the same one.
    const [twin] = await db.insert(contacts).values({ name: "José Pérez", email: "jose@example.com" }).returning();
    await db.insert(contactIdentities).values({ contactId: twin.id, channelType: "whatsapp", externalId: "sim:ES.123456789" });
    expect((await listDuplicateSuggestions(users.owner.actor, { contactId: simulated.contact.id })).map((item) => item.contacts.map((contact) => contact.id).sort())).toEqual([
      [simulated.contact.id, twin.id].sort(),
    ]);
  });

  it("refuses to merge a simulated customer with a real one, either way round, and nothing changes", async () => {
    const simulated = await simulatedCopyOfJose();
    for (const input of [
      { keepId: jose.contact.id, mergeId: simulated.contact.id },
      { keepId: simulated.contact.id, mergeId: jose.contact.id },
    ]) {
      expect(await errorOf(previewContactMerge(users.owner.actor, input))).toBeInstanceOf(ConflictError);
      expect(await errorOf(mergeContacts(users.owner.actor, input, { now: NOW }))).toBeInstanceOf(ConflictError);
    }
    expect(await db.select().from(contacts).where(eq(contacts.id, simulated.contact.id))).toHaveLength(1);
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, simulated.conversation.id));
    expect(conversation).toMatchObject({ contactId: simulated.contact.id, metadata: { simulated: true } });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "contact.merged"))).toEqual([]);
  });
});
