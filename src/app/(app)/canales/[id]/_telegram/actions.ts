"use server";
// Server Actions of the Telegram panel ([TG-04], [TG-08]). Thin: session and «Canales: … configurar, desconectar» here
// (owner and admin, [PER-04]), then src/data, which checks it again and validates every field ([SEG-04], [SEG-05]). The
// token only travels inward: no result carries it ([SEG-02]). Telegram's failures come back as their Spanish explanation.
import { revalidatePath } from "next/cache";
import { changeTelegramToken, disconnectTelegramChannel, revalidateTelegramChannel, type DisconnectTelegramResult, type TelegramCheckResult } from "@/data/telegram";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

const NOT_FOUND = "No se ha encontrado el canal.";

type CheckedResult = ActionResult<{ warning: string | null }>;

/** The list, the panel and its tabs show what changed. */
function revalidateChannels(): void {
  revalidatePath("/canales", "layout");
}

function afterCheck(result: TelegramCheckResult, field: string | null, message: string): CheckedResult {
  if (!result.ok) return fail(result.error, field ? { [field]: [result.error] } : undefined);
  revalidateChannels();
  return ok({ warning: result.warning }, result.warning ? undefined : message);
}

/** «Revalidar» ([TG-08]): the stored token against Telegram again, the bot's messages back here, and every light now. */
export async function revalidateTelegramAction(channelId: unknown): Promise<CheckedResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    return afterCheck(await revalidateTelegramChannel(actor, id.data), null, "Revalidado con Telegram: los semáforos están al día.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Cambiar token» ([TG-08]): the new token only replaces the old one if Telegram accepts it and it is the same bot. */
export async function changeTelegramTokenAction(channelId: unknown, _previous: CheckedResult | undefined, formData: FormData): Promise<CheckedResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const token = formData.get("botToken");
    return afterCheck(await changeTelegramToken(actor, id.data, { botToken: typeof token === "string" ? token : "" }), "botToken", "Token cambiado y comprobado con Telegram.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Desconectar» ([TG-04]): Telegram stops calling this installation and the token is deleted. */
export async function disconnectTelegramAction(channelId: unknown): Promise<ActionResult<DisconnectTelegramResult>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const result = await disconnectTelegramChannel(actor, id.data);
    revalidateChannels();
    revalidatePath("/agentes", "layout");
    return ok(result, "Bot desconectado: el canal queda desactivado y conserva sus conversaciones.");
  } catch (error) {
    return toActionFailure(error);
  }
}
