// GET /api/push/public-key ([PWA-03]): the installation's public VAPID key, which the browser subscribes with. Only for
// a signed-in person; the private key never leaves src/server/notifications/push.ts.
import { errorResponse } from "@/server/errors";
import { getPushPublicKey } from "@/server/notifications/push";
import { requireActor } from "@/server/session";
import { NO_STORE } from "../_lib/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const actor = await requireActor();
    return Response.json({ publicKey: await getPushPublicKey(actor) }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
