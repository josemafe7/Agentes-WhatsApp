"use server";
// Server Actions of the Instagram wizard (Canales › Añadir › Instagram, [IG-01], [IG-11]). Thin: session and permission
// here (owner and admin, «Canales: crear, conectar…», [PER-04]), then src/data, which checks the permission again,
// validates every field with Zod ([SEG-04], [SEG-05]) and never returns the token nor the app secrets ([SEG-02]). The
// verify token comes back once, to be pasted in Meta's panel, as the panel shows it to owner and admin.
import { revalidatePath } from "next/cache";
import { connectInstagramChannel, getInstagramPanel, type ConnectInstagramResult } from "@/data/instagram";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { PERMISSIONS } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { toActionFailure } from "@/server/errors";
import { requirePermission } from "@/server/session";

const NOT_FOUND = "No se ha encontrado el canal.";

/** The connected account comes with the moment it was connected: the test message is looked for from then on. */
export type ConnectInstagramActionResult = Exclude<ConnectInstagramResult, { status: "connected" }> | (Extract<ConnectInstagramResult, { status: "connected" }> & { connectedAt: string });

/** «Conectar»: the token is checked with Instagram, the account subscribed to its messages and the channel stored. */
export async function connectInstagramAction(input: unknown): Promise<ActionResult<ConnectInstagramActionResult>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    // Taken before connecting: the test message may arrive while the answer travels to the browser.
    const connectedAt = new Date().toISOString();
    const result = await connectInstagramChannel(actor, input);
    if (result.status !== "connected") return ok(result);
    revalidatePath("/canales", "layout");
    revalidatePath("/agentes", "layout");
    return ok({ ...result, connectedAt });
  } catch (error) {
    return toActionFailure(error);
  }
}

/** «Avisos de Meta»: when Meta last checked this account's webhook address with its verify token (ISO), or null. */
export async function instagramWebhookStatusAction(channelId: unknown): Promise<ActionResult<{ verifiedAt: string | null }>> {
  try {
    const actor = await requirePermission(PERMISSIONS.channels.manage);
    const id = idSchema.safeParse(channelId);
    if (!id.success) return fail(NOT_FOUND);
    const panel = await getInstagramPanel(actor, id.data);
    return ok({ verifiedAt: panel.webhookVerifiedAt ? panel.webhookVerifiedAt.toISOString() : null });
  } catch (error) {
    return toActionFailure(error);
  }
}
