"use server";
// «Enviar plantilla» from a WhatsApp conversation ([WA-42], [WA-43], [BAN-08]). Thin: session and the area permission
// here, the input validated with the data layer's schema, which checks the conversation's channel again, that the
// template is APPROVED and its values ([SEG-04], [PER-02]); Solo lectura cannot send ([PER-03]).
import { refresh } from "next/cache";
import { setConversationContactPermission } from "@/data/consents";
import { sendHumanTemplateMessage, sendHumanTemplateSchema } from "@/data/whatsapp-send";
import { fromZodError, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";
import type { SentMessage } from "../../actions";

export async function sendTemplateAction(input: unknown): Promise<ActionResult<SentMessage>> {
  try {
    const actor = await requirePermission(PERMISSIONS.inbox.reply);
    const parsed = sendHumanTemplateSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const sent = await sendHumanTemplateMessage(actor, parsed.data);
    refresh();
    return ok({ status: sent.status, aiPausedUntil: sent.aiPausedUntil });
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * «Anotar permiso» in the template dialog ([WA-61], [CTO-09]): the customer's permission, saying how they gave it, for
 * whoever may mark permissions in this channel. Then the template may go.
 */
export async function recordTemplatePermissionAction(input: unknown): Promise<ActionResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.contacts.consents);
    await setConversationContactPermission(actor, input);
    refresh();
    return ok(undefined, "Permiso anotado.");
  } catch (error) {
    return toActionFailure(error);
  }
}
