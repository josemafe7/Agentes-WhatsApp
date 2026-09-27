// Exportar ([CTO-06], [CUM-07]): all the data of a contact in one file and the list as CSV, only for Propietario and
// Administrador ([PER-01] «Contactos: exportar y borrar datos»), written to the activity log without personal data
// ([SEG-10]). Called as an attacker would, straight on the data layer ([SEG-04]).
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, contactIdentities, contacts } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { createHairdresser, NOW } from "@/server/booking/test-helpers";
import { CONTACT_EXPORT_FORMAT, type ContactExport } from "@/server/compliance/contact-data-export";
import { createRichContact } from "@/server/compliance/contact-data-test-helpers";
import { AuthError, ValidationError } from "@/server/errors";
import { createChannel, createContactWithIdentity, createUser, type TestUser } from "@/test/factories";
import { memoryFileStorage } from "@/test/fixtures/whatsapp/memory-storage";
import { exportContactData, exportContactsCsv } from "./contacts-export";

const ROLES: Role[] = ["owner", "admin", "supervisor", "agent", "viewer"];
const users = {} as Record<Role, TestUser>;
let web: { id: string; name: string };
let whatsapp: { id: string; name: string };
let rich: Awaited<ReturnType<typeof createRichContact>>;
let other: Awaited<ReturnType<typeof createRichContact>>;

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

beforeAll(async () => {
  const hair = await createHairdresser();
  web = await createChannel({ name: "Chat de la web" });
  whatsapp = await createChannel({ name: "WhatsApp Recepción", type: "whatsapp", isDemo: true });
  for (const role of ROLES) users[role] = await createUser(role);
  const { storage } = memoryFileStorage();
  const person = { userId: users.supervisor.userId, name: "Carmen López" };
  rich = await createRichContact({ name: "José Pérez", email: "jose@example.com", phone: "+34 600 111 222", channels: { web, whatsapp }, storage, hair, bookingStart: "2026-09-28T10:00", person });
  other = await createRichContact({ name: "Marta Gil", email: "marta@example.com", channels: { web, whatsapp }, storage, hair, bookingStart: "2026-09-28T11:00", person });
});

beforeEach(async () => {
  await db.delete(auditLog);
});

const parse = (content: string) => JSON.parse(content) as ContactExport & { exportedAt: string };

describe("exportar los datos de un contacto [CTO-06] [CUM-07]", () => {
  it("brings the contact, its identities, consents, conversations with messages, transcripts, notes, hand-offs and bookings", async () => {
    const file = await exportContactData(users.owner.actor, rich.contact.id, { now: NOW });
    expect(file).toMatchObject({ mimeType: "application/json", fileName: `datos-contacto-2026-09-27-${rich.contact.id.slice(0, 8)}.json` });
    const data = parse(file.content);
    expect(data).toMatchObject({ format: CONTACT_EXPORT_FORMAT, version: 1, business: { name: "Peluquería Prueba", timezone: "Europe/Madrid" } });
    expect(data.contact).toMatchObject({ id: rich.contact.id, name: "José Pérez", email: "jose@example.com", phone: "+34 600 111 222", labels: ["vip"], customFields: { alergias: "ninguna" } });
    expect(data.identities.map((identity) => identity.channelType)).toEqual(["webchat", "whatsapp"]);
    expect(data.consents.map((consent) => [consent.type, consent.channel?.name])).toEqual([
      ["legal_acceptance", "Chat de la web"],
      ["opt_out", "WhatsApp Recepción"],
    ]);

    expect(data.conversations.map((conversation) => conversation.channel.name)).toEqual(["Chat de la web", "WhatsApp Recepción"]);
    const [webConversation, whatsappConversation] = data.conversations;
    expect(webConversation.messages.map((message) => [message.senderType, message.authorName, message.text])).toEqual([
      ["contact", null, "Hola, soy José Pérez. ¿Tenéis cita el lunes?"],
      ["ai", "Recepción", "¡Hola! Sí, el lunes hay huecos por la mañana."],
    ]);
    const [voice, reply] = whatsappConversation.messages;
    expect(voice).toMatchObject({ contentType: "audio", transcript: "Quería cambiar la cita del lunes." });
    // Files: metadata and an in-app link that needs a session, never their bytes ([MED-08]).
    expect(voice.file).toEqual({ name: "nota-de-voz.ogg", mimeType: "audio/ogg", size: 4, sha256: "abc123", url: expect.stringMatching(new RegExp(`/api/files/${rich.fileKey}$`)) });
    expect(reply).toMatchObject({ senderType: "human", authorName: "Carmen López", text: "Te la cambio ahora mismo." });
    expect(whatsappConversation.internalNotes).toEqual([{ authorName: "Carmen López", text: "Llamar a José Pérez si no contesta.", createdAt: expect.any(String) }]);
    expect(whatsappConversation.handoffs).toMatchObject([{ trigger: "ai_tool", reason: "Quiere cambiar la cita", summary: "José Pérez pide mover su cita." }]);

    expect(data.bookings).toHaveLength(1);
    expect(data.bookings[0]).toMatchObject({ id: rich.bookingId, service: "Corte", resource: "Laura", status: "confirmed", notes: "José Pérez es alérgica al tinte." });
    expect(data.bookings[0].history.map((event) => event.action)).toEqual(["created"]);
  });

  it("brings nothing of other contacts", async () => {
    const { content } = await exportContactData(users.admin.actor, rich.contact.id, { now: NOW });
    expect(content).not.toContain("Marta Gil");
    expect(content).not.toContain(other.contact.id);
    expect(content).not.toContain(other.bookingId);
  });

  it.each(["owner", "admin"] as const)("%s may export, and it goes to the activity log with counts only [SEG-10]", async (role) => {
    await exportContactData(users[role].actor, rich.contact.id, { now: NOW });
    const entries = await db.select().from(auditLog);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "contact.exported", targetType: "contact", targetId: rich.contact.id, actorUserId: users[role].userId });
    expect(entries[0].metadata).toEqual({ conversations: 2, messages: 4, bookings: 1 });
    expect(JSON.stringify(entries[0].metadata)).not.toMatch(/José|jose@|600/);
  });

  it.each(["supervisor", "agent", "viewer"] as const)("%s may not export a contact [PER-01] [SEG-04]", async (role) => {
    expect(await errorOf(exportContactData(users[role].actor, rich.contact.id))).toBeInstanceOf(AuthError);
    expect(await db.select().from(auditLog)).toEqual([]);
  });

  it("an unknown or malformed id answers «sin permiso», like one out of reach", async () => {
    expect(await errorOf(exportContactData(users.owner.actor, crypto.randomUUID()))).toBeInstanceOf(AuthError);
    expect(await errorOf(exportContactData(users.owner.actor, "../../etc/passwd"))).toBeInstanceOf(AuthError);
  });
});

describe("exportar el listado de contactos [CTO-06]", () => {
  const lines = (content: string) => content.replace(/^﻿/, "").trimEnd().split("\r\n");

  it("exports every contact as CSV for a spreadsheet: BOM, semicolons, header and one line each", async () => {
    const file = await exportContactsCsv(users.owner.actor, {}, { now: NOW });
    expect(file).toMatchObject({ fileName: "contactos-2026-09-27.csv", mimeType: "text/csv;charset=utf-8", count: 2 });
    expect(file.content.startsWith("﻿")).toBe(true);
    const [header, ...rows] = lines(file.content);
    expect(header).toBe('"Nombre";"Teléfono";"Email";"Etiquetas";"Canales";"Campos personalizados";"Notas";"Última conversación";"Alta"');
    expect(rows).toHaveLength(2);
    // Formula characters first become text: a phone never runs as a formula.
    expect(rows[0]).toMatch(/^"José Pérez";"'\+34 600 111 222";"jose@example\.com";"vip";"Chat web, WhatsApp";"alergias: ninguna";/);
  });

  it("keeps the list's search and filters, or only the selected contacts", async () => {
    expect(lines((await exportContactsCsv(users.owner.actor, { search: "marta" })).content)).toHaveLength(2);
    expect((await exportContactsCsv(users.owner.actor, { search: "marta" })).count).toBe(1);
    expect((await exportContactsCsv(users.admin.actor, { ids: [rich.contact.id] })).content).toContain("José Pérez");
    expect((await exportContactsCsv(users.admin.actor, { ids: [rich.contact.id] })).content).not.toContain("Marta Gil");
  });

  it("neutralises what a spreadsheet would run as a formula (CSV injection)", async () => {
    const { contact } = await createContactWithIdentity("webchat", { name: '=HYPERLINK("http://malo.example","clic")' });
    try {
      const { content } = await exportContactsCsv(users.owner.actor, { ids: [contact.id] });
      expect(lines(content)[1]).toMatch(/^"'=HYPERLINK\(""http:\/\/malo\.example"",""clic""\)";/);
    } finally {
      await db.delete(contactIdentities).where(eq(contactIdentities.contactId, contact.id));
      await db.delete(contacts).where(eq(contacts.id, contact.id));
    }
  });

  it("is in the activity log with the count, never the search text [SEG-10]", async () => {
    await exportContactsCsv(users.owner.actor, { search: "José" });
    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({ action: "contacts.exported", metadata: { count: 1, selected: false, filtered: true } });
    expect(JSON.stringify(entry.metadata)).not.toContain("José");
  });

  it.each(["supervisor", "agent", "viewer"] as const)("%s may not export the list [PER-01] [SEG-04]", async (role) => {
    expect(await errorOf(exportContactsCsv(users[role].actor, {}))).toBeInstanceOf(AuthError);
    expect(await db.select().from(auditLog)).toEqual([]);
  });

  it("validates what it receives [SEG-05]", async () => {
    expect(await errorOf(exportContactsCsv(users.owner.actor, { ids: ["no-es-un-id"] }))).toBeInstanceOf(ValidationError);
    expect(await errorOf(exportContactsCsv(users.owner.actor, { campoRaro: 1 }))).toBeInstanceOf(ValidationError);
  });
});
