"use server";
// Server Actions of the QR code panel ([QR-11], [QR-12]). Thin: session and «Canales: … configurar, desconectar» here
// (owner and admin, [PER-04]), then src/data, which checks it again ([SEG-04]).
import { revalidatePath } from "next/cache";
import { disconnectWhatsAppQr, reconnectWhatsAppQr, type DisconnectWhatsAppQrResult } from "@/data/whatsapp-qr";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

const NOT_FOUND = "No se ha encontrado el canal.";

/** «Reconectar» ([QR-11]): opens again the connection of a number that is still linked. */
export async function reconnectWhatsAppQrAction(channelId: unknown): Promise<ActionResult<{ state: string }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const result = await reconnectWhatsAppQr(actor, id.data);
    revalidatePath("/canales", "layout");
    return ok(result, "Conectando con WhatsApp: en unos segundos el semáforo de la sesión lo dirá.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Desconectar» ([QR-12]): the session is closed in WhatsApp and its keys erased. */
export async function disconnectWhatsAppQrAction(channelId: unknown): Promise<ActionResult<DisconnectWhatsAppQrResult>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const result = await disconnectWhatsAppQr(actor, id.data);
    revalidatePath("/canales", "layout");
    revalidatePath("/agentes", "layout");
    return ok(result, "Número desvinculado: el canal queda desactivado y conserva sus conversaciones.");
  } catch (error) {
    return toActionFailure(error);
  }
}
