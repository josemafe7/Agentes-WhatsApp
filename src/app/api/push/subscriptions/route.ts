// /api/push/subscriptions ([PWA-03]): POST turns push on for this browser (PushSubscription.toJSON()), DELETE
// ({ endpoint }) turns it off. Same origin, a session, Zod and the per-person limit; src/server/notifications/push.ts
// only ever touches the signed-in person's own devices.
import { readJsonBody } from "@/server/channels/webchat/request";
import { errorResponse } from "@/server/errors";
import { deletePushSubscription, savePushSubscription } from "@/server/notifications/push";
import { requireActor } from "@/server/session";
import { assertSameOrigin, NO_STORE } from "../_lib/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const device = await savePushSubscription(actor, await readJsonBody(request), { userAgent: request.headers.get("user-agent") });
    // The endpoint stays on the server: the browser gets the id and the fingerprint of «Este dispositivo».
    return Response.json({ id: device.id, fingerprint: device.fingerprint }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    await deletePushSubscription(actor, await readJsonBody(request));
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
