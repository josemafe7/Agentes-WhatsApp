"use server";
// Server Action of the Telegram wizard (Canales › Añadir › Telegram, [TG-01], [TG-05]–[TG-07]). Thin: session and
// permission here (owner and admin, «Canales: crear, conectar…», [PER-04]), then src/data, which checks the permission
// again, validates every field with Zod ([SEG-04], [SEG-05]) and never returns the token ([SEG-02]).
import { revalidatePath } from "next/cache";
import { connectTelegramChannel, type ConnectTelegramResult } from "@/data/telegram";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { qrCodeDataUrl } from "@/server/qr";
import { requirePermission } from "@/server/session";

/** The connected bot comes with the QR code of its link, for customers to open the chat ([TG-07]). */
export type ConnectTelegramActionResult = Exclude<ConnectTelegramResult, { status: "connected" }> | (Extract<ConnectTelegramResult, { status: "connected" }> & { botQr: string; connectedAt: string });

/** «Conectar»: the token is checked with Telegram and the bot's updates start reaching this installation. */
export async function connectTelegramAction(input: unknown): Promise<ActionResult<ConnectTelegramActionResult>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    // Taken before connecting: the «hola» of the test may arrive while the answer travels to the browser.
    const connectedAt = new Date().toISOString();
    const result = await connectTelegramChannel(actor, input);
    if (result.status !== "connected") return ok(result);
    revalidatePath("/canales", "layout");
    revalidatePath("/agentes", "layout");
    return ok({ ...result, botQr: await qrCodeDataUrl(result.bot.link), connectedAt });
  } catch (error) {
    return toActionFailure(error);
  }
}
