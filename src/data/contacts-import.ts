// Importar contactos ([CTO-11]–[CTO-13]): owner and admin bring contacts from an Excel (.xlsx) or a CSV. The same
// file is read twice: first to show what would happen (rows that go in, repeated rows with what they match and the
// errors row by row), then to import, checking everything again. A repeated row (same email, or same phone by its
// last 9 digits, as the possible duplicates, [CTO-04]) never goes in and never changes the contact it matches, so
// importing the same file twice creates nothing. Imported contacts have no identities ([CAN-13]): their phone and
// email are data until they are written to ([WA-63]). Their permissions go to their consents with how and when they
// were given, or «importado» with the file and who confirmed it. The file is not kept; the activity log keeps counts.
import "server-only";
import { isNotNull, or } from "drizzle-orm";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/node";
import { z } from "zod";
import { db } from "@/db";
import { consents, contactIdentities, contacts } from "@/db/schema";
import {
  IMPORT_TEMPLATE_COLUMNS,
  isEmptyRow,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  readImportRow,
  recogniseColumns,
  rowsGrantPermissions,
  type ImportError,
  type ImportMatch,
  type ImportPreview,
  type ImportResult,
  type ImportRow,
  type ImportSkipped,
} from "@/lib/contact-import";
import type { ContactPermission } from "@/lib/enums";
import { permissionTypes } from "@/lib/consents";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { getRateLimiter } from "@/server/adapters/rate-limiter";
import { parseInput, RateLimitError, ValidationError } from "@/server/errors";
import { decodeTextFile } from "@/server/knowledge/extract/text";
import { XLSX_CONTENT_TYPE, xlsxFile } from "@/server/xlsx-file";
import { zipUnpacksWithinLimits } from "@/server/knowledge/extract/zip";
import { writeAudit } from "./audit";
import { emailKey, phoneKey } from "./contacts-merge-plan";
import { contactSearchText } from "./contacts-search";
import { assertCan } from "./guard";

/** Imports a person may start per hour: each one reads up to 5,000 rows and writes as many contacts. */
const IMPORTS_PER_HOUR = 20;
/** Files a person may check per hour before importing (each one is read whole and compared with every contact). */
const PREVIEWS_PER_HOUR = 60;
const HOUR_MS = 60 * 60_000;
/** Rows written per statement. */
const INSERT_CHUNK = 200;

const optionsSchema = z
  .object({
    prefix: z
      .string()
      .trim()
      .transform((value) => value.replace(/^\+/, ""))
      .pipe(z.string().regex(/^[1-9]\d{0,3}$/, "Escribe el prefijo del país, por ejemplo +34.")),
    confirmPermissions: z.boolean().default(false),
  })
  .strict();

export type ImportFile = { name: string; bytes: Uint8Array };
export type { ImportPreview, ImportResult, ImportSkipped };


/** What fails before reading a single row, said in a sentence. */
const FILE_ERRORS = {
  tooLarge: "El archivo pasa de 5 MB. Divídelo en varios.",
  unreadable: "No se puede leer el archivo. Guárdalo como Excel (.xlsx) o CSV y vuelve a probar.",
  empty: "El archivo no tiene filas de contactos debajo de los títulos.",
  // MAX_IMPORT_ROWS, written as the screen says it.
  tooManyRows: "El archivo tiene más de 5.000 contactos. Divídelo en varios.",
  noColumns: "No se reconoce ninguna columna de teléfono ni de email. Usa los títulos de la plantilla (por ejemplo, «Teléfono» y «Email»).",
} as const;

async function sheetRows(file: ImportFile): Promise<unknown[][]> {
  if (file.bytes.byteLength > MAX_IMPORT_BYTES) throw new ValidationError(FILE_ERRORS.tooLarge);
  const isZip = file.bytes[0] === 0x50 && file.bytes[1] === 0x4b;
  if (isZip) {
    // An .xlsx is a ZIP: never unpacked past the limits of the knowledge files.
    if (!zipUnpacksWithinLimits(file.bytes)) throw new ValidationError(FILE_ERRORS.unreadable);
    try {
      const [first] = await readXlsxFile(Buffer.from(file.bytes));
      return first?.data ?? [];
    } catch {
      throw new ValidationError(FILE_ERRORS.unreadable);
    }
  }
  if (!/\.(csv|txt)$/i.test(file.name)) throw new ValidationError(FILE_ERRORS.unreadable);
  // Quotes, line breaks inside a field and «;», usual in Spain. The separator is guessed without the blank lines, and
  // the rows are read with them (they are skipped later), so each row keeps the number it has in the file.
  const text = decodeTextFile(file.bytes);
  const { delimiter } = Papa.parse<string[]>(text, { skipEmptyLines: "greedy", preview: 20 }).meta;
  return Papa.parse<string[]>(text, { delimiter }).data;
}

type Existing = { emails: Map<string, ImportMatch>; phones: Map<string, ImportMatch> };

/** The emails and phones of every contact, as the possible duplicates compare them ([CTO-04]). */
async function existingKeys(): Promise<Existing> {
  const emails = new Map<string, ImportMatch>();
  const phones = new Map<string, ImportMatch>();
  const people = await db
    .select({ id: contacts.id, name: contacts.name, email: contacts.email, phone: contacts.phone })
    .from(contacts)
    .where(or(isNotNull(contacts.email), isNotNull(contacts.phone)));
  const names = new Map(people.map((person) => [person.id, person.name]));
  for (const person of people) {
    const email = emailKey(person.email);
    const phone = phoneKey(person.phone);
    if (email && !emails.has(email)) emails.set(email, { contactId: person.id, name: person.name });
    if (phone && !phones.has(phone)) phones.set(phone, { contactId: person.id, name: person.name });
  }
  const identities = await db
    .select({ contactId: contactIdentities.contactId, channelType: contactIdentities.channelType, externalId: contactIdentities.externalId, phone: contactIdentities.phone })
    .from(contactIdentities);
  for (const identity of identities) {
    const match = { contactId: identity.contactId, name: names.get(identity.contactId) ?? null };
    const email = identity.channelType.startsWith("email_") ? emailKey(identity.externalId) : null;
    const phone = phoneKey(identity.phone);
    if (email && !emails.has(email)) emails.set(email, match);
    if (phone && !phones.has(phone)) phones.set(phone, match);
  }
  return { emails, phones };
}

type Plan = { preview: ImportPreview; rows: ImportRow[] };

async function plan(file: ImportFile, prefix: string): Promise<Plan> {
  const all = await sheetRows(file);
  const [header = [], ...body] = all;
  const columns = recogniseColumns(header);
  if (columns.fields.phone === undefined && columns.fields.email === undefined) throw new ValidationError(FILE_ERRORS.noColumns);
  // Lines as a person counts them in the file: the titles are line 1.
  const lines = body.map((cells, index) => ({ cells, line: index + 2 })).filter(({ cells }) => !isEmptyRow(cells));
  if (lines.length === 0) throw new ValidationError(FILE_ERRORS.empty);
  if (lines.length > MAX_IMPORT_ROWS) throw new ValidationError(FILE_ERRORS.tooManyRows);

  const now = new Date();
  const existing = await existingKeys();
  const seenEmails = new Map<string, number>();
  const seenPhones = new Map<string, number>();
  const rows: ImportRow[] = [];
  const skipped: ImportSkipped[] = [];
  const errors: ImportError[] = [];
  for (const { cells, line } of lines) {
    const result = readImportRow(cells, line, columns, { prefix, now });
    if (!result.ok) {
      errors.push({ line: result.line, errors: result.errors });
      continue;
    }
    const row = result.row;
    const email = emailKey(row.email);
    const phone = phoneKey(row.phone);
    const repeated: { reason: "email" | "phone"; match: ImportMatch } | null =
      (email && existing.emails.get(email) && { reason: "email" as const, match: existing.emails.get(email) as ImportMatch }) ||
      (phone && existing.phones.get(phone) && { reason: "phone" as const, match: existing.phones.get(phone) as ImportMatch }) ||
      (email && seenEmails.has(email) && { reason: "email" as const, match: { line: seenEmails.get(email) as number } }) ||
      (phone && seenPhones.has(phone) && { reason: "phone" as const, match: { line: seenPhones.get(phone) as number } }) ||
      null;
    if (repeated) {
      skipped.push({ line, name: row.name, phone: row.phone, email: row.email, ...repeated });
      continue;
    }
    if (email) seenEmails.set(email, line);
    if (phone) seenPhones.set(phone, line);
    rows.push(row);
  }
  return {
    rows,
    preview: {
      fileName: file.name,
      rows: lines.length,
      toImport: rows.length,
      skipped,
      errors,
      grantsPermissions: rowsGrantPermissions(rows),
      unknownColumns: columns.unknown,
    },
  };
}

async function countUse(actor: Actor, what: "import" | "preview"): Promise<void> {
  const limit = what === "import" ? IMPORTS_PER_HOUR : PREVIEWS_PER_HOUR;
  const result = await getRateLimiter().hit(`contacts:${what}:${actor.userId}`, limit, HOUR_MS);
  if (!result.allowed) throw new RateLimitError(what === "import" ? "Has importado muchos archivos seguidos. Espera un rato." : "Has revisado muchos archivos seguidos. Espera un rato.");
}

/** What importing this file would do, without writing anything ([CTO-11]). */
export async function previewContactImport(actor: Actor, file: ImportFile, input: unknown): Promise<ImportPreview> {
  assertCan(actor, PERMISSIONS.contacts.import);
  const options = parseInput(optionsSchema, input);
  await countUse(actor, "preview");
  return (await plan(file, options.prefix)).preview;
}

/** Imports the rows that can go in; the repeated ones and the ones with errors are listed, never written. */
export async function importContacts(actor: Actor, file: ImportFile, input: unknown): Promise<ImportResult> {
  assertCan(actor, PERMISSIONS.contacts.import);
  const options = parseInput(optionsSchema, input);
  await countUse(actor, "import");
  const { preview, rows } = await plan(file, options.prefix);
  if (preview.grantsPermissions && !options.confirmPermissions) {
    throw new ValidationError(undefined, { confirmPermissions: ["Confirma que estos clientes dieron de verdad los permisos que marca el archivo."] });
  }
  const now = new Date();
  const importedNote = `Importado de «${file.name.slice(0, 120)}» · confirmado por ${actor.name}`;
  await db.transaction(async (tx) => {
    for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
      const chunk = rows.slice(start, start + INSERT_CHUNK);
      const inserted = await tx
        .insert(contacts)
        .values(
          chunk.map((row) => {
            // With its «+»: the phone always shows its country code, and is never prefixed again ([WA-63]).
            const values = { name: row.name, phone: row.phone ? `+${row.phone}` : null, email: row.email, labels: row.labels };
            return { ...values, searchText: contactSearchText(values), createdAt: now, updatedAt: now };
          }),
        )
        .returning({ id: contacts.id });
      // New contacts have no consents yet: their permissions go in one statement per chunk. A «no» of a new contact is
      // what it already has: nothing to record.
      const given = chunk.flatMap((row, index) =>
        (Object.entries(row.permissions) as [ContactPermission, NonNullable<ImportRow["permissions"][ContactPermission]>][])
          .filter(([, permission]) => permission.granted)
          .map(([permission, permissionGiven], order) => ({
            contactId: inserted[index].id,
            type: permissionTypes(permission).granted,
            source: "import",
            method: permissionGiven.method,
            givenAt: permissionGiven.givenAt ?? now,
            actorType: "user" as const,
            recordedByUserId: actor.userId,
            recordedByName: actor.name,
            note: [importedNote, permissionGiven.note].filter(Boolean).join(" · "),
            // One millisecond apart: the newest record of each permission decides ([CTO-09]).
            createdAt: new Date(now.getTime() + order),
            updatedAt: now,
          })),
      );
      if (given.length) await tx.insert(consents).values(given);
    }
    await writeAudit(
      {
        actor,
        action: "contacts.imported",
        targetType: "contact",
        metadata: { fileName: file.name.slice(0, 120), imported: rows.length, skipped: preview.skipped.length, errors: preview.errors.length },
      },
      tx,
    );
  });
  return { ...preview, imported: rows.length };
}

/** The Excel template: the titles the app recognises, in its order ([CTO-11]). */
export function importTemplateFile(actor: Actor): { fileName: string; mimeType: string; base64: string } {
  assertCan(actor, PERMISSIONS.contacts.import);
  const bytes = xlsxFile("Contactos", [IMPORT_TEMPLATE_COLUMNS.map((column) => column.title)]);
  return { fileName: "plantilla-contactos.xlsx", mimeType: XLSX_CONTENT_TYPE, base64: Buffer.from(bytes).toString("base64") };
}
