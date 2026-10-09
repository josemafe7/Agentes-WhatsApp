"use server";
// Server Actions of the QR code wizard (Canales › Añadir › WhatsApp · Código QR, [QR-01]–[QR-05]). Thin: session and
// permission here (owner and admin, «Canales: crear, conectar…», [PER-04]), then src/data, which checks the permission
// again and validates every field with Zod ([SEG-04], [SEG-05]). The code travels to the browser only as its image, and
// only to whoever manages channels: it links the account.
import { revalidatePath } from "next/cache";
import { getQrLinkState, startQrLink, type QrLinkState } from "@/data/whatsapp-qr";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

/** «Generar código QR» ([QR-01], [QR-03]): the channel is stored and a connection starts offering a code to scan. */
export async function startQrLinkAction(input: unknown): Promise<ActionResult<{ channelId: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const result = await startQrLink(actor, input);
    revalidatePath("/canales", "layout");
    revalidatePath("/agentes", "layout");
    return ok(result);
  } catch (error) {
    return toActionFailure(error);
  }
}

/** What the wizard shows while it waits: the code to scan, or how the link ended ([QR-03]). */
export async function qrLinkStateAction(channelId: unknown): Promise<ActionResult<QrLinkState>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail("No se ha encontrado el canal.");
    const state = await getQrLinkState(actor, id.data);
    // Linked: the list and the panel show the number now.
    if (state.state === "open") revalidatePath("/canales", "layout");
    return ok(state);
  } catch (error) {
    return toActionFailure(error);
  }
}
