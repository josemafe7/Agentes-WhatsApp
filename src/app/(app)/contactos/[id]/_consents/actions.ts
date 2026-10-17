"use server";
// Consents of the card ([CTO-08]–[CTO-10]): marking or withdrawing a permission and recording a baja the customer asked
// for by another way («Contactos: marcar permisos y dar de baja»: owner, admin, supervisor, and an agent on the contacts
// of their channels), and lifting a baja only when the customer asks («fusionar duplicados y quitar una baja»: owner,
// admin and supervisor). The consents engine (src/data/consents.ts) validates the input and checks the permission and
// the contact's channels again ([SEG-04]).
import { revalidatePath } from "next/cache";
import { liftOptOut, recordOptOutByRequest, setContactPermission } from "@/data/consents";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { contactPath } from "../../_lib/search-params";

function revalidateContact(input: unknown) {
  const contactId = typeof input === "object" && input !== null && "contactId" in input ? input.contactId : null;
  if (typeof contactId === "string") revalidatePath(contactPath(contactId));
  revalidatePath("/bandeja", "layout");
}

/** `input`: `{ contactId, kind, scope, note? }`. */
export async function liftOptOutAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.contacts.merge);
    await liftOptOut(actor, input);
    revalidateContact(input);
    return ok(undefined, "Baja levantada.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** `input`: `{ contactId, permission, granted, method, givenOn?, note? }`. */
export async function setPermissionAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.contacts.consents);
    await setContactPermission(actor, input);
    revalidateContact(input);
    return ok(undefined, "Permiso anotado.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** `input`: `{ contactId, kind, scope, method, note? }`. */
export async function recordOptOutAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.contacts.consents);
    const { kinds } = await recordOptOutByRequest(actor, input);
    revalidateContact(input);
    return ok(undefined, kinds.length ? "Baja anotada." : "Ya estaba dado de baja.");
  } catch (error) {
    return toActionFailure(error);
  }
}
