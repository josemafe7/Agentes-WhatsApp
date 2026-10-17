"use server";
// Server Actions of the Instagram panel ([IG-09], [IG-10]). Thin: session and «Canales: … configurar, desconectar» here
// (owner and admin, [PER-04]), then src/data, which checks it again and validates every field ([SEG-04], [SEG-05]). The
// token only travels inward: no result carries it ([SEG-02]). Instagram's failures come back as their Spanish explanation.
import { revalidatePath } from "next/cache";
import { changeInstagramToken, disconnectInstagramChannel, revalidateInstagramChannel, type InstagramCheckResult } from "@/data/instagram";
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

function afterCheck(result: InstagramCheckResult, field: string | null, message: string): CheckedResult {
  if (!result.ok) return fail(result.error, field ? { [field]: [result.error] } : undefined);
  revalidateChannels();
  return ok({ warning: result.warning }, result.warning ? undefined : message);
}

/** «Revalidar» ([IG-10]): the stored token against Instagram again, the account subscribed again, and every light now. */
export async function revalidateInstagramAction(channelId: unknown): Promise<CheckedResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    return afterCheck(await revalidateInstagramChannel(actor, id.data), null, "Revalidado con Instagram: los semáforos están al día.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Cambiar token» ([IG-10]): the new token only replaces the old one if Instagram accepts it and it is the same account. */
export async function changeInstagramTokenAction(channelId: unknown, _previous: CheckedResult | undefined, formData: FormData): Promise<CheckedResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const token = formData.get("accessToken");
    return afterCheck(await changeInstagramToken(actor, id.data, { accessToken: typeof token === "string" ? token : "" }), "accessToken", "Token cambiado y comprobado con Instagram.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Desconectar» ([IG-10]): the token and the app's secret keys are deleted; the channel keeps its conversations. */
export async function disconnectInstagramAction(channelId: unknown): Promise<ActionResult<null>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    await disconnectInstagramChannel(actor, id.data);
    revalidateChannels();
    revalidatePath("/agentes", "layout");
    return ok(null, "Cuenta desconectada: el canal queda desactivado y conserva sus conversaciones.");
  } catch (error) {
    return toActionFailure(error);
  }
}
