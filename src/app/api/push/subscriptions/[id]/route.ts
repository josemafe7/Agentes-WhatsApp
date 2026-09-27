// DELETE /api/push/subscriptions/:id ([PWA-03]): removes one of the signed-in person's devices from «Tus dispositivos».
// Someone else's device answers «not found», the same as one that does not exist.
import { errorResponse } from "@/server/errors";
import { removePushDevice } from "@/server/notifications/push";
import { requireActor } from "@/server/session";
import { assertSameOrigin, NO_STORE } from "../../_lib/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    await removePushDevice(actor, (await context.params).id);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
