"use server";
// «Levantar baja» of the card ([CTO-08], [CUM-03]): only when the customer asks for it, by Propietario, Administrador or
// Supervisor («Contactos: fusionar duplicados y quitar una baja»), and recorded with who, when and how it was asked. The
// opt-out engine (src/data/consents.ts) does it, validates the input and checks the permission again ([SEG-04]).
import { revalidatePath } from "next/cache";
import { liftOptOut } from "@/data/consents";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import { contactPath } from "../../_lib/search-params";

/** `input`: `{ contactId, channelId, note? }`. */
export async function liftOptOutAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.contacts.merge);
    await liftOptOut(actor, input);
    const contactId = typeof input === "object" && input !== null && "contactId" in input ? input.contactId : null;
    if (typeof contactId === "string") revalidatePath(contactPath(contactId));
    revalidatePath("/bandeja", "layout");
    return ok(undefined, "Baja levantada.");
  } catch (error) {
    return toActionFailure(error);
  }
}
