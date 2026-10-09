"use server";
// Server Actions of the YCloud panel ([YC-09], [YC-10]). Thin: session and «Canales: … configurar, desconectar» here
// (owner and admin, [PER-04]), then src/data, which checks it again and validates every field ([SEG-04], [SEG-05]). The
// key only travels inward: no result carries it ([SEG-02]). YCloud's failures come back as their Spanish explanation.
import { revalidatePath } from "next/cache";
import { changeYCloudKey, disconnectYCloudChannel, revalidateYCloudChannel, syncYCloudTemplatesNow, type DisconnectYCloudResult, type YCloudCheckResult } from "@/data/ycloud";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { isYCloudApiError } from "@/lib/ycloud/errors";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

const NOT_FOUND = "No se ha encontrado el canal.";

type CheckedResult = ActionResult<{ warning: string | null }>;

/** The list, the panel and its tabs show what changed. */
function revalidateChannels(): void {
  revalidatePath("/canales", "layout");
}

function afterCheck(result: YCloudCheckResult, field: string | null, message: string): CheckedResult {
  if (!result.ok) return fail(result.error, field ? { [field]: [result.error] } : undefined);
  revalidateChannels();
  return ok({ warning: result.warning }, result.warning ? undefined : message);
}

/** «Revalidar» ([YC-09]): the stored key against YCloud again, the channel's address of notices back, every light now. */
export async function revalidateYCloudAction(channelId: unknown): Promise<CheckedResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    return afterCheck(await revalidateYCloudChannel(actor, id.data), null, "Revalidado con YCloud: los semáforos están al día.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Cambiar clave» ([YC-09]): the new key only replaces the old one if YCloud accepts it and it sees the same number. */
export async function changeYCloudKeyAction(channelId: unknown, _previous: CheckedResult | undefined, formData: FormData): Promise<CheckedResult> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const key = formData.get("apiKey");
    return afterCheck(await changeYCloudKey(actor, id.data, { apiKey: typeof key === "string" ? key : "" }), "apiKey", "Clave cambiada y comprobada con YCloud.");
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Sincronizar plantillas» ([YC-07]): the templates of the number's WhatsApp account, as YCloud lists them. */
export async function syncYCloudTemplatesAction(channelId: unknown): Promise<ActionResult<{ total: number }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const result = await syncYCloudTemplatesNow(actor, id.data);
    revalidateChannels();
    return ok({ total: result.total }, result.total === 1 ? "1 plantilla sincronizada." : `${result.total} plantillas sincronizadas.`);
  } catch (error) {
    if (isYCloudApiError(error)) return fail(`${error.userMessage} ${error.action}`);
    return toActionFailure(error);
  }
}

/** «Desconectar» ([YC-10]): YCloud stops calling this installation and the key is deleted. */
export async function disconnectYCloudAction(channelId: unknown): Promise<ActionResult<DisconnectYCloudResult>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const result = await disconnectYCloudChannel(actor, id.data);
    revalidateChannels();
    revalidatePath("/agentes", "layout");
    return ok(result, "Número desconectado: el canal queda desactivado y conserva sus conversaciones.");
  } catch (error) {
    return toActionFailure(error);
  }
}
