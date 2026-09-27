// Screens poll here every 3–5 s for what changed after their cursor ([BAN-03], docs/decisions/0009). A session is
// required and only the events of the channels the person may see (and their own notifications) come back.
import { z } from "zod";
import { errorResponse, parseInput } from "@/server/errors";
import { pollRealtimeFor } from "@/server/realtime/events";
import { requireActor } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({ cursor: z.string().regex(/^\d{1,15}$/, "Cursor no válido.").nullable() });

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const { cursor } = parseInput(querySchema, { cursor: new URL(request.url).searchParams.get("cursor") });
    const result = await pollRealtimeFor(actor, cursor);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
