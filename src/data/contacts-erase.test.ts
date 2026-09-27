// Borrar un contacto ([CTO-07], [CUM-07]): with the typed confirmation, its data, messages and files go, its bookings stay
// anonymised so the reports add up, and the activity log records it without personal data ([SEG-10]). Only
// Propietario and Administrador ([PER-01] «Contactos: exportar y borrar datos»); a refused call changes nothing ([SEG-04]).
import { eq, inArray } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  aiRuns,
  auditLog,
  bookingEvents,
  bookings,
  consents,
  contactIdentities,
  contacts,
  conversations,
  handoffEvents,
  internalNotes,
  jobs,
  messageRetrievals,
  messages,
  notifications,
  webhookEvents,
} from "@/db/schema";
import type { Role } from "@/lib/enums";
import { createHairdresser } from "@/server/booking/test-helpers";
import { clearContactData, createRichContact } from "@/server/compliance/contact-data-test-helpers";
import { AuthError, ValidationError } from "@/server/errors";
import { createChannel, createContactWithIdentity, createConversation, createMessage, createUser, type TestUser } from "@/test/factories";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import { eraseContact, eraseContacts } from "./contacts-erase";

const ROLES: Role[] = ["owner", "admin", "supervisor", "agent", "viewer"];
const users = {} as Record<Role, TestUser>;
let web: { id: string; name: string };
let whatsapp: { id: string; name: string };
let hair: Awaited<ReturnType<typeof createHairdresser>>;
let memory: ReturnType<typeof memoryFileStorage>;
let jose: Awaited<ReturnType<typeof createRichContact>>;
let marta: Awaited<ReturnType<typeof createRichContact>>;

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

beforeAll(async () => {
  web = await createChannel({ name: "Chat de la web" });
  whatsapp = await createChannel({ name: "WhatsApp Recepción", type: "whatsapp", isDemo: true });
  for (const role of ROLES) users[role] = await createUser(role);
});

beforeEach(async () => {
  await clearContactData();
  hair = await createHairdresser();
  memory = memoryFileStorage();
  const person = { userId: users.supervisor.userId, name: "Carmen López" };
  const common = { channels: { web, whatsapp }, storage: memory.storage, hair, person };
  jose = await createRichContact({ ...common, name: "José Pérez", email: "jose@example.com", phone: "+34 600 111 222", bookingStart: "2026-09-28T10:00" });
  marta = await createRichContact({ ...common, name: "Marta Gil", email: "marta@example.com", bookingStart: "2026-09-28T11:00" });
});

const erase = (role: Role, confirmName = "José Pérez", contactId = jose.contact.id) =>
  eraseContact(users[role].actor, contactId, { confirmName }, { storage: memory.storage });

const rowsOf = async (contactId: string, conversationIds: string[]) => ({
  contact: await db.select().from(contacts).where(eq(contacts.id, contactId)),
  identities: await db.select().from(contactIdentities).where(eq(contactIdentities.contactId, contactId)),
  consents: await db.select().from(consents).where(eq(consents.contactId, contactId)),
  conversations: await db.select().from(conversations).where(inArray(conversations.id, conversationIds)),
  messages: await db.select().from(messages).where(inArray(messages.conversationId, conversationIds)),
  notes: await db.select().from(internalNotes).where(inArray(internalNotes.conversationId, conversationIds)),
  handoffs: await db.select().from(handoffEvents).where(inArray(handoffEvents.conversationId, conversationIds)),
});
const idsOf = (data: typeof jose) => [data.conversations.web.id, data.conversations.whatsapp.id];

describe("borrar un contacto [CTO-07] [CUM-07]", () => {
  it("erases its data, conversations, messages, notes and files", async () => {
    expect(await erase("owner")).toEqual({ conversations: 2, messages: 4, files: 1, bookingsAnonymized: 1 });
    const left = await rowsOf(jose.contact.id, idsOf(jose));
    for (const rows of Object.values(left)) expect(rows).toEqual([]);
    expect(await db.select().from(messageRetrievals).where(eq(messageRetrievals.messageId, jose.messages.aiReply.id))).toEqual([]);
    expect(memory.files.has(jose.fileKey)).toBe(false);
    // Team notices and raw webhooks that name the customer go too.
    expect(await db.select().from(notifications).where(eq(notifications.id, jose.notificationId))).toEqual([]);
    expect(await db.select().from(webhookEvents).where(eq(webhookEvents.id, jose.webhookEventId))).toEqual([]);
    // A pending reply of a conversation that no longer exists never runs.
    expect((await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jose.jobId)))[0]?.status).toBe("cancelled");
  });

  it("keeps its bookings anonymised so the reports add up", async () => {
    await erase("owner");
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, jose.bookingId));
    expect(booking).toMatchObject({ contactId: null, contactName: null, notes: null, conversationId: null, status: "confirmed", source: "ai", serviceId: hair.cut.id });
    expect(await db.select({ action: bookingEvents.action }).from(bookingEvents).where(eq(bookingEvents.bookingId, jose.bookingId))).toEqual([{ action: "created" }]);
    // What the AI cost stays in the reports ([INF-07]), without its link to the erased conversation.
    const [run] = await db.select().from(aiRuns).where(eq(aiRuns.id, jose.aiRunId));
    expect(run).toMatchObject({ conversationId: null, messageId: null, costUsd: 0.0012 });
  });

  it("does not touch other contacts", async () => {
    await erase("owner");
    const left = await rowsOf(marta.contact.id, idsOf(marta));
    expect(left.contact).toHaveLength(1);
    expect(left.identities).toHaveLength(2);
    expect(left.consents).toHaveLength(2);
    expect(left.conversations).toHaveLength(2);
    expect(left.messages).toHaveLength(4);
    expect(left.notes).toHaveLength(1);
    expect(left.handoffs).toHaveLength(1);
    expect(memory.files.has(marta.fileKey)).toBe(true);
    expect(await db.select().from(notifications).where(eq(notifications.id, marta.notificationId))).toHaveLength(1);
    expect(await db.select().from(webhookEvents).where(eq(webhookEvents.id, marta.webhookEventId))).toHaveLength(1);
    expect((await db.select().from(bookings).where(eq(bookings.id, marta.bookingId)))[0]).toMatchObject({ contactId: marta.contact.id, contactName: "Marta Gil" });
  });

  it("keeps a file that another conversation still uses", async () => {
    const other = await createConversation(web.id, marta.contact.id);
    await createMessage(other, { contentType: "audio", text: null, media: { fileKey: jose.fileKey, mimeType: "audio/ogg", size: 4 } });
    await erase("owner");
    expect(memory.files.has(jose.fileKey)).toBe(true);
  });

  it("the activity log records it without personal data [SEG-10]", async () => {
    await erase("admin");
    const entries = await db.select().from(auditLog).where(eq(auditLog.action, "contact.erased"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ targetType: "contact", targetId: jose.contact.id, actorUserId: users.admin.userId, metadata: { conversations: 2, messages: 4, files: 1, bookingsAnonymized: 1 } });
    expect(JSON.stringify(entries[0])).not.toMatch(/José|Pérez|jose@|bsuid/);
  });
});

describe("la confirmación escribiendo el nombre [CTO-07]", () => {
  it("without the exact name nothing is erased", async () => {
    const error = await errorOf(erase("owner", "José"));
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors).toEqual({ confirmName: ["Escribe el nombre exacto del contacto para borrarlo."] });
    expect((await rowsOf(jose.contact.id, idsOf(jose))).messages).toHaveLength(4);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "contact.erased"))).toEqual([]);
  });

  it("takes the name as the card shows it: spaces around do not matter, and a contact without a name uses its email or phone", async () => {
    await erase("owner", "  José Pérez ");
    const { contact } = await createContactWithIdentity("webchat", { name: null, email: "sin-nombre@example.com" });
    expect(await errorOf(erase("owner", "Sin nombre", contact.id))).toBeInstanceOf(ValidationError);
    await erase("owner", "sin-nombre@example.com", contact.id);
    expect(await db.select().from(contacts).where(eq(contacts.id, contact.id))).toEqual([]);
  });
});

describe("quién puede borrar [PER-01] [SEG-04]", () => {
  it.each(["owner", "admin"] as const)("%s may erase a contact", async (role) => {
    await erase(role);
    expect(await db.select().from(contacts).where(eq(contacts.id, jose.contact.id))).toEqual([]);
  });

  it.each(["supervisor", "agent", "viewer"] as const)("%s may not: nothing changes and nothing is logged", async (role) => {
    expect(await errorOf(erase(role))).toBeInstanceOf(AuthError);
    expect((await rowsOf(jose.contact.id, idsOf(jose))).messages).toHaveLength(4);
    expect(memory.files.has(jose.fileKey)).toBe(true);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "contact.erased"))).toEqual([]);
  });

  it("an unknown or malformed id answers «sin permiso»", async () => {
    expect(await errorOf(erase("owner", "José Pérez", crypto.randomUUID()))).toBeInstanceOf(AuthError);
    expect(await errorOf(erase("owner", "José Pérez", "no-es-un-id"))).toBeInstanceOf(AuthError);
  });
});

describe("borrar varios contactos de la lista [CTO-07] [CUM-07]", () => {
  const eraseMany = (role: Role, ids: string[], confirmCount = String(ids.length)) => eraseContacts(users[role].actor, { ids, confirmCount }, { storage: memory.storage });

  it("erases each selected contact as the card does, each one in the activity log, typing how many they are", async () => {
    const outcome = await eraseMany("admin", [jose.contact.id, marta.contact.id]);
    expect(outcome.erased).toBe(2);
    expect(outcome.totals.conversations).toBe(4);
    expect(await db.select().from(contacts).where(inArray(contacts.id, [jose.contact.id, marta.contact.id]))).toEqual([]);
    expect((await rowsOf(jose.contact.id, idsOf(jose))).messages).toEqual([]);
    expect(memory.files.has(jose.fileKey)).toBe(false);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "contact.erased"))).toHaveLength(2);
  });

  it("without the right number nothing is erased; one erased meanwhile is skipped", async () => {
    expect(await errorOf(eraseMany("owner", [jose.contact.id, marta.contact.id], "1"))).toBeInstanceOf(ValidationError);
    expect(await db.select().from(contacts).where(inArray(contacts.id, [jose.contact.id, marta.contact.id]))).toHaveLength(2);
    await erase("owner");
    expect((await eraseMany("owner", [jose.contact.id, marta.contact.id])).erased).toBe(1);
  });

  it.each(["supervisor", "agent", "viewer"] as const)("%s may not: nothing changes [PER-01] [SEG-04]", async (role) => {
    expect(await errorOf(eraseMany(role, [jose.contact.id]))).toBeInstanceOf(AuthError);
    expect(await db.select().from(contacts).where(eq(contacts.id, jose.contact.id))).toHaveLength(1);
  });
});
