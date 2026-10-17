"use server";
// «Confirmar» of a contact the app wrote to first ([WA-63]): thin action; src/data/contact-identities.ts checks who may.
import { refresh } from "next/cache";
import { confirmConversationIdentity } from "@/data/contact-identities";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

export async function confirmIdentityAction(conversationId: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.contacts.edit);
    await confirmConversationIdentity(actor, conversationId);
    refresh();
    return ok(undefined, "Contacto confirmado.");
  } catch (error) {
    return toActionFailure(error);
  }
}
