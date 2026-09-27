// Exportar ([CTO-06], [CUM-07]): all the data of one contact as a JSON file, and the list of Contactos as a CSV file.
// Only Propietario and Administrador («Contactos: exportar y borrar datos»); every export goes to the activity log
// with counts, never personal data ([SEG-10]). The files travel as text to the browser, which saves them.
import "server-only";
import { z } from "zod";
import { CHANNEL_IDENTITY } from "@/components/channels/channel-identity";
import { formatDateTime } from "@/lib/format";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { toCsv, type CsvValue } from "@/server/compliance/contact-data-csv";
import { collectContactData } from "@/server/compliance/contact-data-export";
import { AuthError, parseInput } from "@/server/errors";
import { writeAudit } from "./audit";
import { contactFiltersSchema, listContactsForExport, type ContactExportRow } from "./contacts";
import { assertCan } from "./guard";
import { loadBusinessSettings } from "./settings";

export type ExportFile = { fileName: string; mimeType: string; content: string };

/** Most contacts chosen one by one for an export (the list's selection). */
export const MAX_SELECTED_CONTACTS = 500;

const DAY_PATTERN = "yyyy-MM-dd";
// Sortable and read as a date by spreadsheets.
const CSV_DATE_PATTERN = "yyyy-MM-dd HH:mm";

/** «Exportar sus datos»: the JSON of one contact ([CTO-06]). Unknown ids answer «sin permiso», like out-of-scope ones. */
export async function exportContactData(actor: Actor, contactId: unknown, options: { now?: Date } = {}): Promise<ExportFile> {
  assertCan(actor, PERMISSIONS.contacts.export);
  const id = idSchema.safeParse(contactId);
  if (!id.success) throw new AuthError("forbidden");
  const now = options.now ?? new Date();
  const data = await collectContactData(id.data, { now });
  if (!data) throw new AuthError("forbidden");
  await writeAudit({
    actor,
    action: "contact.exported",
    targetType: "contact",
    targetId: id.data,
    metadata: {
      conversations: data.conversations.length,
      messages: data.conversations.reduce((sum, conversation) => sum + conversation.messages.length, 0),
      bookings: data.bookings.length,
    },
  });
  return {
    // No personal data in the name: it ends up in download folders and browser histories.
    fileName: `datos-contacto-${formatDateTime(now, data.business.timezone, { pattern: DAY_PATTERN })}-${id.data.slice(0, 8)}.json`,
    mimeType: "application/json",
    content: JSON.stringify(data, null, 2),
  };
}

export const contactsExportSchema = contactFiltersSchema
  .omit({ page: true })
  .extend({ ids: z.array(idSchema).min(1).max(MAX_SELECTED_CONTACTS, `Como mucho ${MAX_SELECTED_CONTACTS} contactos a la vez.`).optional() })
  .strict();

const CSV_HEADER = ["Nombre", "Teléfono", "Email", "Etiquetas", "Canales", "Campos personalizados", "Notas", "Última conversación", "Alta"];

function csvRow(row: ContactExportRow, timeZone: string): CsvValue[] {
  const date = (value: Date | null) => (value ? formatDateTime(value, timeZone, { pattern: CSV_DATE_PATTERN }) : null);
  return [
    row.name,
    row.phone,
    row.email,
    row.labels.join(", "),
    row.channelTypes.map((type) => CHANNEL_IDENTITY[type].label).join(", "),
    Object.entries(row.customFields)
      .map(([field, value]) => `${field}: ${value}`)
      .join(" | "),
    row.notes,
    date(row.lastConversationAt),
    date(row.createdAt),
  ];
}

/**
 * «Exportar»: the contacts of the list as CSV ([CTO-06]), all pages, with the list's search and filters, or only the
 * selected ones (`ids`).
 */
export async function exportContactsCsv(actor: Actor, input: unknown = {}, options: { now?: Date } = {}): Promise<ExportFile & { count: number }> {
  assertCan(actor, PERMISSIONS.contacts.export);
  const { ids, ...filters } = parseInput(contactsExportSchema, input);
  const rows = await listContactsForExport(actor, filters, ids);
  const { timezone } = await loadBusinessSettings();
  const now = options.now ?? new Date();
  await writeAudit({
    actor,
    action: "contacts.exported",
    targetType: "contact",
    // What was chosen, never the search text itself (it may be a name).
    metadata: { count: rows.length, selected: ids !== undefined, filtered: Object.values(filters).some((value) => value !== undefined) },
  });
  return {
    fileName: `contactos-${formatDateTime(now, timezone, { pattern: DAY_PATTERN })}.csv`,
    mimeType: "text/csv;charset=utf-8",
    content: toCsv([CSV_HEADER, ...rows.map((row) => csvRow(row, timezone))]),
    count: rows.length,
  };
}
