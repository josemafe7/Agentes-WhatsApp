// «Borrar contacto» ([CTO-07], [CUM-07]): only Propietario and Administrador («Contactos: exportar y borrar datos»),
// confirmed by typing the contact's name as the card shows it (DESIGN.md «Diálogos y confirmaciones»). What goes and what
// stays anonymised is in src/server/compliance/contact-data-erase.ts; the activity log keeps the fact and the numbers,
// never who the customer was ([SEG-10]).
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import type { FileStorage } from "@/server/adapters/file-storage";
import type { JobQueue } from "@/server/adapters/job-queue";
import { eraseContactData, type ContactErasure } from "@/server/compliance/contact-data-erase";
import { AuthError, parseInput, ValidationError } from "@/server/errors";
import { contactDisplayName } from "./contacts";
import { assertCan } from "./guard";

export const eraseContactSchema = z.object({ confirmName: z.string().max(300) }).strict();

const CONFIRMATION_MISMATCH = "Escribe el nombre exacto del contacto para borrarlo.";

export async function eraseContact(
  actor: Actor,
  contactId: unknown,
  input: unknown,
  options: { storage?: FileStorage; queue?: JobQueue; now?: Date } = {},
): Promise<ContactErasure> {
  assertCan(actor, PERMISSIONS.contacts.delete);
  const id = idSchema.safeParse(contactId);
  if (!id.success) throw new AuthError("forbidden");
  const [contact] = await db.select({ name: contacts.name, email: contacts.email, phone: contacts.phone }).from(contacts).where(eq(contacts.id, id.data));
  if (!contact) throw new AuthError("forbidden");
  const { confirmName } = parseInput(eraseContactSchema, input);
  if (confirmName.trim() !== contactDisplayName(contact)) throw new ValidationError(undefined, { confirmName: [CONFIRMATION_MISMATCH] });
  const erased = await eraseContactData(id.data, { ...options, audit: { actor, action: "contact.erased", targetType: "contact", targetId: id.data } });
  // Someone else erased it a moment ago.
  if (!erased) throw new AuthError("forbidden");
  return erased;
}

/** Most contacts erased at once: each one is its own transaction and the request has its time. */
export const MAX_BULK_ERASE = 50;

export const eraseContactsSchema = z
  .object({
    ids: z.array(idSchema).min(1, "Elige al menos un contacto.").max(MAX_BULK_ERASE, `Como mucho ${MAX_BULK_ERASE} contactos de una vez.`),
    /** The number of contacts, typed by the person (DESIGN.md «Diálogos y confirmaciones»). */
    confirmCount: z.string().trim().max(10),
  })
  .strict();

export type BulkErasure = { erased: number; totals: ContactErasure };

/**
 * «Borrar» the contacts selected in the list ([CTO-07], [CUM-07]): the same erasure as the card, one by one, each with
 * its own activity log entry. Confirmed by typing how many they are. A contact someone erased meanwhile is skipped.
 */
export async function eraseContacts(actor: Actor, input: unknown, options: { storage?: FileStorage; queue?: JobQueue; now?: Date } = {}): Promise<BulkErasure> {
  assertCan(actor, PERMISSIONS.contacts.delete);
  const { ids, confirmCount } = parseInput(eraseContactsSchema, input);
  const unique = [...new Set(ids)];
  if (confirmCount !== String(unique.length)) {
    throw new ValidationError(undefined, { confirmCount: [`Escribe ${unique.length} para borrar los contactos elegidos.`] });
  }
  const totals: ContactErasure = { conversations: 0, messages: 0, files: 0, bookingsAnonymized: 0 };
  let erased = 0;
  for (const id of unique) {
    const done = await eraseContactData(id, { ...options, audit: { actor, action: "contact.erased", targetType: "contact", targetId: id } });
    if (!done) continue;
    erased++;
    for (const key of Object.keys(totals) as (keyof ContactErasure)[]) totals[key] += done[key];
  }
  return { erased, totals };
}
