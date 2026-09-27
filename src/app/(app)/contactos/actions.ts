"use server";
// Server Actions of Contactos ([CTO-01], [CTO-02]). Thin: session and permission here, then src/data/contacts.ts,
// which checks the permission again (an Agent only on contacts of their channels, [PER-02]) and validates every
// field with Zod ([SEG-04], [SEG-05]). Merge, export and delete come with the compliance phase.
import { revalidatePath } from "next/cache";
import { createContact, updateContact } from "@/data/contacts";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { CONTACTS_PATH, contactPath } from "./_lib/search-params";

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
