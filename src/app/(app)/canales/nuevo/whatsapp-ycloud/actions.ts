"use server";
// Server Actions of the YCloud wizard (Canales › Añadir › WhatsApp · YCloud, [YC-01]–[YC-04]). Thin: session and
// permission here (owner and admin, «Canales: crear, conectar…», [PER-04]), then src/data, which checks the permission
// again, validates every field with Zod ([SEG-04], [SEG-05]) and never returns the key ([SEG-02]).
import { revalidatePath } from "next/cache";
import { checkYCloudKey, connectYCloudChannel, type CheckYCloudKeyResult, type ConnectYCloudResult } from "@/data/ycloud";
import { ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

/** «Comprobar clave» ([YC-02]): the key against YCloud and the account's numbers. Nothing is stored. */
export async function checkYCloudKeyAction(input: unknown): Promise<ActionResult<CheckYCloudKeyResult>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    return ok(await checkYCloudKey(actor, input));
  } catch (error) {
    return toActionFailure(error);
  }
}

/** The connected number comes with the moment the test step starts counting from. */
export type ConnectYCloudActionResult = Exclude<ConnectYCloudResult, { status: "connected" }> | (Extract<ConnectYCloudResult, { status: "connected" }> & { connectedAt: string });

/** «Conectar número» ([YC-03], [YC-04]): the key is checked again, the channel stored and YCloud told where to call. */
export async function connectYCloudAction(input: unknown): Promise<ActionResult<ConnectYCloudActionResult>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    // Taken before connecting: the first message may arrive while the answer travels to the browser.
    const connectedAt = new Date().toISOString();
    const result = await connectYCloudChannel(actor, input);
    if (result.status !== "connected") return ok(result);
    revalidatePath("/canales", "layout");
    revalidatePath("/agentes", "layout");
    return ok({ ...result, connectedAt });
  } catch (error) {
    return toActionFailure(error);
  }
}
