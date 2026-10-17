// Importar contactos ([CTO-11], [CTO-12]): what a row of an Excel or a CSV says. The columns are recognised by their
// title (any case, accents or spaces), phones without a prefix take the one chosen before importing (+34 by default),
// and each row gets its data or the reasons it cannot go in. Pure: the server reads the file, checks the repeated rows
// against the contacts and imports; the screen shows the same reasons. The template the app offers has these titles.
import Papa from "papaparse";
import type { ConsentMethod, ContactPermission } from "./enums";
import { emailSchema } from "./validation";

/** At most per file ([CTO-11]). */
export const MAX_IMPORT_ROWS = 5_000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const DEFAULT_PHONE_PREFIX = "34";
const MAX_LABELS_PER_ROW = 20;
const MAX_LABEL_LENGTH = 40;
const MAX_NAME_LENGTH = 100;
/** E.164 allows 15 digits; fewer than 8 with the prefix is not a phone. */
const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;
/**
 * A number this long already carries its country code: national numbers are shorter (Spain's have 9 digits), and Excel
 * keeps «+34 600 11 22 33» as the number 34600112233, without its «+».
 */
const WITH_CODE_DIGITS = 11;

export type ImportField =
  | "name"
  | "phone"
  | "email"
  | "labels"
  | "remindersGranted"
  | "remindersDate"
  | "remindersMethod"
  | "marketingGranted"
  | "marketingDate"
  | "marketingMethod";

/** The titles of the app's template, in its order. */
export const IMPORT_TEMPLATE_COLUMNS: readonly { field: ImportField; title: string; example: string }[] = [
  { field: "name", title: "Nombre", example: "Laura Gil" },
  { field: "phone", title: "Teléfono", example: "600 11 22 33" },
  { field: "email", title: "Email", example: "laura@ejemplo.com" },
  { field: "labels", title: "Etiquetas", example: "cliente habitual, mañanas" },
  { field: "remindersGranted", title: "Avisos de sus citas", example: "sí" },
  { field: "remindersDate", title: "Fecha avisos", example: "15/09/2026" },
  { field: "remindersMethod", title: "Cómo dio avisos", example: "en persona" },
  { field: "marketingGranted", title: "Novedades y publicidad", example: "no" },
  { field: "marketingDate", title: "Fecha novedades", example: "" },
  { field: "marketingMethod", title: "Cómo dio novedades", example: "" },
];

/** Other titles a person may have used, already folded (see foldTitle). */
const ALIASES: Record<ImportField, readonly string[]> = {
  name: ["nombre", "nombre completo", "name", "cliente", "paciente"],
  phone: ["telefono", "movil", "celular", "whatsapp", "phone", "telefono movil", "numero"],
  email: ["email", "e-mail", "correo", "correo electronico", "mail"],
  labels: ["etiquetas", "etiqueta", "labels", "tags"],
  remindersGranted: ["avisos de sus citas", "avisos", "recordatorios", "permiso avisos"],
  remindersDate: ["fecha avisos", "fecha avisos de sus citas", "fecha recordatorios"],
  remindersMethod: ["como dio avisos", "como avisos", "como dio recordatorios"],
  marketingGranted: ["novedades y publicidad", "novedades", "publicidad", "marketing", "permiso publicidad"],
  marketingDate: ["fecha novedades", "fecha novedades y publicidad", "fecha publicidad"],
  marketingMethod: ["como dio novedades", "como novedades", "como dio publicidad"],
};

/** Lower case, without accents, punctuation at the ends or repeated spaces. */
export function foldTitle(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[¿?¡!:.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type ImportColumns = { fields: Partial<Record<ImportField, number>>; unknown: string[] };

/** Which column holds each field, from the first row; the first column with a title wins. */
export function recogniseColumns(header: readonly unknown[]): ImportColumns {
  const fields: Partial<Record<ImportField, number>> = {};
  const unknown: string[] = [];
  header.forEach((cell, index) => {
    const title = foldTitle(cellText(cell));
    if (!title) return;
    const field = (Object.keys(ALIASES) as ImportField[]).find((candidate) => ALIASES[candidate].includes(title));
    if (field && fields[field] === undefined) fields[field] = index;
    else if (!field) unknown.push(cellText(cell).trim());
  });
  return { fields, unknown };
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  return String(value).trim();
}

/**
 * The phone in digits with its country code (as WhatsApp gives them, «34600112233»), or null if it is not one. A number
 * with «+» or «00», or of 11 digits or more, keeps its own code; a shorter one takes `prefix`.
 */
export function normalizeImportPhone(value: string, prefix: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^[+\d][\d\s().\-/]*$/.test(text)) return null;
  const digits = text.replace(/\D/g, "");
  const withCode = text.startsWith("+") ? digits : text.startsWith("00") ? digits.slice(2) : digits.length >= WITH_CODE_DIGITS ? digits : `${prefix}${digits}`;
  return withCode.length >= MIN_PHONE_DIGITS && withCode.length <= MAX_PHONE_DIGITS && !withCode.startsWith("0") ? withCode : null;
}

/** The email as the rest of the app accepts it ([CTO-01]), lower case; null if it is not valid. */
export function normalizeImportEmail(value: string): string | null {
  const parsed = emailSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const YES = new Set(["si", "s", "yes", "y", "x", "1", "true", "verdadero"]);
const NO = new Set(["no", "n", "0", "false", "falso"]);

/** «sí» / «no» / empty (nothing said), or "invalid". */
export function parseYesNo(value: string): boolean | null | "invalid" {
  const folded = foldTitle(value);
  if (!folded) return null;
  if (YES.has(folded)) return true;
  if (NO.has(folded)) return false;
  return "invalid";
}

const METHODS: readonly [ConsentMethod, readonly string[]][] = [
  ["in_person", ["en persona", "persona", "presencial", "en el local", "en mostrador"]],
  ["written", ["por escrito", "escrito", "formulario", "papel", "firmado"]],
  ["web", ["en la web", "web", "online", "internet"]],
  ["conversation", ["en la conversacion", "conversacion", "whatsapp", "por whatsapp", "chat"]],
  ["imported", ["importado"]],
  ["other", ["otro", "otra"]],
];

/** How the customer gave it; an unknown text is «otro» with the text as a note; nothing, «importado» ([CTO-11]). */
export function parseMethod(value: string): { method: ConsentMethod; note: string | null } {
  const folded = foldTitle(value);
  if (!folded) return { method: "imported", note: null };
  const found = METHODS.find(([, words]) => words.includes(folded));
  return found ? { method: found[0], note: null } : { method: "other", note: value.trim().slice(0, 200) };
}

/** A date «dd/mm/aaaa», «dd-mm-aaaa», «aaaa-mm-dd» or an Excel date; null when empty, "invalid" when not a date. */
export function parseImportDate(value: unknown, now: Date): Date | null | "invalid" {
  if (value instanceof Date) return Number.isNaN(value.getTime()) || value > now ? "invalid" : value;
  const text = cellText(value);
  if (!text) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const spanish = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  const [year, month, day] = iso ? [iso[1], iso[2], iso[3]] : spanish ? [spanish[3], spanish[2], spanish[1]] : [];
  if (!year) return "invalid";
  // Noon UTC: the same calendar day in any time zone of the business.
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day) || date > now) return "invalid";
  return date;
}

export type ImportPermission = { granted: boolean; givenAt: Date | null; method: ConsentMethod; note: string | null };

export type ImportRow = {
  /** The row of the file as a person counts it (the titles are row 1). */
  line: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  labels: string[];
  permissions: Partial<Record<ContactPermission, ImportPermission>>;
};

export type ImportRowResult = { ok: true; row: ImportRow } | { ok: false; line: number; errors: string[] };

const PERMISSION_FIELDS: Record<ContactPermission, { granted: ImportField; date: ImportField; method: ImportField; label: string }> = {
  reminders: { granted: "remindersGranted", date: "remindersDate", method: "remindersMethod", label: "«Avisos de sus citas»" },
  marketing: { granted: "marketingGranted", date: "marketingDate", method: "marketingMethod", label: "«Novedades y publicidad»" },
};

/** One data row: its values, or every reason it cannot go in ([CTO-11]). */
export function readImportRow(cells: readonly unknown[], line: number, columns: ImportColumns, options: { prefix: string; now: Date }): ImportRowResult {
  const raw = (field: ImportField): unknown => (columns.fields[field] === undefined ? null : cells[columns.fields[field] as number]);
  const text = (field: ImportField) => cellText(raw(field));
  const errors: string[] = [];

  const phoneText = text("phone");
  const emailText = text("email");
  const phone = phoneText ? normalizeImportPhone(phoneText, options.prefix) : null;
  const email = emailText ? normalizeImportEmail(emailText) : null;
  if (phoneText && !phone) errors.push(`El teléfono «${phoneText.slice(0, 40)}» no es válido.`);
  if (emailText && !email) errors.push(`El email «${emailText.slice(0, 80)}» no es válido.`);
  if (!phoneText && !emailText) errors.push("No tiene teléfono ni email: no se le podría escribir ni reconocer al importarlo otra vez.");

  const permissions: ImportRow["permissions"] = {};
  for (const [permission, fields] of Object.entries(PERMISSION_FIELDS) as [ContactPermission, (typeof PERMISSION_FIELDS)[ContactPermission]][]) {
    const answer = parseYesNo(text(fields.granted));
    if (answer === "invalid") {
      errors.push(`${fields.label} tiene que decir «sí» o «no».`);
      continue;
    }
    if (answer === null) continue;
    const givenAt = parseImportDate(raw(fields.date), options.now);
    if (givenAt === "invalid") {
      errors.push(`La fecha de ${fields.label} no es una fecha pasada (escríbela como 15/09/2026).`);
      continue;
    }
    const { method, note } = parseMethod(text(fields.method));
    permissions[permission] = { granted: answer, givenAt, method, note };
  }

  if (errors.length) return { ok: false, line, errors };
  const labels = [
    ...new Set(
      text("labels")
        .split(/[,;]/)
        .map((label) => label.trim().slice(0, MAX_LABEL_LENGTH))
        .filter(Boolean),
    ),
  ].slice(0, MAX_LABELS_PER_ROW);
  const name = text("name").replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH) || null;
  return { ok: true, row: { line, name, phone, email, labels, permissions } };
}

/** Whether a row brings any permission given: then the person must confirm the customers really gave them. */
export function rowsGrantPermissions(rows: readonly ImportRow[]): boolean {
  return rows.some((row) => Object.values(row.permissions).some((permission) => permission?.granted));
}

/** A row of the file with nothing in it is not counted. */
export function isEmptyRow(cells: readonly unknown[]): boolean {
  return cells.every((cell) => cellText(cell) === "");
}

// ─── What the screen gets ──────────────────────────────────────────────────────────────────────────────

/** A repeated row matches a contact or an earlier row of the same file ([CTO-12]). */
export type ImportMatch = { contactId: string; name: string | null } | { line: number };
export type ImportSkipped = { line: number; name: string | null; phone: string | null; email: string | null; reason: "email" | "phone"; match: ImportMatch };
export type ImportError = { line: number; errors: string[] };

export type ImportPreview = {
  fileName: string;
  /** Rows with something in them, the titles left out. */
  rows: number;
  toImport: number;
  skipped: ImportSkipped[];
  errors: ImportError[];
  /** The file marks permissions as given: they have to be confirmed ([CTO-11]). */
  grantsPermissions: boolean;
  /** Titles the app does not know: those columns are left out. */
  unknownColumns: string[];
};

export type ImportResult = ImportPreview & { imported: number };

/** The skipped rows as a CSV (with a BOM, so Excel reads the accents), for «Descargar la lista». Never formulas. */
export function skippedRowsCsv(skipped: readonly ImportSkipped[]): string {
  const header = ["Fila", "Nombre", "Teléfono", "Email", "Coincide por", "Coincide con"];
  const lines = skipped.map((row) => [
    String(row.line),
    row.name ?? "",
    row.phone ? `+${row.phone}` : "",
    row.email ?? "",
    row.reason === "email" ? "Email" : "Teléfono",
    "line" in row.match ? `Fila ${row.match.line} del archivo` : (row.match.name ?? "Contacto sin nombre"),
  ]);
  return `\uFEFF${Papa.unparse([header, ...lines].map((cells) => cells.map((cell) => (/^[=+\-@]/.test(cell) ? `'${cell}` : cell))), { delimiter: ";" })}`;
}
