// Importar contactos ([CTO-11]–[CTO-13]): an Excel or a CSV, first shown and then imported. Good rows go in with their
// permissions (with date and how, or «importado» with the file and who confirmed it); repeated rows (by email, or by
// the last 9 digits of the phone, against the contacts or an earlier row) are listed and never change anything, so
// the same file twice creates nothing; errors are listed row by row. No identities. Owner and admin only.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, consents, contactIdentities, contacts } from "@/db/schema";
import { IMPORT_TEMPLATE_COLUMNS, skippedRowsCsv } from "@/lib/contact-import";
import type { Role } from "@/lib/enums";
import { AuthError } from "@/server/errors";
import { xlsxFile } from "@/server/xlsx-file";
import { actorFor, createContactWithIdentity, createUser, type TestUser } from "@/test/factories";
import readXlsxFile from "read-excel-file/node";
import { importContacts, importTemplateFile, previewContactImport, type ImportFile } from "./contacts-import";

let owner: TestUser;
const titles = IMPORT_TEMPLATE_COLUMNS.map((column) => column.title);

const excel = (rows: string[][], name = "clientes.xlsx"): ImportFile => ({ name, bytes: xlsxFile("Clientes", [titles, ...rows]) });
const csv = (text: string, name = "clientes.csv"): ImportFile => ({ name, bytes: new TextEncoder().encode(text) });
const row = (name: string, phone: string, email = "", reminders = "", remindersDate = "", remindersHow = "") => [name, phone, email, "", reminders, remindersDate, remindersHow, "", "", ""];

beforeEach(async () => {
  for (const table of [auditLog, consents, contactIdentities]) await db.delete(table);
  await db.delete(contacts);
  owner = await createUser("owner", { name: "Elena" });
});

describe("Importar contactos [CTO-11] [CTO-12]", () => {
  it("shows first what would happen: rows that go in, repeated ones with what they match, errors row by row; nothing is written", async () => {
    const { contact: existing } = await createContactWithIdentity("whatsapp", { name: "Laura Gil", phone: "34600112233" });
    const file = excel([
      row("Laura otra vez", "600 11 22 33"),
      row("Pedro", "611 22 33 44", "pedro@ejemplo.com"),
      row("Pedro repetido", "", "PEDRO@ejemplo.com"),
      row("Sin datos", ""),
      [],
      row("Rosa", "622334455", "", "quizás"),
    ]);
    const preview = await previewContactImport(owner.actor, file, { prefix: "+34" });
    expect(preview).toMatchObject({ fileName: "clientes.xlsx", rows: 5, toImport: 1, grantsPermissions: false, unknownColumns: [] });
    expect(preview.skipped).toEqual([
      { line: 2, name: "Laura otra vez", phone: "34600112233", email: null, reason: "phone", match: { contactId: existing.id, name: "Laura Gil" } },
      { line: 4, name: "Pedro repetido", phone: null, email: "pedro@ejemplo.com", reason: "email", match: { line: 3 } },
    ]);
    expect(preview.errors).toEqual([
      { line: 5, errors: ["No tiene teléfono ni email: no se le podría escribir ni reconocer al importarlo otra vez."] },
      { line: 7, errors: ["«Avisos de sus citas» tiene que decir «sí» o «no»."] },
    ]);
    expect(await db.select().from(contacts)).toHaveLength(1);
  });

  it("imports the good rows with their labels, no identities, and their permissions; the same file again creates nothing", async () => {
    const file = excel([
      ["Ana López", "600 99 88 77", "ana@ejemplo.com", "habitual, mañanas", "sí", "15/09/2026", "en persona", "sí", "", ""],
      row("Luis", "+351 912 345 678", "", "no"),
    ]);
    await expect(importContacts(owner.actor, file, { prefix: "+34" })).rejects.toMatchObject({ fieldErrors: { confirmPermissions: [expect.stringContaining("dieron de verdad")] } });
    const result = await importContacts(owner.actor, file, { prefix: "+34", confirmPermissions: true });
    expect(result).toMatchObject({ imported: 2, skipped: [], errors: [] });

    const rows = await db.select().from(contacts);
    const ana = rows.find((contact) => contact.name === "Ana López");
    expect(ana).toMatchObject({ phone: "+34600998877", email: "ana@ejemplo.com", labels: ["habitual", "mañanas"] });
    expect(rows.find((contact) => contact.name === "Luis")?.phone).toBe("+351912345678");
    expect(await db.select().from(contactIdentities)).toEqual([]);

    const given = await db.select().from(consents).where(eq(consents.contactId, ana?.id ?? ""));
    expect(given.map((consent) => [consent.type, consent.method, consent.source])).toEqual([
      ["reminders_granted", "in_person", "import"],
      ["marketing_granted", "imported", "import"],
    ]);
    expect(given[0].givenAt).toEqual(new Date("2026-09-15T12:00:00Z"));
    expect(given[1].note).toBe("Importado de «clientes.xlsx» · confirmado por Elena");
    // «no» to «Avisos de sus citas», which is given by default (decision 0030): recorded as withdrawn.
    const luis = await db.select().from(consents).where(eq(consents.contactId, rows.find((contact) => contact.name === "Luis")?.id ?? ""));
    expect(luis.map((consent) => [consent.type, consent.method, consent.source])).toEqual([["reminders_withdrawn", "imported", "import"]]);

    const again = await importContacts(owner.actor, file, { prefix: "+34", confirmPermissions: true });
    expect(again).toMatchObject({ imported: 0, toImport: 0 });
    expect(again.skipped.map((skipped) => skipped.reason)).toEqual(["email", "phone"]);
    expect(await db.select().from(contacts)).toHaveLength(2);
  });

  it("[CTO-13] each import goes to the activity log with the file name and the counts, never the contacts' data", async () => {
    await importContacts(owner.actor, csv("Nombre;Teléfono;Email\nMarta;600111222;marta@ejemplo.com\nMarta;600111222;\n;;\n;123;"), { prefix: "+34" });
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "contacts.imported"));
    expect(entry.metadata).toEqual({ fileName: "clientes.csv", imported: 1, skipped: 1, errors: 1 });
    expect(JSON.stringify(entry)).not.toContain("600111222");
    expect(JSON.stringify(entry)).not.toContain("marta@");
  });

  it("a CSV keeps the number of each row as the file has it, blank lines included", async () => {
    const preview = await previewContactImport(owner.actor, csv("Nombre;Teléfono\nAna;600111222\n\n;\nLuis;12"), { prefix: "34" });
    expect(preview.errors).toEqual([{ line: 5, errors: ["El teléfono «12» no es válido."] }]);
  });

  it("a CSV with «;», another prefix, unknown columns left out", async () => {
    const preview = await previewContactImport(owner.actor, csv("Cliente;Móvil;Notas\nJoão;912345678;VIP"), { prefix: "351" });
    expect(preview).toMatchObject({ toImport: 1, unknownColumns: ["Notas"] });
    await importContacts(owner.actor, csv("Cliente;Móvil;Notas\nJoão;912345678;VIP"), { prefix: "351" });
    expect((await db.select().from(contacts))[0]).toMatchObject({ name: "João", phone: "+351912345678" });
  });

  it("refuses what it cannot read, with a sentence: no phone or email column, nothing under the titles, a file that is not Excel or CSV, too many rows", async () => {
    await expect(previewContactImport(owner.actor, csv("Nombre;Notas\nAna;x"), { prefix: "34" })).rejects.toThrow(/columna de teléfono ni de email/);
    await expect(previewContactImport(owner.actor, excel([]), { prefix: "34" })).rejects.toThrow(/no tiene filas/);
    await expect(previewContactImport(owner.actor, { name: "foto.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }, { prefix: "34" })).rejects.toThrow(/No se puede leer/);
    const many = Array.from({ length: 5_001 }, (_, index) => `Cliente ${index};6${String(index).padStart(8, "0")}`).join("\n");
    await expect(previewContactImport(owner.actor, csv(`Nombre;Teléfono\n${many}`), { prefix: "34" })).rejects.toThrow(/más de 5\.000 contactos/);
    await expect(previewContactImport(owner.actor, csv("Nombre;Teléfono\nAna;600111222"), { prefix: "34a" })).rejects.toMatchObject({ fieldErrors: { prefix: expect.any(Array) } });
  });

  it("the list of skipped rows downloads as a CSV Excel opens with its accents, and never as formulas", () => {
    const text = skippedRowsCsv([
      { line: 2, name: "=Peña", phone: "34600112233", email: null, reason: "phone", match: { contactId: "c1", name: "Laura Gil" } },
      { line: 4, name: null, phone: null, email: "a@b.es", reason: "email", match: { line: 3 } },
    ]);
    expect(text.startsWith("﻿")).toBe(true);
    expect(text).toContain("Fila;Nombre;Teléfono;Email;Coincide por;Coincide con");
    expect(text).toContain("2;'=Peña;'+34600112233;;Teléfono;Laura Gil");
    expect(text).toContain("4;;;a@b.es;Email;Fila 3 del archivo");
  });

  it("«Descargar plantilla» gives an Excel with the titles the app recognises, for whoever may import", async () => {
    const file = importTemplateFile(owner.actor);
    expect(file).toMatchObject({ fileName: "plantilla-contactos.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const [sheet] = await readXlsxFile(Buffer.from(file.base64, "base64"));
    expect(sheet.data[0]).toEqual(titles);
  });

  it.each<Role>(["supervisor", "agent", "viewer"])("[PER-01] %s may not import nor download the template", async (role) => {
    expect(() => importTemplateFile(actorFor(role))).toThrow(AuthError);
    await expect(previewContactImport(actorFor(role), excel([row("Ana", "600111222")]), { prefix: "34" })).rejects.toBeInstanceOf(AuthError);
    await expect(importContacts(actorFor(role), excel([row("Ana", "600111222")]), { prefix: "34" })).rejects.toBeInstanceOf(AuthError);
    expect(await db.select().from(contacts)).toEqual([]);
  });
});
