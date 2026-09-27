"use server";
// Server Actions of Contactos ([CTO-01], [CTO-02], [CTO-05]–[CTO-07]). Thin: session and permission here, then
// src/data/contacts*.ts, which checks the permission again (an Agent only on contacts of their channels, [PER-02]) and
// validates every field with Zod ([SEG-04], [SEG-05]). Exports go through actions, never GET links: each one writes the
// activity log, and actions only take POST from the app itself ([SEG-06]).
import { revalidatePath } from "next/cache";
import { createContact, updateContact } from "@/data/contacts";
import { eraseContact, eraseContacts } from "@/data/contacts-erase";
import { exportContactData, exportContactsCsv, type ExportFile } from "@/data/contacts-export";
import { mergeContacts } from "@/data/contacts-merge";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { CONTACTS_PATH, contactPath } from "./_lib/search-params";

/** Screens that show a contact or its conversations and bookings. */
const INBOX_PATH = "/bandeja";
const AGENDA_PATH = "/agenda";

/** «Nuevo contacto»: name, phone or email, plus optional labels and fields. Returns its id to open the card. */
export async function createContactAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.contacts.edit);
    const contact = await createContact(actor, input);
    revalidatePath(CONTACTS_PATH);
    return ok({ id: contact.id }, "Contacto creado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * Saves one section of the card (data, labels or custom fields): only the fields sent change. An unknown contact
 * gets the same answer as one of another channel, so nobody learns whether it exists.
 */
export async function updateContactAction(contactId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.contacts.edit);
    const id = typeof contactId === "string" ? contactId : "";
    await updateContact(actor, id, input);
    revalidatePath(CONTACTS_PATH);
    revalidatePath(contactPath(id));
    return ok(undefined, "Cambios guardados.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Exportar datos» of the card: the JSON file with everything about the contact ([CTO-06], [CUM-07]). */
export async function exportContactDataAction(contactId: unknown): Promise<ActionResult<ExportFile>> {
  try {
    const actor = await requirePermission(PERMISSIONS.contacts.export);
    return ok(await exportContactData(actor, contactId), "Datos exportados.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Exportar» of the list: the contacts with the list's filters, or the selected ones, as CSV ([CTO-06]). */
export async function exportContactsCsvAction(input: unknown): Promise<ActionResult<ExportFile>> {
  try {
    const actor = await requirePermission(PERMISSIONS.contacts.export);
    const { count, ...file } = await exportContactsCsv(actor, input);
    return ok(file, count === 1 ? "1 contacto exportado." : `${count} contactos exportados.`);
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Borrar contacto», with its name typed ([CTO-07], [CUM-07]): its data goes and its bookings stay anonymised. */
export async function eraseContactAction(contactId: unknown, input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.contacts.delete);
    await eraseContact(actor, contactId, input);
    revalidatePath(CONTACTS_PATH);
    revalidatePath(INBOX_PATH, "layout");
    revalidatePath(AGENDA_PATH);
    return ok(undefined, "Contacto borrado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Borrar» the contacts selected in the list ([CTO-07]): confirmed by typing how many they are. */
export async function eraseContactsAction(input: unknown): Promise<ActionResult<{ erased: number }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.contacts.delete);
    const { erased } = await eraseContacts(actor, input);
    revalidatePath(CONTACTS_PATH);
    revalidatePath(INBOX_PATH, "layout");
    revalidatePath(AGENDA_PATH);
    return ok({ erased }, erased === 1 ? "1 contacto borrado." : `${erased} contactos borrados.`);
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Fusionar contactos» ([CTO-05]): returns the contact that stays, to open its card. */
export async function mergeContactsAction(input: unknown): Promise<ActionResult<{ keepId: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.contacts.merge);
    const outcome = await mergeContacts(actor, input);
    revalidatePath(CONTACTS_PATH, "layout");
    revalidatePath(INBOX_PATH, "layout");
    revalidatePath(AGENDA_PATH);
    return ok({ keepId: outcome.keepId }, "Contactos fusionados.");
  } catch (error) {
    return toActionFailure(error);
  }
}
